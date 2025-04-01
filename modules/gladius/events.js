const { InteractionType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function onInteractionCreate(interaction) {
async function onInteractionCreate(interaction) {
    if (interaction.type !== InteractionType.MessageComponent) return;

    const customId = interaction.customId;

    // Log the interaction for debugging
    logger.info(`Processing interaction with customId: ${customId}`);

    // For dropdowns from the skill.js command
    if (customId.startsWith('class-select|')) {
        // Extract modName and skillName from customId
        const parts = customId.split('|');
        if (parts.length < 3) {
            await interaction.reply({ content: 'Invalid interaction data.', ephemeral: true });
            return;
        }

        const encodedModName = parts[1];
        const encodedSkillName = parts[2];

        const modName = decodeURIComponent(encodedModName);
        const skillName = decodeURIComponent(encodedSkillName);
        const selectedClassEncoded = interaction.values[0];
        const selectedClass = decodeURIComponent(selectedClassEncoded);

        // Sanitize inputs
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s'’-]/g, '').trim();
        };

        const modNameSanitized = path.basename(sanitizeInput(modName));
        const skillNameSanitized = sanitizeInput(skillName);
        const classNameSanitized = sanitizeInput(selectedClass);

        // Define file paths securely
        const baseUploadsPath = path.join(__dirname, '../../uploads');
        const modPath = path.join(baseUploadsPath, modNameSanitized);
        const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
        const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');

        // Check if files exist
        if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath)) {
            await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
            return;
        }

        try {
            // Collect all possible skill names and map them to entry IDs
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of skill names to entry IDs
            const skillNameToEntryIds = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(id);
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // Function to parse a skill chunk into a key-value object
            const parseSkillChunk = (chunk) => {
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
            };

            // Helper function to find the original chunk for a skill
            const findOriginalChunk = (skillData, skillsChunks) => {
                if (!skillData['SKILLCREATE']) return '';
                
                const skillName = skillData['SKILLCREATE'][0];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:') && chunk.includes(skillName)) {
                        return chunk;
                    }
                }
                return '';
            };
            
            // Function to collect all skills in a combo chain
            const collectComboChain = (initialSkillData, skillsChunks) => {
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
            };

            // Get all entry IDs for the skill name
            const entryIds = skillNameToEntryIds[skillNameSanitized.toLowerCase()] || [];

            if (entryIds.length === 0) {
                await interaction.reply({ content: `No skill named '${skillNameSanitized}' found in '${modNameSanitized}'.`, ephemeral: true });
                return;
            }

            // Collect matching skills for the selected class
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID'][0]))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) {
                            skillClasses = [skillClasses];
                        }
                        if (skillClasses.some(cls => cls.toLowerCase() === classNameSanitized.toLowerCase())) {
                            matchingSkills.push({
                                entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]),
                                chunk: chunk.trim(),
                                classNames: skillClasses,
                                skillData: skillData // Include skillData for later use
                            });
                        }
                    }
                }
            }

            if (matchingSkills.length === 0) {
                await interaction.reply({ content: `No skill data found for class '${classNameSanitized}'.`, ephemeral: true });
                return;
            }

            // Prepare the response
            let messages = [];
            let header = `Skill details for '${skillNameSanitized}' in '${modNameSanitized}' for class '${classNameSanitized}':\n\n`;
            let currentMessage = header;

            // Check for combo skills and include all chain parts in output
            for (const skill of matchingSkills) {
                // Get the skill data
                const skillData = skill.skillData;
                
                // Check if this is a combo skill
                const comboSkills = collectComboChain(skillData, skillsChunks);
                
                if (comboSkills.length > 1) { // Only treat as combo if there's more than one skill
                    // This is a combo skill, add header for combo chain
                    const comboHeader = `\n==== Combo Chain (${comboSkills.length} hits) ====\n\n`;
                    if (currentMessage.length + comboHeader.length > 2000) {
                        messages.push(currentMessage);
                        currentMessage = comboHeader;
                    } else {
                        currentMessage += comboHeader;
                    }
                    
                    // Add each skill in the combo chain
                    for (const comboSkill of comboSkills) {
                        const hitText = comboSkill.isInitial ? 'Initial Hit' : `Hit #${comboSkill.hitNumber}`;
                        const skillText = `=== ${hitText} ===\n\`\`\`\n${comboSkill.chunk.trim()}\n\`\`\`\n\n`;
                        
                        if (currentMessage.length + skillText.length > 2000) {
                            messages.push(currentMessage);
                            currentMessage = skillText;
                        } else {
                            currentMessage += skillText;
                        }
                    }
                } else {
                    // Regular non-combo skill
                    const skillText = `\`\`\`\n${skill.chunk}\n\`\`\`\n\n`;
                    if (currentMessage.length + skillText.length > 2000) {
                        messages.push(currentMessage);
                        currentMessage = skillText;
                    } else {
                        currentMessage += skillText;
                    }
                }
            }

            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Defer update to acknowledge the interaction without sending a new reply
            await interaction.deferUpdate();

            // Edit the original message with the updated content and retain the dropdown menus
            await interaction.editReply({ content: messages[0], components: interaction.message.components });

            // Send follow-up messages if the content exceeds the character limit of a single message
            for (let i = 1; i < messages.length; i++) {
                await interaction.followUp({ content: messages[i], ephemeral: false });
            }
        } catch (error) {
            this.logger.error('Error processing the interaction:', error);
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    }
    
    // For dropdowns from the explain.js command
    else if (customId.startsWith('explain-select|')) {
        // Extract modName and skillName from customId
        const parts = customId.split('|');
        if (parts.length < 3) {
            await interaction.reply({ content: 'Invalid interaction data.', ephemeral: true });
            return;
        }

        const encodedModName = parts[1];
        const encodedSkillName = parts[2];

        const modName = decodeURIComponent(encodedModName);
        const skillName = decodeURIComponent(encodedSkillName);
        const selectedClassEncoded = interaction.values[0];
        const selectedClass = decodeURIComponent(selectedClassEncoded);

        // Sanitize inputs
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        const modNameSanitized = path.basename(sanitizeInput(modName));
        const skillNameSanitized = sanitizeInput(skillName);
        const classNameSanitized = sanitizeInput(selectedClass);

        // Define file paths securely
        const baseUploadsPath = path.join(__dirname, '../../uploads');
        const modPath = path.join(baseUploadsPath, modNameSanitized);
        const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
        const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');

        // Check if files exist
        if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath)) {
            await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
            return;
        }

        try {
            // Get the explain.js command module to access its functions
            const explainCommand = require('./commands/explain');
            const parseSkillChunk = (chunk) => {
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
                        // Keys that can have multiple values
                        const multiValueKeys = [
                            'SKILLATTRIBUTE',
                            'SKILLSTATUS',
                            'SKILLEFFECT',
                            'SKILLUSECLASS',
                            'SKILLMULTIHITDATA',
                            'SKILLEFFECTCONDITION'
                        ];
                        if (multiValueKeys.includes(key)) {
                            if (skillData[key]) {
                                if (Array.isArray(skillData[key])) {
                                    skillData[key].push(value);
                                } else {
                                    skillData[key] = [skillData[key], value];
                                }
                            } else {
                                skillData[key] = value;
                            }
                        } else {
                            skillData[key] = value;
                        }
                    }
                }
                return skillData;
            };

            // Read the lookuptext file for skill names
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);
            const lookupTextMap = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0].trim();
                const text = fields[fields.length - 1].trim();
                lookupTextMap[id] = text;
            }

            // Get all entry IDs for the skill name
            const skillNameToEntryIds = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(id);
            }

            const entryIds = skillNameToEntryIds[skillNameSanitized.toLowerCase()] || [];

            if (entryIds.length === 0) {
                await interaction.reply({ content: `No skill named '${skillNameSanitized}' found in '${modNameSanitized}'.`, ephemeral: true });
                return;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // Collect matching skills for the selected class
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID']))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) {
                            skillClasses = [skillClasses];
                        }
                        if (skillClasses.some(cls => cls.toLowerCase() === classNameSanitized.toLowerCase())) {
                            matchingSkills.push({
                                entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
                                chunk: chunk.trim(),
                                classNames: skillClasses,
                                skillData: skillData // Include skillData for later use
                            });
                        }
                    }
                }
            }

            if (matchingSkills.length === 0) {
                await interaction.reply({ content: `No skill data found for class '${classNameSanitized}'.`, ephemeral: true });
                return;
            }

            // Generate skill descriptions
            let messages = [];
            // Updated header with specific skill command that includes the selected class
            let header = `This is **WIP** and is missing some details beyond damage numbers. For more info try **;skill ${modNameSanitized !== 'Vanilla' ? modNameSanitized + ' ' : ''}${classNameSanitized} ${skillNameSanitized}**\n\n\nSkill details for '${skillNameSanitized}' in '${modNameSanitized}' for class '${classNameSanitized}':\n\n`;
            let currentMessage = header;

            for (const skill of matchingSkills) {
                // Use the generateSkillDescription function from explain.js
                const skillDescription = explainCommand.generateSkillDescription(skill.skillData, lookupTextMap, skillsChunks);
                const skillText = `${skillDescription}\n`;
                if (currentMessage.length + skillText.length > 2000) {
                    messages.push(currentMessage);
                    currentMessage = skillText;
                } else {
                    currentMessage += skillText;
                }
            }

            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Defer update to acknowledge the interaction without sending a new reply
            await interaction.deferUpdate();

            // Edit the original message with the updated content and retain the dropdown menus
            await interaction.editReply({ content: messages[0], components: interaction.message.components });

            // Send follow-up messages if the content exceeds the character limit of a single message
            for (let i = 1; i < messages.length; i++) {
                await interaction.followUp({ content: messages[i], ephemeral: false });
            }
        } catch (error) {
            console.error('Error processing the interaction:', error);
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    }
    
    // For itemskill pagination buttons
    else if (customId.startsWith('itemskill-prev|') || customId.startsWith('itemskill-next|') || customId.startsWith('itemskill-shops|') || customId.startsWith('itemskill-shops-byname|')) {
        // Parse the custom ID to get information
        const parts = customId.split('|');
        if (parts.length < 3) {
            await interaction.reply({ content: 'Invalid interaction data.', ephemeral: true });
            return;
        }
        
        const action = parts[0]; // Action type
        const modName = parts[1];
        
        // Different handling based on action type
        let currentPage = 0;
        let skillName = null;
        
        if (action === 'itemskill-shops-byname') {
            // This is a direct skill lookup by name
            skillName = decodeURIComponent(parts[2]);
        } else {
            // This is a pagination action with page number
            const currentPageStr = parts[2];
            currentPage = parseInt(currentPageStr);
            if (isNaN(currentPage)) {
                await interaction.reply({ content: 'Invalid page number.', ephemeral: true });
                return;
            }
        }
        
        // Calculate the new page for prev/next actions
        let newPage = currentPage;
        if (action === 'itemskill-prev') {
            newPage = currentPage - 1;
        } else if (action === 'itemskill-next') {
            newPage = currentPage + 1;
        }
        
        try {
            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');
            const itemsFilePath = path.join(modPath, 'data', 'config', 'items.tok');
            const shopsPath = path.join(modPath, 'data', 'towns', 'shops');
            
            // Check if files exist
            if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath) || !fs.existsSync(itemsFilePath)) {
                await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
                return;
            }
            
            // Load lookup text
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of entry IDs to names
            const entryIdToName = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim();
                entryIdToName[id] = name;
            }
            
            // Function to parse a chunk into a key-value object
            const parseChunk = (chunk) => {
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
            };
            
            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);
            
            // Read the items.tok file
            const itemsContent = fs.readFileSync(itemsFilePath, 'utf8');
            const itemsChunks = itemsContent.split(/\n\s*\n/);
            
            // Find all item skills
            const itemSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseChunk(chunk);
                    if (skillData['SKILLCREATE'] && skillData['SKILLCREATE'][0].includes('Item ')) {
                        const skillName = skillData['SKILLCREATE'][0].split(',')[0].trim().replace(/"/g, '');
                        
                        // Get display name
                        const displayNameId = skillData['SKILLDISPLAYNAMEID'] ? parseInt(skillData['SKILLDISPLAYNAMEID'][0]) : null;
                        const displayName = displayNameId && entryIdToName[displayNameId] ? entryIdToName[displayNameId] : skillName;
                        
                        itemSkills.push({
                            skillName,
                            displayName,
                            chunk,
                            items: [] // Will be populated later
                        });
                    }
                }
            }
            
            // Associate items with skills
            for (const chunk of itemsChunks) {
                if (chunk.includes('ITEMCREATE:')) {
                    const itemData = parseChunk(chunk);
                    if (itemData['ITEMSKILL'] && itemData['ITEMSKILL'].length > 0) {
                        const itemSkillName = itemData['ITEMSKILL'][0].trim().replace(/"/g, '');
                        
                        // Find the matching skill
                        const matchingSkill = itemSkills.find(skill => 
                            skill.skillName === itemSkillName ||
                            skill.skillName === `Item ${itemSkillName}`
                        );
                        
                        if (matchingSkill) {
                            const displayNameId = itemData['ITEMDISPLAYNAMEID'] ? parseInt(itemData['ITEMDISPLAYNAMEID'][0]) : null;
                            const itemName = displayNameId && entryIdToName[displayNameId] 
                                ? entryIdToName[displayNameId] 
                                : (itemData['ITEMCREATE'] ? itemData['ITEMCREATE'][0].split(',')[0].trim().replace(/"/g, '') : 'Unknown');
                            
                            matchingSkill.items.push({
                                itemName,
                                itemData,
                                chunk
                            });
                        }
                    }
                }
            }
            
            // Filter to only include skills that have items granting them
            const skillsWithItems = itemSkills.filter(skill => skill.items.length > 0);
            
            // Sort skills alphabetically
            skillsWithItems.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            const totalPages = skillsWithItems.length;
            
            // Handle the "Locate Shop" button action
            if (action === 'itemskill-shops' || action === 'itemskill-shops-byname') {
                // Get the current skill
                let currentSkill;
                
                if (action === 'itemskill-shops-byname') {
                    // Find the skill by name
                    currentSkill = skillsWithItems.find(skill => 
                        skill.skillName === skillName || 
                        skill.displayName === skillName);
                    
                    if (!currentSkill) {
                        await interaction.reply({ 
                            content: `Could not find the skill "${skillName}" in ${modName}.`, 
                            ephemeral: true 
                        });
                        return;
                    }
                } else {
                    // Get skill by index/page number
                    if (currentPage < 0 || currentPage >= skillsWithItems.length) {
                        await interaction.reply({ content: 'Invalid skill index.', ephemeral: true });
                        return;
                    }
                    currentSkill = skillsWithItems[currentPage];
                }
                
                if (currentSkill.items.length === 0) {
                    await interaction.reply({ content: 'This skill is not granted by any items.', ephemeral: true });
                    return;
                }
                
                // Defer reply since shop searching might take time
                await interaction.deferReply();
                
                // Check if shops directory exists
                if (!fs.existsSync(shopsPath)) {
                    await interaction.editReply({ content: `The shop files directory does not exist for this mod.` });
                    return;
                }
                
                // Get all shop files
                const shopFiles = fs.readdirSync(shopsPath).filter(file => file.endsWith('.tok'));
                
                // Function to extract raw item name from ITEMCREATE line
                const extractRawItemName = (itemData) => {
                    if (itemData && itemData['ITEMCREATE'] && itemData['ITEMCREATE'].length > 0) {
                        // Get first part of the ITEMCREATE value (the name)
                        const createLine = itemData['ITEMCREATE'][0];
                        const match = createLine.match(/^"([^"]+)"/);
                        if (match && match[1]) {
                            return match[1]; // Return the raw item name without quotes
                        }
                    }
                    return null;
                };
                
                // Find all items that could be in shops
                const itemsToSearch = [];
                
                // For each item that grants this skill, get its raw name to search for
                for (const item of currentSkill.items) {
                    const rawItemName = extractRawItemName(item.itemData);
                    if (rawItemName) {
                        itemsToSearch.push({
                            displayName: item.itemName,
                            rawName: rawItemName
                        });
                    } else {
                        // If we couldn't extract a raw name, use the display name as fallback
                        itemsToSearch.push({
                            displayName: item.itemName,
                            rawName: item.itemName
                        });
                    }
                }
                
                // Find all items in all shops
                const foundItems = [];
                
                // Check each shop file
                for (const shopFile of shopFiles) {
                    const shopFilePath = path.join(shopsPath, shopFile);
                    try {
                        const shopContent = fs.readFileSync(shopFilePath, 'utf8');
                        
                        // Extract shop name
                        let shopName = shopFile.replace('.tok', '');
                        const nameMatch = shopContent.match(/NAME\s+"([^"]+)"/);
                        if (nameMatch && nameMatch[1]) {
                            shopName = nameMatch[1];
                        }
                        
                        // Find all item entries in the shop
                        const itemRegex = /ITEM\s+"([^"]+)"/ig;
                        let match;
                        
                        // Reset regex lastIndex
                        itemRegex.lastIndex = 0;
                        
                        // For each item entry in the shop
                        while ((match = itemRegex.exec(shopContent)) !== null) {
                            const shopItemName = match[1];
                            
                            // Check if this is any of our items or a variant
                            for (const searchItem of itemsToSearch) {
                                if (shopItemName === searchItem.rawName || 
                                    (shopItemName.endsWith(searchItem.rawName) && 
                                     shopItemName.length > searchItem.rawName.length)) {
                                    
                                    // Record this specific item and its shop
                                    foundItems.push({
                                        exactName: shopItemName,
                                        baseItem: searchItem.displayName,
                                        shopName: shopName
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error reading shop file ${shopFile}:`, error);
                    }
                }
                
                // Group items by their base name for display
                const groupedItems = new Map(); // Map<baseItemName, Map<exactName, shops[]>>
                
                for (const foundItem of foundItems) {
                    // Get or initialize the group for this base item
                    if (!groupedItems.has(foundItem.baseItem)) {
                        groupedItems.set(foundItem.baseItem, new Map());
                    }
                    
                    // Get or initialize the shops list for this exact item
                    const itemVariants = groupedItems.get(foundItem.baseItem);
                    if (!itemVariants.has(foundItem.exactName)) {
                        itemVariants.set(foundItem.exactName, []);
                    }
                    
                    // Add this shop to the item's shop list if not already present
                    const shops = itemVariants.get(foundItem.exactName);
                    if (!shops.includes(foundItem.shopName)) {
                        shops.push(foundItem.shopName);
                    }
                }
                
                // Find all items we were searching for that weren't found in any shop
                for (const item of currentSkill.items) {
                    const itemName = item.itemName;
                    
                    // If this item wasn't found at all, add an empty entry
                    if (!groupedItems.has(itemName)) {
                        groupedItems.set(itemName, new Map());
                    }
                }
                
                // Prepare response message
                let embed = new EmbedBuilder()
                    .setTitle(`Shop Locations for ${currentSkill.displayName || currentSkill.skillName}`)
                    .setDescription(`Shops selling items that grant this skill in ${modName}`)
                    .setColor(0x00AAFF);
                
                // Convert the grouped items to fields in the embed
                for (const [baseItemName, variants] of groupedItems.entries()) {
                    let fieldValue = '';
                    
                    if (variants.size === 0) {
                        // Item not found in any shop
                        fieldValue = 'Not sold in any shops (may be a drop or league reward)';
                    } else {
                        // List each variant with its shops without repeating the base name
                        for (const [exactName, shops] of variants.entries()) {
                            // For variants, just show the variant name without redundancy
                            if (exactName !== baseItemName) {
                                fieldValue += `**${exactName}**:\n`;
                            }
                            
                            if (shops.length > 0) {
                                fieldValue += shops.map(shop => `• ${shop}`).join('\n');
                                // Only add a single newline between items for more compact display
                                fieldValue += '\n';
                            } else {
                                fieldValue += '• Not sold in any shops\n';
                            }
                        }
                    }
                    
                    // Truncate if too long
                    if (fieldValue.length > 1024) {
                        fieldValue = fieldValue.substring(0, 1021) + '...';
                    }
                    
                    // Add field to embed
                    embed.addFields({
                        name: baseItemName,
                        value: fieldValue || 'Not found in any shops'
                    });
                }
                
                // Send the response
                await interaction.editReply({ embeds: [embed] });
                return;
            }
            
            // Check if the new page is valid for prev/next navigation
            if (newPage < 0 || newPage >= totalPages) {
                await interaction.reply({ content: 'Invalid page number. No more pages in that direction.', ephemeral: true });
                return;
            }
            
            // Helper function to create embed for a skill
            function createSkillEmbed(skill, currentPage, totalPages, modName) {
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
            
            // Get the skill for the new page
            const currentSkill = skillsWithItems[newPage];
            
            // Create the updated embed
            const embed = createSkillEmbed(currentSkill, newPage, totalPages, modName);
            
            // Update the buttons - now with three buttons including "Locate Shop"
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`itemskill-prev|${modName}|${newPage}`)
                        .setLabel('◀️ Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`itemskill-next|${modName}|${newPage}`)
                        .setLabel('Next ▶️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage === totalPages - 1),
                    new ButtonBuilder()
                        .setCustomId(`itemskill-shops|${modName}|${newPage}`)
                        .setLabel('🏪 Locate Shop')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(currentSkill.items.length === 0)
                );
            
            // Update the message
            await interaction.update({ embeds: [embed], components: [row] });
            
        } catch (error) {
            console.error('Error handling itemskill pagination:', error);
            await interaction.reply({ content: 'An error occurred while handling the itemskill command pagination.', ephemeral: true });
        }
    }
    
    // For learnable skills pagination and explanation
    else if (customId.startsWith('learnable-skills|') || 
             customId.startsWith('class-skills|') ||      // Add this line to handle both prefixes
             customId.startsWith('learnable-page|') || 
             customId.startsWith('learnable-explain|')) {
        
        // Normalize the action prefix for consistent handling
        const parts = customId.split('|');
        const action = parts[0].replace('class-skills', 'learnable-skills');  // Normalize the action
        const modName = parts[1];
        const className = parts[2];
        
        logger.info(`Learnable skills action: ${action} for mod: ${modName}, class: ${className}`);
        
        let currentPage = 0;
        let skillName = null;
        
        // Determine the action type and extract additional parameters
        if (action === 'learnable-skills') {
            // Initial request, page defaults to 0
            currentPage = 0;
        } else if (action === 'learnable-page') {
            // Page navigation
            currentPage = parseInt(parts[3]) || 0;
        } else if (action === 'learnable-explain') {
            // Explain a specific skill
            skillName = decodeURIComponent(parts[3]);
        }
        
        try {
            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');
            
            // Check if files exist
            if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath)) {
                await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
                return;
            }
            
            // Load lookup text
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of entry IDs to names
            const idToText = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const text = fields[fields.length - 1].trim();
                idToText[id] = text;
            }
            
            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);
            
            // Function to parse a skill chunk into a key-value object
            const parseSkillChunk = (chunk) => {
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
            };

            // Helper function to find the original chunk for a skill
            const findOriginalChunk = (skillData, skillsChunks) => {
                if (!skillData['SKILLCREATE']) return '';
                
                const skillName = skillData['SKILLCREATE'][0];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:') && chunk.includes(skillName)) {
                        return chunk;
                    }
                }
                return '';
            };
            
            // Function to collect all skills in a combo chain
            const collectComboChain = (initialSkillData, skillsChunks) => {
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
            };
            
            // For the "Explain" action, generate detailed skill description
            if (action === 'learnable-explain' && skillName) {
                const explainCommand = require('./commands/explain');
                
                // Find the skill with the given name for this class
                let matchingSkill = null;
                
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = parseSkillChunk(chunk);
                        const displayNameId = skillData['SKILLDISPLAYNAMEID'] ? parseInt(skillData['SKILLDISPLAYNAMEID'][0]) : null;
                        const displayName = displayNameId && idToText[displayNameId] ? idToText[displayNameId] : null;
                        
                        // Check if it matches the skill name and class
                        if (displayName && displayName.toLowerCase() === skillName.toLowerCase()) {
                            let skillClasses = skillData['SKILLUSECLASS'] || [];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            
                            if (skillClasses.some(cls => cls.toLowerCase() === className.toLowerCase())) {
                                matchingSkill = {
                                    skillData,
                                    chunk
                                };
                                break;
                            }
                        }
                    }
                }
                
                if (!matchingSkill) {
                    await interaction.reply({ 
                        content: `Could not find skill "${skillName}" for class "${className}" in ${modName}.`, 
                        ephemeral: true 
                    });
                    return;
                }
                
                // Generate the skill description
                const skillDescription = explainCommand.generateSkillDescription(matchingSkill.skillData, idToText, skillsChunks);
                
                // Create an embed for the skill explanation
                const embed = new EmbedBuilder()
                    .setTitle(`${skillName} (${className})`)
                    .setDescription(skillDescription)
                    .setColor(0x00AAFF)
                    .setFooter({ text: `Mod: ${modName}` });
                
                // Create a button to go back to the learnable skills list
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`learnable-page|${modName}|${className}|${currentPage}`)
                            .setLabel('Back to Learnable Skills')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                // Reply with the embed
                await interaction.reply({ embeds: [embed], components: [row] });
                return;
            }
            
            // Find all learnable skills for this class
            const learnableSkills = [];
            
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    
                    // Check if this skill is usable by the class
                    let skillClasses = skillData['SKILLUSECLASS'] || [];
                    if (!Array.isArray(skillClasses)) {
                        skillClasses = [skillClasses];
                    }
                    
                    if (skillClasses.some(cls => cls.toLowerCase() === className.toLowerCase())) {
                        // Get the display name
                        const displayNameId = skillData['SKILLDISPLAYNAMEID'] ? parseInt(skillData['SKILLDISPLAYNAMEID'][0]) : null;
                        const displayName = displayNameId && idToText[displayNameId] ? idToText[displayNameId] : 'Unknown Skill';
                        
                        // Extract skill creation info
                        let skillType = '';
                        let skillCategory = '';
                        if (skillData['SKILLCREATE'] && skillData['SKILLCREATE'][0]) {
                            const createParts = skillData['SKILLCREATE'][0].split(',');
                            if (createParts.length >= 3) {
                                skillType = createParts[1].trim().replace(/"/g, '');
                                skillCategory = createParts[2].trim().replace(/"/g, '');
                            }
                        }
                        
                        // Add the skill to our list
                        learnableSkills.push({
                            name: displayName,
                            type: skillType,
                            category: skillCategory,
                            chunk: chunk,
                            skillData
                        });
                    }
                }
            }
            
            // Sort skills alphabetically by name
            learnableSkills.sort((a, b) => a.name.localeCompare(b.name));
            
            // Calculate pagination
            const itemsPerPage = 5;
            const pageCount = Math.ceil(learnableSkills.length / itemsPerPage);
            
            // Validate current page
            if (currentPage < 0) currentPage = 0;
            if (currentPage >= pageCount) currentPage = pageCount - 1;
            
            // Get skills for the current page
            const startIdx = currentPage * itemsPerPage;
            const endIdx = Math.min(startIdx + itemsPerPage, learnableSkills.length);
            const currentSkills = learnableSkills.slice(startIdx, endIdx);
            
            // Create embed with skill list
            const embed = new EmbedBuilder()
                .setTitle(`Learnable Skills for ${className}`)
                .setDescription(`Skills that can be learned by ${className} in ${modName} (Page ${currentPage + 1}/${pageCount})`)
                .setColor(0x3498db);
            
            // Add each skill to the embed
            for (const skill of currentSkills) {
                // Create a short description
                let description = '';
                
                // Add skill type and category if available
                if (skill.type && skill.category) {
                    description += `**Type:** ${skill.type} (${skill.category})\n`;
                }
                
                // Add JP cost if available
                if (skill.skillData['SKILLJOBPOINTCOST'] && skill.skillData['SKILLJOBPOINTCOST'][0]) {
                    description += `**JP Cost:** ${skill.skillData['SKILLJOBPOINTCOST'][0]}\n`;
                }
                
                // Add skill costs if available
                if (skill.skillData['SKILLCOSTS'] && skill.skillData['SKILLCOSTS'][0]) {
                    const costsParts = skill.skillData['SKILLCOSTS'][0].split(',').map(part => part.trim());
                    const turns = costsParts[0];
                    description += `**Turns:** ${turns}\n`;
                }
                
                // Add field to embed
                embed.addFields({ 
                    name: skill.name, 
                    value: description || 'No additional information available'
                });
            }
            
            // Create pagination buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`learnable-page|${modName}|${className}|${Math.max(0, currentPage - 1)}`)
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`learnable-page|${modName}|${className}|${Math.min(pageCount - 1, currentPage + 1)}`)
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === pageCount - 1)
                );
            
            // Add explain buttons for each skill on this page
            const explainRow = new ActionRowBuilder();
            for (let i = 0; i < currentSkills.length; i++) {
                explainRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`learnable-explain|${modName}|${className}|${encodeURIComponent(currentSkills[i].name)}`)
                        .setLabel(`Explain ${currentSkills[i].name}`)
                        .setStyle(ButtonStyle.Secondary)
                );
                
                // Discord only allows 5 buttons per row
                if (i === 4) break;
            }
            
            // Determine components to include
            const components = [row];
            if (currentSkills.length > 0) {
                components.push(explainRow);
            }
            
            // Send response based on the action type
            if (action === 'learnable-skills') {
                // First time invocation - reply with a new message
                await interaction.reply({ 
                    embeds: [embed], 
                    components
                });
            } else {
                // Update existing message
                await interaction.update({ 
                    embeds: [embed], 
                    components
                });
            }
            
        } catch (error) {
            logger.error('Error handling learnable skills:', error);
            
            // More detailed error handling
            try {
                await interaction.reply({ 
                    content: 'An error occurred while processing learnable skills.', 
                    ephemeral: true 
                });
            } catch (replyError) {
                // If replying fails (e.g., interaction already replied to), try to update instead
                logger.error('Failed to reply to interaction:', replyError);
                try {
                    await interaction.update({ 
                        content: 'An error occurred while processing learnable skills.',
                        components: [] 
                    });
                } catch (updateError) {
                    logger.error('Failed to update interaction:', updateError);
                    // At this point we can't do much else
                }
            }
        }
    }
    
    // New branch for class pagination buttons (prev/next)
    else if (customId.startsWith('class-prev|') || customId.startsWith('class-next|')) {
        const parts = customId.split('|');
        const action = parts[0]; // "class-prev" or "class-next"
        const modName = parts[1];
        const currentPage = parseInt(parts[2], 10);
        const newPage = action === 'class-prev' ? currentPage - 1 : currentPage + 1;

        try {
            // Inline helper: read mod files and build class list
            const baseUploadsPath = path.join(__dirname, '../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const classdefsPath = path.join(modPath, 'data', 'config', 'classdefs.tok');
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');

            if (!fs.existsSync(classdefsPath) || !fs.existsSync(lookupFilePath)) {
                await interaction.reply({ content: `Required files are missing for mod '${modName}'.`, ephemeral: true });
                return;
            }
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const classdefsContent = fs.readFileSync(classdefsPath, 'utf8');

            // Build lookup table
            const entryIdToText = {};
            lookupContent.split(/\r?\n/).filter(line => line.trim()).forEach(line => {
                if (!line.includes('^')) return;
                const parts = line.split('^');
                if (parts.length >= 2) {
                    const id = parts[0].trim();
                    const text = parts[parts.length - 1].trim();
                    entryIdToText[id] = text;
                }
            });

            // Parse class definitions (minimal parsing)
            let classesList = [];
            const classChunks = classdefsContent.split(/\nCREATECLASS:/);
            for (let rawChunk of classChunks) {
                let chunk = rawChunk.trim();
                if (!chunk) continue;
                if (!chunk.startsWith('CREATECLASS:')) {
                    chunk = 'CREATECLASS:' + chunk;
                }
                const lines = chunk.split(/\r?\n/);
                let className = '';
                let displayNameId = null;
                let descriptionId = null;
                // Also include arrays for additional details to mimic complete output
                let attributes = [];
                let weapons = [];
                let armors = [];
                let helmets = [];
                let shields = [];
                let accessories = [];
                for (const l of lines) {
                    const trimmed = l.trim();
                    if (trimmed.startsWith('CREATECLASS:')) {
                        className = trimmed.split(':')[1]?.trim() || '';
                    } else if (trimmed.startsWith('DISPLAYNAMEID:')) {
                        displayNameId = trimmed.split(':')[1]?.trim() || null;
                    } else if (trimmed.startsWith('DESCRIPTIONID:')) {
                        descriptionId = trimmed.split(':')[1]?.trim() || null;
                    } else if (trimmed.startsWith('ATTRIBUTE:')) {
                        const attribute = trimmed.split(':')[1]?.trim()?.replace(/"/g, '');
                        if (attribute) attributes.push(attribute);
                    } else if (trimmed.startsWith('ITEMCAT:')) {
                        try {
                            const parts = trimmed.split(',').map(s => s.trim());
                            if (parts.length >= 3) {
                                const [category, type, style] = [parts[0].split(' ')[1], parts[1], parts[2]];
                                const cleanType = type.replace(/"/g, '');
                                const cleanStyle = style.replace(/"/g, '');
                                
                                switch (category.toLowerCase()) {
                                    case 'weapon':
                                        weapons.push(`${cleanType} (${cleanStyle})`);
                                        break;
                                    case 'armor':
                                        armors.push(`${cleanType} (${cleanStyle})`);
                                        break;
                                    case 'helmet':
                                        helmets.push(`${cleanType} (${cleanStyle})`);
                                        break;
                                    case 'shield':
                                        shields.push(`${cleanType} (${cleanStyle})`);
                                        break;
                                    case 'accessory':
                                        accessories.push(`${cleanType} (${cleanStyle})`);
                                        break;
                                }
                            }
                        } catch (error) {
                            // Skip malformed ITEMCAT lines
                        }
                    }
                }
                if (className) {
                    const displayName = displayNameId ? (entryIdToText[displayNameId] || className) : className;
                    classesList.push({ 
                        className, 
                        displayName, 
                        description: descriptionId ? (entryIdToText[descriptionId] || ''), 
                        attributes, weapons, armors, helmets, shields, accessories 
                    });
                }
            }
            classesList.sort((a, b) => a.displayName.localeCompare(b.displayName));

            if (classesList.length === 0) {
                await interaction.reply({ content: `No classes found for mod '${modName}'.`, ephemeral: true });
                return;
            }
            if (newPage < 0 || newPage >= classesList.length) {
                await interaction.reply({ content: 'Invalid page number.', ephemeral: true });
                return;
            }

            // Local helper to create the full embed (replicating ;classes command output)
            const createClassEmbed = (classData, currentPage, totalPages, modName) => {
                const embed = new EmbedBuilder()
                    .setTitle(classData.displayName)
                    .setDescription(`Class in ${modName} (${currentPage + 1}/${totalPages})`)
                    .setColor(0x00FF00);

                if (classData.description) {
                    embed.addFields({ name: 'Description', value: classData.description });
                }

                if (classData.attributes.length > 0) {
                    embed.addFields({ 
                        name: 'Attributes', 
                        value: classData.attributes.join(', ') 
                    });
                }

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
            };

            const embed = createClassEmbed(classesList[newPage], newPage, classesList.length, modName);

            // Rebuild navigation buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`class-prev|${modName}|${newPage}`)
                        .setLabel('◀️ Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`class-next|${modName}|${newPage}`)
                        .setLabel('Next ▶️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage === classesList.length - 1),
                    new ButtonBuilder()
                        .setCustomId(`class-skills|${modName}|${encodeURIComponent(classesList[newPage].className)}`)
                        .setLabel('📚 Learnable Skills')
                        .setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ embeds: [embed], components: [row] });
        } catch (error) {
            logger.error('Error handling class pagination:', error);
            await interaction.reply({ content: 'An error occurred while processing the request.', ephemeral: true });
        }
    }
}

function register_handlers(event_registry) {
    // Store reference to the logger
    logger = event_registry.logger;
    
    // Register the handler
    event_registry.register('interactionCreate', onInteractionCreate);
}

module.exports = register_handlers;
