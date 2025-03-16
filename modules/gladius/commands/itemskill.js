const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'itemskill',
    description: 'Finds skills granted by items or items granting a specific skill.',
    syntax: 'itemskill [mod (optional)] [item or skill name]',
    num_args: 0, // Changed back to 0 to allow empty command for browsing
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        // Sanitize input to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name
        let searchTerm = '';
        let browseModeActive = false;

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Check if a mod name was provided
            if (args.length > 1) {
                // Sanitize modNameInput
                let modNameInput = sanitizeInput(args[1]);

                // Check if args[1] is a valid mod name
                let isMod = false;
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        index = 2; // Move index to next argument
                        isMod = true;
                        break;
                    }
                }
                
                // If args[1] wasn't a valid mod name, use it as the search term
                if (!isMod && args.length === 2) {
                    searchTerm = args[1].toLowerCase();
                }
            }

            // Check if a search term was provided after the mod name
            if (args.length > index) {
                searchTerm = args.slice(index).join(' ').toLowerCase();
            }

            // If no search term was found, activate browse mode
            if (!searchTerm) {
                browseModeActive = true;
            }

            // Sanitize modName
            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');
            const itemsFilePath = path.join(modPath, 'data', 'config', 'items.tok');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath)) {
                message.channel.send({ content: `That mod does not have the required files!` });
                return;
            }

            if (!fs.existsSync(itemsFilePath)) {
                message.channel.send({ content: `That mod is missing its items.tok file!` });
                return;
            }

            // Load lookup text
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of entry IDs to names and names to entry IDs
            const entryIdToName = {};
            const nameToEntryId = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim();
                entryIdToName[id] = name;
                nameToEntryId[name.toLowerCase()] = id;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // Read the items.tok file
            const itemsContent = fs.readFileSync(itemsFilePath, 'utf8');
            const itemsChunks = itemsContent.split(/\n\s*\n/);

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

            // Find all item skills first
            const allItemSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseChunk(chunk);
                    if (skillData['SKILLCREATE'] && skillData['SKILLCREATE'][0].includes('Item ')) {
                        const skillName = skillData['SKILLCREATE'][0].split(',')[0].trim().replace(/"/g, '');
                        
                        // Get display name
                        const displayNameId = skillData['SKILLDISPLAYNAMEID'] ? parseInt(skillData['SKILLDISPLAYNAMEID'][0]) : null;
                        const displayName = displayNameId && entryIdToName[displayNameId] ? entryIdToName[displayNameId] : skillName;
                        
                        allItemSkills.push({
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
                        const matchingSkill = allItemSkills.find(skill => 
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
                                chunk
                            });
                        }
                    }
                }
            }

            // Filter based on search term or get all skills
            let itemSkills = [];
            
            if (browseModeActive) {
                // In browse mode, just use all skills that have items granting them
                itemSkills = allItemSkills.filter(skill => skill.items.length > 0);
                
                // Sort skills alphabetically
                itemSkills.sort((a, b) => a.displayName.localeCompare(b.displayName));
                
                if (itemSkills.length === 0) {
                    message.channel.send({ content: `No item skills found in '${modName}'.` });
                    return;
                }
                
                // Create pagination embed
                const currentPage = 0;
                const totalPages = itemSkills.length;
                
                // Create embed for the first skill
                const currentSkill = itemSkills[currentPage];
                const embed = createSkillEmbed(currentSkill, currentPage, totalPages, modName);
                
                // Create navigation buttons
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`itemskill-prev|${modName}|${currentPage}`)
                            .setLabel('◀️ Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId(`itemskill-next|${modName}|${currentPage}`)
                            .setLabel('Next ▶️')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === totalPages - 1)
                    );
                
                // Send the message with embed and buttons
                message.channel.send({ embeds: [embed], components: [row] });
                return;
            } else {
                // Find items matching the search term
                const matchingItems = [];
                for (const chunk of itemsChunks) {
                    if (chunk.includes('ITEMCREATE:')) {
                        const itemData = parseChunk(chunk);
                        
                        // Skip if it doesn't have ITEMSKILL
                        if (!itemData['ITEMSKILL'] || !itemData['ITEMSKILL'].length) continue;
                        
                        // Check if item name matches search term
                        let itemName = '';
                        if (itemData['ITEMDISPLAYNAMEID'] && itemData['ITEMDISPLAYNAMEID'].length) {
                            const displayNameId = parseInt(itemData['ITEMDISPLAYNAMEID'][0]);
                            if (entryIdToName[displayNameId]) {
                                itemName = entryIdToName[displayNameId];
                            }
                        }
                        
                        // If no lookup name found, use the name from ITEMCREATE
                        if (!itemName && itemData['ITEMCREATE'] && itemData['ITEMCREATE'].length) {
                            itemName = itemData['ITEMCREATE'][0].split(',')[0].trim().replace(/"/g, '');
                        }
                        
                        if (itemName.toLowerCase().includes(searchTerm)) {
                            matchingItems.push({
                                itemName,
                                skillName: itemData['ITEMSKILL'][0].trim().replace(/"/g, ''),
                                chunk: chunk
                            });
                        }
                    }
                }

                // Filter skills by search term
                itemSkills = allItemSkills.filter(skill => {
                    // Check if skill name matches search term or if this skill appears in matching items
                    const isSkillMatch = skill.skillName.toLowerCase().includes(searchTerm) || 
                                        (skill.displayName && skill.displayName.toLowerCase().includes(searchTerm));
                    const isGrantedByMatchingItem = matchingItems.some(item => 
                        item.skillName === skill.skillName || 
                        item.skillName === skill.skillName.replace('Item ', '')
                    );
                    
                    return isSkillMatch || isGrantedByMatchingItem;
                });

                if (itemSkills.length === 0) {
                    message.channel.send({ content: `No item skills found matching '${searchTerm}' in '${modName}'.` });
                    return;
                }

                // Sort skills alphabetically
                itemSkills.sort((a, b) => a.displayName.localeCompare(b.displayName));

                // Prepare the response
                let messages = [];
                let header = `Item skills in '${modName}' matching '${searchTerm}':\n\n`;
                let currentMessage = header;

                for (const skill of itemSkills) {
                    const skillInfo = `**${skill.displayName || skill.skillName}**\n`;
                    
                    // If adding this skill would exceed Discord's message limit, start a new message
                    if (currentMessage.length + skillInfo.length > 1900) {
                        messages.push(currentMessage);
                        currentMessage = skillInfo;
                    } else {
                        currentMessage += skillInfo;
                    }
                    
                    // Add skill definition
                    const skillDefinition = `\`\`\`\n${skill.chunk.trim()}\n\`\`\`\n`;
                    if (currentMessage.length + skillDefinition.length > 1900) {
                        messages.push(currentMessage);
                        currentMessage = skillDefinition;
                    } else {
                        currentMessage += skillDefinition;
                    }
                    
                    // List items that grant this skill
                    if (skill.items.length > 0) {
                        const itemsText = `Granted by ${skill.items.length} item(s):\n` + 
                            skill.items.map(item => `- ${item.itemName}`).join('\n') + '\n\n';
                        
                        if (currentMessage.length + itemsText.length > 1900) {
                            messages.push(currentMessage);
                            currentMessage = itemsText;
                        } else {
                            currentMessage += itemsText;
                        }
                    } else {
                        const noItemsText = `No items found that grant this skill.\n\n`;
                        if (currentMessage.length + noItemsText.length > 1900) {
                            messages.push(currentMessage);
                            currentMessage = noItemsText;
                        } else {
                            currentMessage += noItemsText;
                        }
                    }
                }

                if (currentMessage.length > 0) {
                    messages.push(currentMessage);
                }

                // Send the messages
                for (const msg of messages) {
                    await message.channel.send({ content: msg });
                }
            }

        } catch (error) {
            console.error('Error finding item skills:', error);
            message.channel.send({ content: 'An error occurred while finding item skills.' });
        }
    }
};

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
