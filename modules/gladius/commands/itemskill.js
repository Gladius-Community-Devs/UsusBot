const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: 'itemskill',
    description: 'Finds skills granted by items and the items that grant them.',
    syntax: 'itemskill [mod (optional)] [skill name (optional)]',
    num_args: 0,
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
        let searchSkill = '';

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Check if a mod name was provided
            if (args.length > 1) {
                // Sanitize modNameInput
                let modNameInput = sanitizeInput(args[1]);

                // Check if args[1] is a valid mod name
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        index = 2; // Move index to next argument
                        break;
                    }
                }
            }

            // Check if a specific skill name was provided
            if (args.length > index) {
                searchSkill = args.slice(index).join(' ').toLowerCase();
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

            // Build a map of entry IDs to names
            const entryIdToName = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim();
                entryIdToName[id] = name;
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

            // Find all item skills
            const itemSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseChunk(chunk);
                    if (skillData['SKILLCREATE'] && skillData['SKILLCREATE'][0].includes('Item ')) {
                        const skillName = skillData['SKILLCREATE'][0].split(',')[0].trim().replace(/"/g, '');
                        
                        // Skip if searching for a specific skill and this doesn't match
                        if (searchSkill && !skillName.toLowerCase().includes(searchSkill)) {
                            continue;
                        }
                        
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

            // Find all items that grant these skills
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
                                chunk
                            });
                        }
                    }
                }
            }

            // Filter out skills with no items if we're not searching for a specific skill
            const filteredSkills = searchSkill 
                ? itemSkills 
                : itemSkills.filter(skill => skill.items.length > 0);

            if (filteredSkills.length === 0) {
                message.channel.send({ content: `No item skills found${searchSkill ? ` matching '${searchSkill}'` : ''} in '${modName}'.` });
                return;
            }

            // Prepare the response
            let messages = [];
            let header = `Item skills in '${modName}'${searchSkill ? ` matching '${searchSkill}'` : ''}:\n\n`;
            let currentMessage = header;

            // Sort skills alphabetically
            filteredSkills.sort((a, b) => a.skillName.localeCompare(b.skillName));

            for (const skill of filteredSkills) {
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

        } catch (error) {
            console.error('Error finding item skills:', error);
            message.channel.send({ content: 'An error occurred while finding item skills.' });
        }
    }
};
