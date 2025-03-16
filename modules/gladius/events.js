const { InteractionType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function onInteractionCreate(interaction) {
    if (interaction.type !== InteractionType.MessageComponent) return;

    const customId = interaction.customId;

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
        if (!fs.existsSync(lookupFilePath) || !fs.exists(skillsFilePath)) {
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
        if (!fs.existsSync(lookupFilePath) || !fs.exists(skillsFilePath)) {
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
    else if (customId.startsWith('itemskill-prev|') || customId.startsWith('itemskill-next|') || customId.startsWith('itemskill-shops|')) {
        // Parse the custom ID to get information
        const parts = customId.split('|');
        if (parts.length < 3) {
            await interaction.reply({ content: 'Invalid interaction data.', ephemeral: true });
            return;
        }
        
        const action = parts[0]; // Either 'itemskill-prev', 'itemskill-next', or 'itemskill-shops'
        const modName = parts[1];
        const currentPageStr = parts[2];
        
        let currentPage = parseInt(currentPageStr);
        if (isNaN(currentPage)) {
            await interaction.reply({ content: 'Invalid page number.', ephemeral: true });
            return;
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
            if (action === 'itemskill-shops') {
                // Check if there are items to locate in shops
                if (currentPage < 0 || currentPage >= skillsWithItems.length) {
                    await interaction.reply({ content: 'Invalid skill index.', ephemeral: true });
                    return;
                }
                
                // Get the current skill and its items
                const currentSkill = skillsWithItems[currentPage];
                
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
                
                // Find shops that sell these items
                const itemShopMap = new Map();
                
                // For each item that grants this skill
                for (const item of currentSkill.items) {
                    const itemName = item.itemName;
                    itemShopMap.set(itemName, []);
                    
                    // Check each shop file for this item
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
                            
                            // Check if the shop sells this item
                            // We need to escape special regex characters in the item name
                            const escapedItemName = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const itemRegex = new RegExp(`ITEM\\s+"${escapedItemName}"`, 'i');
                            
                            if (itemRegex.test(shopContent)) {
                                itemShopMap.get(itemName).push(shopName);
                            }
                        } catch (error) {
                            console.error(`Error reading shop file ${shopFile}:`, error);
                        }
                    }
                }
                
                // Prepare response message
                let embed = new EmbedBuilder()
                    .setTitle(`Shop Locations for ${currentSkill.displayName || currentSkill.skillName}`)
                    .setDescription(`Shops selling items that grant this skill in ${modName}`)
                    .setColor(0x00AAFF);
                
                // Add fields for each item and its shops
                for (const [itemName, shops] of itemShopMap.entries()) {
                    let shopList = shops.length > 0 
                        ? shops.join('\n') 
                        : 'Not sold in any shops (may be a drop, quest reward, or crafted item)';
                    
                    // Truncate if too long
                    if (shopList.length > 1024) {
                        shopList = shopList.substring(0, 1021) + '...';
                    }
                    
                    embed.addFields({ name: itemName, value: shopList });
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
}

function register_handlers(event_registry) {
    event_registry.register('interactionCreate', onInteractionCreate);
}

module.exports = register_handlers;
