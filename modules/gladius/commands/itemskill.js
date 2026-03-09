const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('itemskill')
        .setDescription('Finds skills granted by items, or items that grant a specific skill')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('search')
                .setDescription('Item or skill name to search for (omit to browse all)')
                .setRequired(false)
                .setAutocomplete(true)),
    name: 'itemskill',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();
        const moddersConfigPath = path.join(__dirname, '../modders.json');

        if (focusedOption.name === 'mod_name') {
            const choices = ['Vanilla'];
            try {
                const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
                for (const modder in moddersConfig) {
                    choices.push(moddersConfig[modder].replace(/\s+/g, '_'));
                }
            } catch {}
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'search') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = path.basename(rawMod.replace(/[^\w\s_-]/g, '').trim().replace(/\s+/g, '_')) || 'Vanilla';
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const suggestions = new Set();

            // Load lookup text for resolving display names
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const entryIdToName = {};
            try {
                const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
                for (const line of lookupContent.split(/\r?\n/)) {
                    if (!line.trim()) continue;
                    const fields = line.split('^');
                    const id = parseInt(fields[0].trim());
                    const name = fields[fields.length - 1].trim();
                    if (!isNaN(id) && name) entryIdToName[id] = name;
                }
            } catch {}

            // Collect item display names from items.tok (all items, with or without skills)
            const itemsFilePath = path.join(modPath, 'data', 'config', 'items.tok');
            try {
                const itemsContent = fs.readFileSync(itemsFilePath, 'utf8');
                for (const match of itemsContent.matchAll(/ITEMDISPLAYNAMEID:\s*(\d+)/g)) {
                    const id = parseInt(match[1]);
                    if (entryIdToName[id]) suggestions.add(entryIdToName[id]);
                }
                for (const match of itemsContent.matchAll(/^ITEMCREATE:\s*"?([^",\r\n]+)/gm)) {
                    suggestions.add(match[1].trim().replace(/"/g, ''));
                }
            } catch {}

            // Collect item skill display names from skills.tok
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');
            try {
                const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
                for (const chunk of skillsContent.split(/\n\s*\n/)) {
                    if (!chunk.includes('SKILLCREATE:') || !chunk.includes('Item ')) continue;
                    const nameMatch = chunk.match(/SKILLDISPLAYNAMEID:\s*(\d+)/);
                    if (nameMatch) {
                        const id = parseInt(nameMatch[1]);
                        if (entryIdToName[id]) suggestions.add(entryIdToName[id]);
                    }
                }
            } catch {}

            const filtered = [...suggestions].filter(s => s.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(s => ({ name: s, value: s })));
        }
    },
    async execute(interaction, extra) {
        await interaction.deferReply();

        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let searchTerm = '';
        let browseModeActive = false;

        try {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                const sanitizedInput = sanitizeInput(modNameInput);
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === sanitizedInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        break;
                    }
                }
            }

            searchTerm = (interaction.options.getString('search') || '').toLowerCase();
            browseModeActive = !searchTerm;

            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');
            const itemsFilePath = path.join(modPath, 'data', 'config', 'items.tok');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath) || !fs.existsSync(skillsFilePath)) {
                await interaction.editReply({ content: `That mod does not have the required files!` });
                return;
            }

            if (!fs.existsSync(itemsFilePath)) {
                await interaction.editReply({ content: `That mod is missing its items.tok file!` });
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
                    await interaction.editReply({ content: `No item skills found in '${modName}'.` });
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
                            .setDisabled(currentPage === totalPages - 1),
                        new ButtonBuilder()
                            .setCustomId(`itemskill-shops|${modName}|${currentPage}`)
                            .setLabel('🏪 Locate Shop')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(currentSkill.items.length === 0)
                    );
                
                // Send the message with embed and buttons
                await interaction.editReply({ embeds: [embed], components: [row] });
                return;
            } else {
                // Find items matching the search term (those with ITEMSKILL)
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

                // Also search for plain items (no ITEMSKILL) matching the search term
                const plainMatchingItems = [];
                for (const chunk of itemsChunks) {
                    if (!chunk.includes('ITEMCREATE:')) continue;
                    const itemData = parseChunk(chunk);
                    if (itemData['ITEMSKILL'] && itemData['ITEMSKILL'].length > 0) continue;

                    let itemName = '';
                    if (itemData['ITEMDISPLAYNAMEID'] && itemData['ITEMDISPLAYNAMEID'].length) {
                        const displayNameId = parseInt(itemData['ITEMDISPLAYNAMEID'][0]);
                        if (entryIdToName[displayNameId]) itemName = entryIdToName[displayNameId];
                    }
                    if (!itemName && itemData['ITEMCREATE'] && itemData['ITEMCREATE'].length) {
                        itemName = itemData['ITEMCREATE'][0].split(',')[0].trim().replace(/"/g, '');
                    }

                    if (itemName && itemName.toLowerCase().includes(searchTerm)) {
                        let rawName = itemName;
                        if (itemData['ITEMCREATE'] && itemData['ITEMCREATE'].length) {
                            const m = itemData['ITEMCREATE'][0].match(/^"?([^",\r\n]+)"?/);
                            if (m) rawName = m[1].trim().replace(/"/g, '');
                        }
                        plainMatchingItems.push({ itemName, rawName, chunk, itemData });
                    }
                }

                if (itemSkills.length === 0 && plainMatchingItems.length === 0) {
                    await interaction.editReply({ content: `No items or item skills found matching '${searchTerm}' in '${modName}'.` });
                    return;
                }

                // Sort alphabetically
                itemSkills.sort((a, b) => a.displayName.localeCompare(b.displayName));
                plainMatchingItems.sort((a, b) => a.itemName.localeCompare(b.itemName));

                const totalResults = itemSkills.length + plainMatchingItems.length;

                // Single skill result — show with shop button
                if (itemSkills.length === 1 && plainMatchingItems.length === 0) {
                    const skill = itemSkills[0];
                    const embed = createSkillEmbed(skill, 0, 1, modName);
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`itemskill-shops-byname|${modName}|${encodeURIComponent(skill.skillName)}`)
                                .setLabel('🏪 Locate Shop')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(skill.items.length === 0)
                        );
                    await interaction.editReply({ 
                        content: `Item skill in '${modName}' matching '${searchTerm}':`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                // Single plain item result — show with shop button
                } else if (itemSkills.length === 0 && plainMatchingItems.length === 1) {
                    const item = plainMatchingItems[0];
                    const embed = createPlainItemEmbed(item, 0, 1, modName);
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`itemskill-item-shop|${modName}|${encodeURIComponent(item.rawName)}`)
                                .setLabel('🏪 Locate Shop')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    await interaction.editReply({ 
                        content: `Item in '${modName}' matching '${searchTerm}':`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                } else {
                    // Multiple results — show embeds (up to 10)
                    const embeds = [];
                    for (const skill of itemSkills) {
                        if (embeds.length >= 10) break;
                        embeds.push(createSkillEmbed(skill, itemSkills.indexOf(skill), itemSkills.length, modName));
                    }
                    for (const item of plainMatchingItems) {
                        if (embeds.length >= 10) break;
                        embeds.push(createPlainItemEmbed(item, plainMatchingItems.indexOf(item), plainMatchingItems.length, modName));
                    }
                    await interaction.editReply({ 
                        content: `Found ${totalResults} result(s) in '${modName}' matching '${searchTerm}'${totalResults > 10 ? ' (showing first 10)' : ''}:`,
                        embeds
                    });
                    if (totalResults > 10) {
                        await interaction.followUp({ 
                            content: `⚠️ Showing only the first 10 results. Please refine your search to see more specific results.`
                        });
                    }
                }
            }

        } catch (error) {
            console.error('Error finding item skills:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding item skills.' });
            else await interaction.reply({ content: 'An error occurred while finding item skills.', ephemeral: true });
        }
    }
};

// Helper function to create embed for a plain item (no skill attached)
function createPlainItemEmbed(item, currentIndex, totalItems, modName) {
    const embed = new EmbedBuilder()
        .setTitle(item.itemName)
        .setDescription(`Item in ${modName} (${currentIndex + 1}/${totalItems}) — No skill attached`)
        .setColor(0x888888);

    const itemLines = item.chunk.split('\n');
    const formatted = itemLines.map(line => line.trim()).filter(Boolean).join('\n');
    const truncated = formatted.length > 1000 ? formatted.substring(0, 997) + '...' : formatted;
    embed.addFields({ name: 'Item Definition', value: `\`\`\`\n${truncated}\`\`\`` });

    return embed;
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
