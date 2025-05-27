const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

/**
 * Safely sanitizes input to prevent path traversal
 */
function sanitizeInput(input) {
    if (!input || typeof input !== 'string') return '';
    return input.replace(/[^\w\s''-]/g, '').trim();
}

/**
 * Parse class chunk into structured object
 * (From classes.js)
 */
function parseClassChunk(chunk) {
    if (!chunk || typeof chunk !== 'string') return null;

    const lines = chunk.trim().split(/\r?\n/);
    const classData = {
        className: '',
        skillUseName: '',
        DISPLAYNAMEID: null,
        DESCRIPTIONID: null,
        attributes: [],
        weapons: [],
        armors: [],
        helmets: [],
        shields: [],
        accessories: []
    };

    for (const line of lines) {
        if (!line || typeof line !== 'string') continue;
        
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('//')) continue;

        if (trimmedLine.startsWith('CREATECLASS:')) {
            classData.className = trimmedLine.split(':')[1]?.trim() || '';
        } else if (trimmedLine.startsWith('SKILLUSENAME:')) {
            // Extract the skill use name and remove any surrounding quotes.
            classData.skillUseName = trimmedLine.split(':')[1]?.trim().replace(/"/g, '') || '';
        }else if (trimmedLine.startsWith('DISPLAYNAMEID:')) {
            classData.DISPLAYNAMEID = trimmedLine.split(':')[1]?.trim() || null;
        } else if (trimmedLine.startsWith('DESCRIPTIONID:')) {
            classData.DESCRIPTIONID = trimmedLine.split(':')[1]?.trim() || null;
        } else if (trimmedLine.startsWith('ATTRIBUTE:')) {
            const attribute = trimmedLine.split(':')[1]?.trim()?.replace(/"/g, '');
            if (attribute) classData.attributes.push(attribute);
        } else if (trimmedLine.startsWith('ITEMCAT:')) {
            try {
                const parts = trimmedLine.split(',').map(s => s.trim());
                if (parts.length >= 3) {
                    const [category, type, style] = [parts[0].split(' ')[1], parts[1], parts[2]];
                    const cleanType = type.replace(/"/g, '');
                    const cleanStyle = style.replace(/"/g, '');
                    
                    switch (category.toLowerCase()) {
                        case 'weapon':
                            classData.weapons.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'armor':
                            classData.armors.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'helmet':
                            classData.helmets.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'shield':
                            classData.shields.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'accessory':
                            classData.accessories.push(`${cleanType} (${cleanStyle})`);
                            break;
                    }
                }
            } catch (error) {
                // Skip malformed ITEMCAT lines
                continue;
            }
        }
    }

    return classData.className ? classData : null;  // Only return if we have a valid class name
}

/**
 * Create an embed for a class
 * (From classes.js)
 */
function createClassEmbed(classData, currentPage, totalPages, modName) {
    const embed = new EmbedBuilder()
        .setTitle(classData.displayName)
        .setDescription(`Class in ${modName} (${currentPage + 1}/${totalPages})`)
        .setColor(0x00FF00);

    // Add description if available
    if (classData.description) {
        embed.addFields({ name: 'Description', value: classData.description });
    }

    // Add attributes
    if (classData.attributes.length > 0) {
        embed.addFields({ 
            name: 'Attributes', 
            value: classData.attributes.join(', ') 
        });
    }

    // Add equipment categories
    const categories = [
        { name: 'Weapons', items: classData.weapons },
        { name: 'Armor', items: classData.armors },
        { name: 'Helmets', items: classData.helmets },
        { name: 'Shields', items: classData.shields },
        { name: 'Accessories', items: classData.accessories }
    ];

    for (const category of categories) {
        if (category.items.length > 0) {
            embed.addFields({ 
                name: category.name, 
                value: category.items.join('\n'),
                inline: true 
            });
        }
    }

    return embed;
}

/**
 * Parse a skill chunk into a key-value object
 * (From skill.js)
 */
function parseSkillChunk(chunk) {
    const lines = chunk.trim().split(/\r?\n/);
    const skillData = {};
    for (const line of lines) {
        const lineTrimmed = line.trim();
        const match = lineTrimmed.match(/^(\w+):\s*(.+)$/);
        if (match) {
            const key = match[1].toUpperCase();
            let value = match[2].trim();

            // Remove surrounding quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            }

            // Store all values as arrays
            if (!skillData[key]) {
                skillData[key] = [];
            }
            skillData[key].push(value);
        }
    }
    return skillData;
}

/**
 * Find the original chunk for a skill
 * (From skill.js and events.js)
 */
function findOriginalChunk(skillData, skillsChunks) {
    if (!skillData['SKILLCREATE']) return '';
    
    const skillName = skillData['SKILLCREATE'][0];
    for (const chunk of skillsChunks) {
        if (chunk.includes('SKILLCREATE:') && chunk.includes(skillName)) {
            return chunk;
        }
    }
    return '';
}

/**
 * Collect all skills in a combo chain
 * (From skill.js and events.js)
 */
function collectComboChain(initialSkillData, skillsChunks) {
    const comboSkills = [];
    let currentSkill = initialSkillData;
    
    // First, check if this is a combo skill (has SKILLMETER with "Chain")
    if (currentSkill['SKILLMETER'] && currentSkill['SKILLMETER'][0].includes('Chain')) {
        comboSkills.push({ 
            skillData: currentSkill, 
            isInitial: true,
            chunk: findOriginalChunk(currentSkill, skillsChunks)
        });
        
        // Determine the maximum additional hits from the initial SKILLMETER
        let meterParts = currentSkill['SKILLMETER'][0].split(',').map(s => s.trim().replace(/"/g, ''));
        const maxAdditionalHits = meterParts.length >= 3 ? parseInt(meterParts[2], 10) - 1 : 0;
        
        // Follow the chain of subskills
        let hitNumber = 1;
        while (hitNumber <= maxAdditionalHits && currentSkill['SKILLSUBSKILL']) {
            const subSkillName = currentSkill['SKILLSUBSKILL'][0];
            let foundSubSkill = null;
            let foundChunk = null;
            
            // Find the subskill in the chunks
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const subSkillData = parseSkillChunk(chunk);
                    if (subSkillData['SKILLCREATE'] && 
                        subSkillData['SKILLCREATE'][0].includes(subSkillName)) {
                        foundSubSkill = subSkillData;
                        foundChunk = chunk;
                        break;
                    }
                }
            }
            
            if (!foundSubSkill) break;
            
            // Add the subskill to our chain
            comboSkills.push({ 
                skillData: foundSubSkill, 
                hitNumber: hitNumber + 1,
                chunk: foundChunk
            });
            
            currentSkill = foundSubSkill;
            hitNumber++;
        }
    }
    return comboSkills;
}

/**
 * Parse a generic chunk (item, shop, etc) into a key-value object
 * (From itemskill.js)
 */
function parseChunk(chunk) {
    const lines = chunk.trim().split(/\r?\n/);
    const data = {};
    for (const line of lines) {
        const lineTrimmed = line.trim();
        const match = lineTrimmed.match(/^(\w+):\s*(.+)$/);
        if (match) {
            const key = match[1].toUpperCase();
            let value = match[2].trim();

            // Remove surrounding quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            }

            // Store all values as arrays
            if (!data[key]) {
                data[key] = [];
            }
            data[key].push(value);
        }
    }
    return data;
}

/**
 * Create an embed for an item skill
 * (From itemskill.js)
 */
function createItemSkillEmbed(skill, currentPage, totalPages, modName) {
    const embed = new EmbedBuilder()
        .setTitle(`${skill.displayName || skill.skillName}`)
        .setDescription(`Item Skill in ${modName} (${currentPage + 1}/${totalPages})`)
        .setColor(0x0099FF);
    
    // Add skill data
    const skillLines = skill.chunk.split('\n');
    const formattedSkill = skillLines.map(line => line.trim()).join('\n');
    embed.addFields({ name: 'Skill Definition', value: `\`\`\`\n${formattedSkill}\`\`\`` });
    
    // Add items that grant this skill
    if (skill.items.length > 0) {
        const itemsList = skill.items.map(item => `- ${item.itemName}`).join('\n');
        embed.addFields({ 
            name: `Granted by ${skill.items.length} item(s)`, 
            value: itemsList.length > 1024 ? itemsList.substring(0, 1021) + '...' : itemsList 
        });
    } else {
        embed.addFields({ name: 'Items', value: 'No items found that grant this skill.' });
    }
    
    return embed;
}

/**
 * Load lookup text and build ID-to-text and name-to-ID maps
 */
function loadLookupText(lookupFilePath) {
    const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
    const lookupLines = lookupContent.split(/\r?\n/);
    
    const idToText = {};
    const nameToIds = {};
    
    for (const line of lookupLines) {
        if (!line.trim()) continue;
        const fields = line.split('^');
        if (fields.length < 2) continue;
        
        const id = parseInt(fields[0].trim());
        const text = fields[fields.length - 1].trim();
        
        // Store in ID-to-Text map
        idToText[id] = text;
        
        // Store in Text-to-IDs map (case insensitive)
        const lowerText = text.toLowerCase();
        if (!nameToIds[lowerText]) {
            nameToIds[lowerText] = [];
        }
        nameToIds[lowerText].push(id);
    }
    
    return { idToText, nameToIds };
}

/**
 * Get files paths for a mod
 */
function getModFilePaths(modName) {
    const baseUploadsPath = path.join(__dirname, '../../uploads');
    const modPath = path.join(baseUploadsPath, modName);
    
    return {
        modPath,
        lookupFilePath: path.join(modPath, 'data', 'config', 'lookuptext_eng.txt'),
        skillsFilePath: path.join(modPath, 'data', 'config', 'skills.tok'),
        itemsFilePath: path.join(modPath, 'data', 'config', 'items.tok'),
        classdefsPath: path.join(modPath, 'data', 'config', 'classdefs.tok'),
        shopsPath: path.join(modPath, 'data', 'towns', 'shops'),
        statsetsFilePath: path.join(modPath, 'data', 'units', 'statsets.txt'),
        gladiatorsFilePath: path.join(modPath, 'data', 'units', 'gladiators.txt')
    };
}

/**
 * Validate if required mod files exist
 */
function validateModFiles(paths, requiredFiles = ['lookupFilePath', 'skillsFilePath']) {
    for (const file of requiredFiles) {
        if (!fs.existsSync(paths[file])) {
            return false;
        }
    }
    return true;
}

/**
 * Split content into chunks based on empty line separator
 */
function splitContentIntoChunks(content) {
    return content.split(/\n\s*\n/);
}

module.exports = {
    sanitizeInput,
    parseClassChunk,
    createClassEmbed,
    parseSkillChunk,
    parseChunk,
    findOriginalChunk,
    collectComboChain,
    createItemSkillEmbed,
    loadLookupText,
    getModFilePaths,
    validateModFiles,
    splitContentIntoChunks
};
