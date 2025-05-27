const { InteractionType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const helpers = require('./functions');  // Import the centralized helper functions

let logger;

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

        // Sanitize inputs using the helper function
        const modNameSanitized = path.basename(helpers.sanitizeInput(modName));
        const skillNameSanitized = helpers.sanitizeInput(skillName);
        const classNameSanitized = helpers.sanitizeInput(selectedClass);

        // Define file paths using helper
        const filePaths = helpers.getModFilePaths(modNameSanitized);

        // Check if files exist
        if (!helpers.validateModFiles(filePaths, ['lookupFilePath', 'skillsFilePath'])) {
            await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
            return;
        }

        try {
            // Load lookup text using helper
            const { nameToIds: skillNameToEntryIds } = helpers.loadLookupText(filePaths.lookupFilePath);

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(filePaths.skillsFilePath, 'utf8');
            const skillsChunks = helpers.splitContentIntoChunks(skillsContent);

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
                    const skillData = helpers.parseSkillChunk(chunk);
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

                // Check if this is a combo skill using helper
                const comboSkills = helpers.collectComboChain(skillData, skillsChunks);

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
            logger.error('Error processing the interaction:', error);
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
        const modNameSanitized = path.basename(helpers.sanitizeInput(modName));
        const skillNameSanitized = helpers.sanitizeInput(skillName);
        const classNameSanitized = helpers.sanitizeInput(selectedClass);

        // Define file paths using helper
        const filePaths = helpers.getModFilePaths(modNameSanitized);

        // Check if files exist
        if (!helpers.validateModFiles(filePaths, ['lookupFilePath', 'skillsFilePath'])) {
            await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
            return;
        }

        try {
            // Get the explain.js command module to access its functions
            const explainCommand = require('./commands/explain');

            // Read the lookuptext file for skill names
            const { idToText: lookupTextMap, nameToIds: skillNameToEntryIds } = helpers.loadLookupText(filePaths.lookupFilePath);

            // Get all entry IDs for the skill name
            const entryIds = skillNameToEntryIds[skillNameSanitized.toLowerCase()] || [];

            if (entryIds.length === 0) {
                await interaction.reply({ content: `No skill named '${skillNameSanitized}' found in '${modNameSanitized}'.`, ephemeral: true });
                return;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(filePaths.skillsFilePath, 'utf8');
            const skillsChunks = helpers.splitContentIntoChunks(skillsContent);

            // Collect matching skills for the selected class
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseSkillChunk(chunk);
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
            logger.error('Error processing the interaction:', error);
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    }

    // For level selection dropdowns from the stats.js command
    else if (customId.startsWith('level-select-1|') || customId.startsWith('level-select-2|')) {
        // Extract modName, className, statSet, and selected level from customId and interaction
        const parts = customId.split('|');
        if (parts.length < 4) {
            await interaction.reply({ content: 'Invalid interaction data.', ephemeral: true });
            return;
        }

        const encodedModName = parts[1];
        const encodedClassName = parts[2];
        const encodedStatSet = parts[3];

        const modName = decodeURIComponent(encodedModName);
        const className = decodeURIComponent(encodedClassName);
        const statSet = decodeURIComponent(encodedStatSet);
        const selectedLevel = parseInt(interaction.values[0]);

        // Sanitize inputs
        const modNameSanitized = path.basename(helpers.sanitizeInput(modName));
        const classNameSanitized = helpers.sanitizeInput(className);
        const statSetSanitized = helpers.sanitizeInput(statSet);

        try {
            // Define file paths
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modNameSanitized);
            const statsetsFilePath = path.join(modPath, 'data', 'units', 'statsets.txt');

            // Check if file exists
            if (!fs.existsSync(statsetsFilePath)) {
                await interaction.reply({ content: `The statsets.txt file is missing for this mod.`, ephemeral: true });
                return;
            }

            // Read statsets.txt and find the stat set
            const statsetsContent = fs.readFileSync(statsetsFilePath, 'utf8');
            const statsetChunks = statsetsContent.split(/\n\s*\n/);
            
            let targetStatsetData = null;
            for (const chunk of statsetChunks) {
                if (chunk.includes(`Statset ${statSetSanitized}:`)) {
                    targetStatsetData = chunk.trim();
                    break;
                }
            }

            if (!targetStatsetData) {
                await interaction.reply({ content: `Stat set ${statSetSanitized} not found.`, ephemeral: true });
                return;
            }

            // Parse the stat set data
            const statLines = targetStatsetData.split(/\r?\n/).slice(1); // Skip the "Statset X:" line
            let stats = null;
            
            for (const line of statLines) {
                const trimmed = line.trim();
                if (trimmed.includes(':')) {
                    const parts = trimmed.split(':');
                    const levelNum = parseInt(parts[0].trim());
                    if (levelNum === selectedLevel) {
                        const statValues = parts[1].trim().split(' ').map(s => parseInt(s.trim()));
                        if (statValues.length === 5) { // CON PWR ACC DEF INI
                            stats = {
                                con: statValues[0],
                                pwr: statValues[1],
                                acc: statValues[2],
                                def: statValues[3],
                                ini: statValues[4]
                            };
                        }
                        break;
                    }
                }
            }

            if (!stats) {
                await interaction.reply({ content: `Level ${selectedLevel} not found in stat set ${statSetSanitized}.`, ephemeral: true });
                return;
            }

            const response = `**Stats for ${classNameSanitized} (Level ${selectedLevel}) in ${modNameSanitized}**\n` +
                `*Using stat set ${statSetSanitized} (most common for this class)*\n\n` +
                `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}`;

            // Defer update to acknowledge the interaction without sending a new reply
            await interaction.deferUpdate();

            // Edit the original message with the stats result and retain the dropdown menus
            await interaction.editReply({ content: response, components: interaction.message.components });

        } catch (error) {
            logger.error('Error processing level selection:', error);
            await interaction.reply({ content: 'An error occurred while processing your level selection.', ephemeral: true });
        }
    }

    // For itemskill pagination buttons
    else if (customId.startsWith('itemskill-prev|') || customId.startsWith('itemskill-next|') ||
        customId.startsWith('itemskill-shops|') || customId.startsWith('itemskill-shops-byname|')) {
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
            // Define file paths using helper
            const filePaths = helpers.getModFilePaths(modName);

            // Check if files exist
            if (!helpers.validateModFiles(filePaths, ['lookupFilePath', 'skillsFilePath', 'itemsFilePath'])) {
                await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
                return;
            }

            // Load lookup text using helper
            const { idToText: entryIdToName } = helpers.loadLookupText(filePaths.lookupFilePath);

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(filePaths.skillsFilePath, 'utf8');
            const skillsChunks = helpers.splitContentIntoChunks(skillsContent);

            // Read the items.tok file
            const itemsContent = fs.readFileSync(filePaths.itemsFilePath, 'utf8');
            const itemsChunks = helpers.splitContentIntoChunks(itemsContent);

            // Find all item skills
            const itemSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseChunk(chunk);
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
                    const itemData = helpers.parseChunk(chunk);
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
                if (!fs.existsSync(filePaths.shopsPath)) {
                    await interaction.editReply({ content: `The shop files directory does not exist for this mod.` });
                    return;
                }

                // Get all shop files
                const shopFiles = fs.readdirSync(filePaths.shopsPath).filter(file => file.endsWith('.tok'));

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
                    const shopFilePath = path.join(filePaths.shopsPath, shopFile);
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
                        logger.error(`Error reading shop file ${shopFile}:`, error);
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

            // Get the skill for the new page
            const currentSkill = skillsWithItems[newPage];

            // Create the updated embed using helper function
            const embed = helpers.createItemSkillEmbed(currentSkill, newPage, totalPages, modName);

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
            logger.error('Error handling itemskill pagination:', error);
            await interaction.reply({ content: 'An error occurred while handling the itemskill command pagination.', ephemeral: true });
        }
    }
    // For learnable skills pagination and explanation
    else if (customId.startsWith('learnable-skills|') ||
        customId.startsWith('class-skills|') ||      // Handle both prefixes
        customId.startsWith('learnable-page|') ||
        customId.startsWith('learnable-explain|')) {

        // Normalize the action prefix for consistent handling
        const parts = customId.split('|');
        const action = parts[0].replace('class-skills', 'learnable-skills');  // Normalize the action
        const modName = parts[1];
        const className = parts[2];  // This is the class name as provided by the button

        logger.info(`Processing learnable skills interaction: action=${action}, mod=${modName}, class=${className}`);

        let currentPage = 0;
        let skillName = null;

        // Determine the action type and extract additional parameters
        if (action === 'learnable-skills') {
            // Initial request, page defaults to 0
            currentPage = 0;
            logger.debug(`Initial learnable skills request, starting at page 0`);
        } else if (action === 'learnable-page') {
            // Page navigation
            currentPage = parseInt(parts[3]) || 0;
            logger.debug(`Navigating to learnable skills page ${currentPage}`);
        } else if (action === 'learnable-explain') {
            // Explain a specific skill
            const skillIdParts = parts[3].split('_');
            skillName = decodeURIComponent(skillIdParts[0]);
            // If there's an index part, use it for exact matching later
            const skillIndex = skillIdParts.length > 1 ? parseInt(skillIdParts[1]) : -1;
            logger.debug(`Explaining skill "${skillName}" (index: ${skillIndex}) for class "${className}"`);
        }

        try {
            // Get file paths using helper
            logger.debug(`Getting file paths for mod ${modName}`);
            const filePaths = helpers.getModFilePaths(modName);

            // Check if files exist
            logger.debug(`Validating mod files for ${modName}`);
            if (!helpers.validateModFiles(filePaths, ['lookupFilePath', 'skillsFilePath', 'classdefsPath'])) {
                logger.warn(`Required mod files missing for ${modName}: lookupFilePath, skillsFilePath and/or classdefsPath`);
                await interaction.reply({ content: `The mod files are missing or incomplete.`, ephemeral: true });
                return;
            }

            // Load lookup text using helper
            logger.debug(`Loading lookup text for mod ${modName}`);
            const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);

            // Update in events.js around line 698
            // In the section where it finds the SKILLUSENAME for a class

            // *** MODIFIED lookup step to correctly handle class matching ***
            let skillUseNameForClass = className;  // fallback to raw value
            try {
                const classDefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');
                const classChunks = helpers.splitContentIntoChunks(classDefsContent);

                // First try to find exact class name match
                for (const chunk of classChunks) {
                    const classData = helpers.parseClassChunk(chunk);
                    if (classData && classData.className &&
                        classData.className.toLowerCase() === className.toLowerCase() &&
                        classData.skillUseName) {
                        // Remove any quotes from skillUseName
                        skillUseNameForClass = classData.skillUseName.replace(/"/g, '');
                        logger.debug(`Found SKILLUSENAME "${skillUseNameForClass}" for class "${className}"`);
                        break;
                    }
                }

                // Log the result of the lookup
                logger.info(`Using SKILLUSENAME "${skillUseNameForClass}" to find skills for class "${className}"`);
            } catch (lookupError) {
                logger.error("Error looking up SKILLUSENAME in class definitions:", lookupError);
                // Proceed using the raw className as fallback
            }
            // *** End of modified lookup step ***

            // Read the skills.tok file
            logger.debug(`Reading skills.tok file for mod ${modName}`);
            const skillsContent = fs.readFileSync(filePaths.skillsFilePath, 'utf8');
            const skillsChunks = helpers.splitContentIntoChunks(skillsContent);
            logger.debug(`Split skills.tok into ${skillsChunks.length} chunks`);

            // For the "Explain" action, generate detailed skill description
            if (action === 'learnable-explain' && skillName) {
                logger.info(`Generating explanation for skill "${skillName}" for class "${className}"`);
                const explainCommand = require('./commands/explain');

                // Find the skill with the given name for this class
                let matchingSkill = null;
                logger.debug(`Searching for skill "${skillName}" for class "${className}" using SKILLUSENAME "${skillUseNameForClass}"`);
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = helpers.parseSkillChunk(chunk);
                        const displayNameId = skillData['SKILLDISPLAYNAMEID'] ? parseInt(skillData['SKILLDISPLAYNAMEID'][0]) : null;
                        const displayName = displayNameId && idToText[displayNameId] ? idToText[displayNameId] : null;

                        // Check if it matches the skill name and is available for the class (using SKILLUSENAME)
                        if (displayName && displayName.toLowerCase() === skillName.toLowerCase()) {
                            let skillClasses = skillData['SKILLUSECLASS'] || [];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }

                            // Clean up skill classes by removing quotes and trimming whitespace
                            const cleanedSkillClasses = skillClasses.map(cls =>
                                typeof cls === 'string' ? cls.replace(/"/g, '').trim() : cls
                            );

                            if (cleanedSkillClasses.some(cls => cls.toLowerCase() === skillUseNameForClass.toLowerCase())) {
                                matchingSkill = {
                                    skillData,
                                    chunk
                                };
                                logger.debug(`Found matching skill "${displayName}" for class "${skillUseNameForClass}"`);
                                break;
                            }
                        }
                    }
                }

                if (!matchingSkill) {
                    logger.warn(`Could not find skill "${skillName}" for class "${skillUseNameForClass}" in ${modName}`);
                    await interaction.reply({
                        content: `Could not find skill "${skillName}" for class "${className}" in ${modName}.`,
                        ephemeral: true
                    });
                    return;
                }

                // Generate the skill description
                logger.debug(`Generating skill description for "${skillName}"`);
                const skillDescription = explainCommand.generateSkillDescription(matchingSkill.skillData, idToText, skillsChunks);

                // Create an embed for the skill explanation
                logger.debug(`Creating embed for skill "${skillName}"`);
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
                logger.info(`Sending skill explanation for "${skillName}" to user`);
                await interaction.reply({ embeds: [embed], components: [row] });
                return;
            }

            // Find all learnable skills for this class
            logger.info(`Finding learnable skills for class "${skillUseNameForClass}" in mod "${modName}"`);
            const learnableSkills = [];

            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseSkillChunk(chunk);

                    // Check if this skill is usable by the class, using the SKILLUSENAME lookup result
                    let skillClasses = skillData['SKILLUSECLASS'] || [];
                    if (!Array.isArray(skillClasses)) {
                        skillClasses = [skillClasses];
                    }

                    if (skillClasses.some(cls => cls.toLowerCase() === skillUseNameForClass.toLowerCase())) {
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
                        logger.debug(`Found learnable skill "${displayName}" for class "${skillUseNameForClass}"`);
                    }
                }
            }

            logger.info(`Found ${learnableSkills.length} learnable skills for class "${skillUseNameForClass}"`);

            // Sort skills alphabetically by name
            learnableSkills.sort((a, b) => a.name.localeCompare(b.name));
            logger.debug(`Sorted learnable skills alphabetically`);

            // Calculate pagination
            const itemsPerPage = 5;
            const pageCount = Math.ceil(learnableSkills.length / itemsPerPage);

            // Validate current page
            if (currentPage < 0) {
                logger.debug(`Correcting negative page number to 0`);
                currentPage = 0;
            }
            if (currentPage >= pageCount) {
                logger.debug(`Correcting excessive page number from ${currentPage} to ${pageCount - 1}`);
                currentPage = pageCount - 1;
            }

            // Get skills for the current page
            const startIdx = currentPage * itemsPerPage;
            const endIdx = Math.min(startIdx + itemsPerPage, learnableSkills.length);
            const currentSkills = learnableSkills.slice(startIdx, endIdx);
            logger.debug(`Displaying skills ${startIdx + 1}-${endIdx} (page ${currentPage + 1}/${pageCount})`);

            // Create embed with skill list
            logger.debug(`Creating embed for learnable skills page ${currentPage + 1}`);
            const embed = new EmbedBuilder()
                .setTitle(`Learnable Skills for ${className}`)
                .setDescription(`Skills that can be learned by ${className} (Page ${currentPage + 1}/${pageCount})`)
                .setColor(0x3498db);

            // Add each skill to the embed
            for (const skill of currentSkills) {
                let description = '';
                if (skill.type && skill.category) {
                    description += `**Type:** ${skill.type} (${skill.category})\n`;
                }
                if (skill.skillData['SKILLJOBPOINTCOST'] && skill.skillData['SKILLJOBPOINTCOST'][0]) {
                    description += `**JP Cost:** ${skill.skillData['SKILLJOBPOINTCOST'][0]}\n`;
                }
                if (skill.skillData['SKILLCOSTS'] && skill.skillData['SKILLCOSTS'][0]) {
                    const costsParts = skill.skillData['SKILLCOSTS'][0].split(',').map(part => part.trim());
                    const turns = costsParts[0];
                    description += `**Turns:** ${turns}\n`;
                }
                embed.addFields({
                    name: skill.name,
                    value: description || 'No additional information available'
                });
                logger.debug(`Added skill "${skill.name}" to embed`);
            }

            // Create pagination buttons
            logger.debug(`Creating navigation buttons for page ${currentPage + 1}/${pageCount}`);
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

            // Add explain buttons for each skill on this page (up to 5 buttons per row)
            logger.debug(`Creating explanation buttons for skills on page ${currentPage + 1}`);
            const explainRow = new ActionRowBuilder();
            for (let i = 0; i < currentSkills.length; i++) {
                // Create a unique ID by adding the index as a suffix when a skill name appears multiple times
                const skillId = `${encodeURIComponent(currentSkills[i].name)}_${i}`;
                explainRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`learnable-explain|${modName}|${className}|${skillId}`)
                        .setLabel(`Explain ${currentSkills[i].name}`)
                        .setStyle(ButtonStyle.Secondary)                );
                logger.debug(`Added explain button for skill "${currentSkills[i].name}" with ID "${skillId}"`);
                if (i === 4) break; // Discord allows a maximum of 5 buttons per row
            }

            const components = [row];
            if (currentSkills.length > 0) {
                components.push(explainRow);
            }

            // Send response based on the action type
            if (action === 'learnable-skills') {
                logger.info(`Sending initial learnable skills response for class "${className}"`);
                await interaction.reply({ embeds: [embed], components });
            } else {
                logger.info(`Updating existing learnable skills message for class "${className}"`);
                await interaction.update({ embeds: [embed], components });
            }
            logger.info(`Successfully processed learnable skills interaction for class "${className}" in mod "${modName}"`);

        } catch (error) {
            logger.error(`Error handling learnable skills for class "${className}" in mod "${modName}":`, error);
            try {
                await interaction.reply({ content: 'An error occurred while processing learnable skills.', ephemeral: true });
            } catch (replyError) {
                try {
                    await interaction.update({ content: 'An error occurred while processing learnable skills.', components: [] });
                } catch (updateError) {
                    logger.error(`Failed to update interaction with error message: ${updateError.message}`);
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
        // Calculate new page number as before
        const newPage = action === 'class-prev' ? currentPage - 1 : currentPage + 1;

        logger.info(`Processing class pagination: action=${action}, mod=${modName}, currentPage=${currentPage}, newPage=${newPage}`);

        try {
            // Get file paths using helper
            logger.debug(`Getting file paths for mod "${modName}"`);
            const filePaths = helpers.getModFilePaths(modName);

            logger.debug(`Validating mod files for "${modName}"`);
            if (!helpers.validateModFiles(filePaths, ['classdefsPath', 'lookupFilePath'])) {
                logger.warn(`Required files missing for mod "${modName}": classdefsPath and/or lookupFilePath`);
                await interaction.reply({ content: `Required files are missing for mod '${modName}'.`, ephemeral: true });
                return;
            }

            logger.debug(`Reading lookup file for mod "${modName}"`);
            const lookupContent = fs.readFileSync(filePaths.lookupFilePath, 'utf8');

            logger.debug(`Reading class definitions file for mod "${modName}"`);
            const classdefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');

            // Build lookup table
            logger.debug(`Building lookup table from ${filePaths.lookupFilePath}`);
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

            // --- CHANGE 1: Use a regex to split the class definitions file ---
            // This regex matches every block starting with "CREATECLASS:" until the next "CREATECLASS:" or end of file.
            const classChunks = classdefsContent.match(/CREATECLASS:[\s\S]*?(?=CREATECLASS:|$)/g);
            if (!classChunks || classChunks.length === 0) {
                logger.warn(`No class definitions found in file`);
                return;
            }
            logger.debug(`Found ${classChunks.length} class definition chunks`);

            // Parse each class chunk into a structured object
            let classesList = [];
            for (let chunk of classChunks) {
                chunk = chunk.trim();
                if (!chunk || chunk.toLowerCase().includes('numclassdefs')) continue;

                // Use the helper function to parse the class chunk
                const classData = helpers.parseClassChunk(chunk);

                if (classData && classData.className && !classData.className.includes('ClassDefs')) {
                    const displayName = classData.DISPLAYNAMEID ? (entryIdToText[classData.DISPLAYNAMEID] || classData.className) : classData.className;
                    const description = classData.DESCRIPTIONID ? (entryIdToText[classData.DESCRIPTIONID] || '') : '';

                    // Process display names for classes
                    function processClassName(displayName, createClassName) {
                        if (!displayName || displayName === '0') {
                            return createClassName;
                        }
                        return `${displayName} (${createClassName})`;
                    }

                    classesList.push({
                        ...classData,
                        displayName: processClassName(displayName, classData.className),
                        description
                    });
                    logger.debug(`Parsed class: ${displayName}`);
                }
            }

            classesList.sort((a, b) => a.displayName.localeCompare(b.displayName));
            logger.debug(`Sorted ${classesList.length} classes alphabetically`);

            if (classesList.length === 0) {
                logger.warn(`No classes found for mod "${modName}"`);
                await interaction.reply({ content: `No classes found for mod '${modName}'.`, ephemeral: true });
                return;
            }

            // --- CHANGE 2: Introduce pageSize set to 1 ---
            const pageSize = 1; // Each page will show exactly one class
            const totalPages = Math.ceil(classesList.length / pageSize);

            if (newPage < 0 || newPage >= totalPages) {
                logger.warn(`Invalid page number: ${newPage}. Valid range: 0-${totalPages - 1}`);
                await interaction.reply({ content: `Invalid page number. Valid range: 0-${totalPages - 1}`, ephemeral: true });
                return;
            }

            // Calculate the index for the current page (since pageSize is 1, index = newPage)
            const startIndex = newPage * pageSize;
            logger.debug(`Creating embed for class "${classesList[startIndex].displayName}"`);
            const embed = helpers.createClassEmbed(classesList[startIndex], newPage, totalPages, modName);
            // --- END CHANGE 2 ---

            // Rebuild navigation buttons using totalPages instead of classesList.length
            logger.debug(`Creating navigation buttons for class page ${newPage + 1}/${totalPages}`);
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`class-prev|${modName}|${newPage}`)
                        .setLabel('◀️ Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage <= 0),
                    new ButtonBuilder()
                        .setCustomId(`class-next|${modName}|${newPage}`)
                        .setLabel('Next ▶️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(newPage >= totalPages - 1), // Use totalPages for validation
                    new ButtonBuilder()
                        .setCustomId(`class-skills|${modName}|${encodeURIComponent(classesList[startIndex].skillUseName)}`)
                        .setLabel('📚 Learnable Skills')
                        .setStyle(ButtonStyle.Secondary)
                );

            logger.info(`Updating interaction with class information for "${classesList[startIndex].displayName}"`);
            await interaction.deferUpdate();
            await interaction.editReply({ embeds: [embed], components: [row] });
            logger.info(`Successfully processed class pagination for "${classesList[startIndex].displayName}" in mod "${modName}"`);
        } catch (error) {
            logger.error(`Error handling class pagination for mod "${modName}":`, error);
            logger.error(`Error stack trace: ${error.stack}`);
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
