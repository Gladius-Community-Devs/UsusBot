const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { splitFieldValue, addFieldsSafe } = require('../../core/js/text_utils.js');

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

            // Strip quotes only when the whole value is one quoted token; a
            // multi-argument line ("Name", "Type", ...) must keep its shape.
            if (value.length >= 2 && value.startsWith('"') && value.endsWith('"') && (value.match(/"/g) || []).length === 2) {
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

    const wanted = skillCreateName(skillData['SKILLCREATE'][0]).toLowerCase();
    for (const chunk of skillsChunks) {
        const match = chunk.match(/^SKILLCREATE:\s*"([^"]+)"/m);
        if (match && match[1].trim().toLowerCase() === wanted) return chunk;
    }
    return '';
}

/**
 * Collect all skills in a combo chain
 * (From skill.js and events.js)
 *
 * Name lookups are case-insensitive because the shipped data capitalises
 * sub-skill references inconsistently (Scarab RiposteSub -> Scarab RIposteSub).
 */
function collectComboChain(initialSkillData, skillsChunks) {
    const comboSkills = [];
    let currentSkill = initialSkillData;

    // First, check if this is a combo skill (has SKILLMETER with "Chain")
    if (currentSkill['SKILLMETER'] && currentSkill['SKILLMETER'][0].includes('Chain')) {
        const index = buildSkillIndex(skillsChunks);
        const initialName = skillCreateName(currentSkill['SKILLCREATE'] && currentSkill['SKILLCREATE'][0]).toLowerCase();

        comboSkills.push({ 
            skillData: currentSkill, 
            isInitial: true,
            chunk: (index.get(initialName) || {}).chunk || ''
        });
        
        // Determine the maximum additional hits from the initial SKILLMETER
        let meterParts = currentSkill['SKILLMETER'][0].split(',').map(s => s.trim().replace(/"/g, ''));
        const maxAdditionalHits = meterParts.length >= 3 ? parseInt(meterParts[2], 10) - 1 : 0;
        
        // Follow the chain of subskills
        let hitNumber = 1;
        while (hitNumber <= maxAdditionalHits && currentSkill['SKILLSUBSKILL']) {
            const subSkillName = String(currentSkill['SKILLSUBSKILL'][0] || '').replace(/"/g, '').trim().toLowerCase();
            const found = index.get(subSkillName);
            if (!found) break;
            
            // Add the subskill to our chain
            comboSkills.push({ 
                skillData: found.data, 
                hitNumber: hitNumber + 1,
                chunk: found.chunk
            });
            
            currentSkill = found.data;
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

            // Strip quotes only when the whole value is one quoted token; a
            // multi-argument line ("Name", "Type", ...) must keep its shape.
            if (value.length >= 2 && value.startsWith('"') && value.endsWith('"') && (value.match(/"/g) || []).length === 2) {
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
    
    // Add skill data, split across numbered fields when the definition exceeds
    // Discord's 1024-character field limit.
    const formattedSkill = skill.chunk.split('\n').map(line => line.trim()).join('\n');
    addFieldsSafe(embed, splitFieldValue(formattedSkill, { label: 'Skill Definition', codeBlock: true }));
    
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
 * Windows-1252 punctuation for the 0x80-0x9F range, which differs from latin1.
 * @type {Object<number, string>}
 */
const CP1252 = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
    0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
    0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
    0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
    0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
};

/**
 * Decode bytes as Windows-1252 (latin1 plus the 0x80-0x9F punctuation).
 * @param {Buffer} buffer
 * @returns {string}
 */
function decodeCp1252(buffer) {
    let text = '';
    for (const byte of buffer) {
        text += (byte >= 0x80 && byte <= 0x9F && CP1252[byte]) ? CP1252[byte] : String.fromCharCode(byte);
    }
    return text;
}

/**
 * Read a game data file with the encoding it was actually written in.
 *
 * The shipped text is cp1252 (Vanilla, Ragnarok, LeoMod) while VanillaPlus has
 * been converted to UTF-8, so a single fixed encoding is wrong either way.
 * Try strict UTF-8 first, fall back to cp1252. Reading a cp1252 file as UTF-8
 * turns every accented character into U+FFFD in user-facing text.
 *
 * @param {string} file
 * @returns {string}
 */
function readTextFile(file) {
    const buffer = fs.readFileSync(file);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
        return decodeCp1252(buffer);
    }
}

/**
 * Split a .tok file into records that each start at `starter`.
 *
 * Blank lines are cosmetic in these files and cannot be trusted as separators:
 * class blocks contain them internally and Ragnarok's skills.tok is missing one
 * between two skills. Splitting at the record opener tolerates both.
 *
 * @param {string} text
 * @param {RegExp} starter - anchored at the start of the opening line
 * @returns {string[]}
 */
function splitRecords(text, starter) {
    const records = [];
    let current = [];
    for (const line of String(text).split(/\r?\n/)) {
        if (current.length > 0 && starter.test(line)) {
            records.push(current.join('\n'));
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) records.push(current.join('\n'));
    return records.filter((record) => record.trim().length > 0);
}

const splitSkillRecords = (text) => splitRecords(text, /^SKILLCREATE:/);
const splitClassRecords = (text) => splitRecords(text, /^CREATECLASS:/);
const splitItemRecords = (text) => splitRecords(text, /^ITEMCREATE:/);

/**
 * The SKILLCREATE name, without the rest of the argument list or quote debris.
 * @param {string} value
 * @returns {string}
 */
function skillCreateName(value) {
    const raw = String(value || '');
    const quoted = /^"([^"]*)"/.exec(raw);
    if (quoted) return quoted[1].trim();
    return raw.split(',')[0].replace(/"/g, '').trim();
}

/**
 * Index skill records by their SKILLCREATE name, case-insensitively.
 *
 * Sub-skill references in the shipped data are not case-consistent
 * ("Scarab RiposteSub" -> "Scarab RIposteSub"), so a name lookup must be.
 *
 * @param {string[]} skillsChunks
 * @returns {Map<string, {data: object, chunk: string}>}
 */
function buildSkillIndex(skillsChunks) {
    const index = new Map();
    for (const chunk of skillsChunks) {
        if (!chunk.includes('SKILLCREATE:')) continue;
        const data = parseSkillChunk(chunk);
        const name = skillCreateName(data['SKILLCREATE'] && data['SKILLCREATE'][0]);
        if (!name) continue;
        const key = name.toLowerCase();
        if (!index.has(key)) index.set(key, { data, chunk });
    }
    return index;
}

/**
 * Load lookup text and build ID-to-text and name-to-ID maps
 */
function loadLookupText(lookupFilePath) {
    const lookupContent = readTextFile(lookupFilePath);
    const lookupLines = lookupContent.split(/\r?\n/);
    
    const idToText = {};
    const nameToIds = {};
    
    for (const line of lookupLines) {
        if (!line.trim() || line.trim().startsWith('//')) continue;
        const fields = line.split('^');
        if (fields.length < 2) continue;
        
        const id = Number.parseInt(fields[0].trim(), 10);
        if (!Number.isFinite(id)) continue;
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

function getGladiusDataRoot() {
    const configured = process.env.GLADIUS_DATA_ROOT || process.env.GLADIUS_GAME_DATA_PATH;
    if (!configured || !configured.trim()) {
        throw new Error('GLADIUS_DATA_ROOT is not set. Configure it in the bot environment.');
    }
    return path.resolve(configured);
}

function sanitizeModName(modName) {
    if (!modName || typeof modName !== 'string') return 'Vanilla';

    const normalized = path
        .basename(modName)
        .replace(/[^\w\s.-]/g, '')
        .trim()
        .replace(/\s+/g, '_');

    return normalized || 'Vanilla';
}

function getAvailableMods() {
    const dataRoot = getGladiusDataRoot();
    const mods = new Set();

    if (fs.existsSync(dataRoot)) {
        for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;

            const modName = entry.name;
            const configDir = path.join(dataRoot, modName, 'data', 'config');
            if (
                fs.existsSync(path.join(configDir, 'skills.tok')) &&
                fs.existsSync(path.join(configDir, 'lookuptext_eng.txt'))
            ) {
                mods.add(modName);
            }
        }
    }

    return Array.from(mods).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function resolveModName(requestedModName) {
    const requested = sanitizeModName(requestedModName || 'Vanilla');
    const availableMods = getAvailableMods();
    const matched = availableMods.find(mod => mod.toLowerCase() === requested.toLowerCase());
    return matched || requested;
}

function hasCoreSkillFiles(modPath) {
    const configDir = path.join(modPath, 'data', 'config');
    return (
        fs.existsSync(path.join(configDir, 'skills.tok')) &&
        fs.existsSync(path.join(configDir, 'lookuptext_eng.txt'))
    );
}

function resolveModPath(dataRoot, safeModName) {
    const candidates = [path.join(dataRoot, safeModName)];
    if (safeModName.includes('_')) {
        candidates.push(path.join(dataRoot, safeModName.replace(/_/g, ' ')));
    }

    for (const candidate of candidates) {
        if (hasCoreSkillFiles(candidate)) return candidate;
    }

    return candidates[0];
}

/**
 * Get files paths for a mod
 */
function getModFilePaths(modName) {
    const safeModName = sanitizeModName(modName);
    const dataRoot = getGladiusDataRoot();
        const modPath = resolveModPath(dataRoot, safeModName);
      return {
        modPath,
        lookupFilePath: path.join(modPath, 'data', 'config', 'lookuptext_eng.txt'),
        skillsFilePath: path.join(modPath, 'data', 'config', 'skills.tok'),
        itemsFilePath: path.join(modPath, 'data', 'config', 'items.tok'),
        classdefsPath: path.join(modPath, 'data', 'config', 'classdefs.tok'),
        prizesFilePath: path.join(modPath, 'data', 'config', 'prizes.tok'),
        shopsPath: path.join(modPath, 'data', 'towns', 'shops'),
        leaguesPath: path.join(modPath, 'data', 'towns', 'leagues'),
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
 * Split content into chunks based on empty line separator.
 *
 * Only for files that really are blank-line separated (gladiators, stat sets,
 * leagues). Skills, classes and items use splitSkillRecords / splitClassRecords
 * / splitItemRecords, because blank lines are cosmetic inside those records.
 */
function splitContentIntoChunks(content) {
    return content.split(/\n\s*\n/);
}

/**
 * Map a CREATECLASS name (lowercase) to its SKILLUSENAME (lowercase).
 *
 * Class autocompletes offer CREATECLASS names, but skills are filed under
 * SKILLUSENAME (ArcherF -> Archer, Jötunn -> Centurion), so a class filter has
 * to resolve one to the other before comparing.
 *
 * @param {string} classdefsFile
 * @returns {Map<string, string>}
 */
function loadClassUseMap(classdefsFile) {
    const map = new Map();
    if (!classdefsFile || !fs.existsSync(classdefsFile)) return map;
    for (const chunk of splitClassRecords(readTextFile(classdefsFile))) {
        const data = parseClassChunk(chunk);
        if (data && data.className && data.skillUseName) {
            map.set(data.className.toLowerCase(), data.skillUseName.replace(/"/g, '').trim().toLowerCase());
        }
    }
    return map;
}

/**
 * Class page title. A shared display name must carry the CREATECLASS code,
 * otherwise several pages are titled identically (Hero x8, Samnite x6, ...).
 * @param {string} displayName
 * @param {string} className
 * @param {Set<string>} [sharedNames]
 * @returns {string}
 */
function labelClass(displayName, className, sharedNames) {
    const display = displayName || className;
    if (sharedNames && sharedNames.has(display)) return `${display} (${className})`;
    return display;
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
    getGladiusDataRoot,
    sanitizeModName,
    getAvailableMods,
    resolveModName,
    getModFilePaths,
    validateModFiles,
    splitContentIntoChunks,
    readTextFile,
    splitRecords,
    splitSkillRecords,
    splitClassRecords,
    splitItemRecords,
    skillCreateName,
    buildSkillIndex,
    loadClassUseMap,
    labelClass
};

