const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skill')
        .setDescription('Finds and displays information for a specified skill')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('skill_name')
                .setDescription('The skill name to look up')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('class_name')
                .setDescription('Filter to a specific class (optional)')
                .setAutocomplete(true)),
    name: 'skill',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();
        if (focusedOption.name === 'mod_name') {
            const choices = helpers.getAvailableMods();
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'class_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = helpers.resolveModName(rawMod);
            const classdefsPath = helpers.getModFilePaths(modName).classdefsPath;
            const classes = [];
            try {
                const content = helpers.readTextFile(classdefsPath);
                for (const match of content.matchAll(/^CREATECLASS:\s*(\S+)/gm)) {
                    const name = match[1].trim();
                    if (!name.startsWith('//')) classes.push(name);
                }
            } catch (error) {
                this.logger.error(`Failed to load class autocomplete data for ${modName}:`, error);
            }
            const filtered = classes.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'skill_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = helpers.resolveModName(rawMod);
            const filePaths = helpers.getModFilePaths(modName);
            const skillsPath = filePaths.skillsFilePath;
            const lookupPath = filePaths.lookupFilePath;
            const skillNames = [];
            try {
                const skillsContent = helpers.readTextFile(skillsPath);
                const lookupContent = helpers.readTextFile(lookupPath);
                // Build id -> display name map
                const idToName = {};
                for (const line of lookupContent.split(/\r?\n/)) {
                    if (!line.includes('^')) continue;
                    const parts = line.split('^');
                    idToName[parts[0].trim()] = parts[parts.length - 1].trim();
                }
                // Collect unique display names from skills.tok
                const seen = new Set();
                for (const match of skillsContent.matchAll(/^SKILLDISPLAYNAMEID:\s*(\d+)/gm)) {
                    const displayName = idToName[match[1].trim()];
                    if (displayName && !seen.has(displayName.toLowerCase())) {
                        seen.add(displayName.toLowerCase());
                        skillNames.push(displayName);
                    }
                }
                skillNames.sort();
            } catch (error) {
                this.logger.error(`Failed to load skill autocomplete data for ${modName}:`, error);
            }
            const filtered = skillNames.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c.toLowerCase() })));
        }
    },
    async execute(interaction, extra) {
        await interaction.deferReply();

        // Adjusted sanitizeInput to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''-]/g, '').trim();
        }

        let modName = 'Vanilla';

        try {
            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                modName = helpers.resolveModName(modNameInput);
            }

            // Sanitize modName
            modName = helpers.resolveModName(sanitizeInput(modName));

            // Define file paths securely
            const filePaths = helpers.getModFilePaths(modName);
            const lookupFilePath = filePaths.lookupFilePath;
            const skillsFilePath = filePaths.skillsFilePath;

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                await interaction.editReply({ content: `That mod does not have files yet! Expected: ${lookupFilePath}` });
                return;
            }

            if (!fs.existsSync(skillsFilePath)) {
                await interaction.editReply({ content: `That mod is missing its skills.tok file!` });
                return;
            }

            // Collect all possible skill names and map them to entry IDs
            const lookupContent = helpers.readTextFile(lookupFilePath);
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of skill names to entry IDs
            const skillNameToEntryIds = {};
            for (const line of lookupLines) {
                if (!line.trim() || line.trim().startsWith('//')) continue;
                const fields = line.split('^');
                const id = Number.parseInt(fields[0].trim(), 10);
                if (!Number.isFinite(id)) continue;
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(id);
            }

            // Read skills.tok and split records at SKILLCREATE: blank lines are
            // cosmetic in this file (they appear inside records and are sometimes
            // missing between them).
            const skillsContent = helpers.readTextFile(skillsFilePath);
            const skillsChunks = helpers.splitSkillRecords(skillsContent);

            const rawSkillName = (interaction.options.getString('skill_name') || '').trim();
            const rawClassName = (interaction.options.getString('class_name') || '').trim();

            // The class picker offers CREATECLASS names while skills are filed
            // under SKILLUSENAME (ArcherF -> Archer), so accept either.
            const classUseMap = helpers.loadClassUseMap(filePaths.classdefsPath);
            const classKeys = new Set();
            if (rawClassName) {
                classKeys.add(rawClassName.toLowerCase());
                const mapped = classUseMap.get(rawClassName.toLowerCase());
                if (mapped) classKeys.add(mapped);
            }
            const className = rawClassName;

            // Try the name exactly as typed before sanitising it: names such as
            // "Song: BattleMarch" are offered by autocomplete but the sanitizer
            // would strip the colon and miss the lookup.
            const typedKey = rawSkillName.toLowerCase();
            const sanitizedKey = sanitizeInput(rawSkillName).toLowerCase();
            const lookupKey = skillNameToEntryIds[typedKey] ? typedKey : sanitizedKey;
            const entryIds = skillNameToEntryIds[lookupKey] || [];
            const skillName = rawSkillName;

            if (entryIds.length === 0) {
                await interaction.editReply({ content: `No skill named '${skillName}' found in '${modName}'.` });
                return;
            }

            // Collect skills matching the name and optional class filter
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID'][0]))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) skillClasses = [skillClasses];
                        if (classKeys.size) {
                            if (skillClasses.some(cls => classKeys.has(cls.toLowerCase()))) {
                                matchingSkills.push({ entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]), chunk: chunk.trim(), classNames: skillClasses, skillData });
                            }
                        } else {
                            matchingSkills.push({ entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]), chunk: chunk.trim(), classNames: skillClasses, skillData });
                        }
                    }
                }
            }

            if (matchingSkills.length === 0) {
                await interaction.editReply({ content: `No skill named '${skillName}'${className ? ` for class '${className}'` : ''} found in '${modName}'.` });
                return;
            }

            // Deduplicate to the first matching SKILLDISPLAYNAMEID + SKILLUSECLASS combo
            const targetSKILLDISPLAYNAMEID = matchingSkills[0].entryId;
            const targetSKILLUSECLASS = matchingSkills[0].classNames[0];
            let allMatchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && parseInt(skillData['SKILLDISPLAYNAMEID'][0]) === targetSKILLDISPLAYNAMEID) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) skillClasses = [skillClasses];
                        if (skillClasses.some(cls => cls.toLowerCase() === targetSKILLUSECLASS.toLowerCase())) {
                            allMatchingSkills.push({ entryId: targetSKILLDISPLAYNAMEID, chunk: chunk.trim(), classNames: skillClasses, skillData });
                        }
                    }
                }
            }
            matchingSkills = allMatchingSkills;

            // Collect all classes that have the skill name, regardless of SKILLDISPLAYNAMEID
            let allClassesWithSkillName = new Set();

            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = helpers.parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID']) {
                        const entryId = parseInt(skillData['SKILLDISPLAYNAMEID'][0]);
                        const skillEntryIds = entryIds;
                        if (skillEntryIds.includes(entryId)) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            for (const cls of skillClasses) {
                                allClassesWithSkillName.add(cls.toLowerCase());
                            }
                        }
                    }
                }
            }

            // Collect classNames from matchingSkills
            const matchingSkillClassNames = matchingSkills.flatMap(skill => skill.classNames.map(cls => cls.toLowerCase()));

            // Prepare 'otherClasses' by excluding classes already in matchingSkills
            const otherClasses = [...allClassesWithSkillName].filter(cls => !matchingSkillClassNames.includes(cls) && cls !== 'unknown');

            // Combine all classes into one array
            const allClasses = [...new Set([...matchingSkillClassNames, ...otherClasses])];

            // URL encode the modName and skillName to safely include them in customId
            const encodedModName = encodeURIComponent(modName);
            const encodedSkillName = encodeURIComponent(skillName);

            // Create options for the select menus
            const classOptions = allClasses.map(cls => ({
                label: cls.charAt(0).toUpperCase() + cls.slice(1),
                value: encodeURIComponent(cls.toLowerCase())
            }));

            // Create select menus, splitting options into groups of 25 if necessary
            const rows = [];
            for (let i = 0; i < classOptions.length; i += 25) {
                const optionsChunk = classOptions.slice(i, i + 25);
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`class-select|${encodedModName}|${encodedSkillName}|${i}`)
                    .setPlaceholder('Select a class')
                    .addOptions(optionsChunk);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                rows.push(row);
            }

            // Prepare the response
            let messages = [];
            let header = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:

`;
            let currentMessage = header;

            // Check for combo skills and include all chain parts in output
            for (const skill of matchingSkills) {
                // Get the skill data
                const skillData = skill.skillData;
                
                // Check if this is a combo skill
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

            // Send messages (editReply for first, followUp for subsequent)
            for (const [msgIdx, msg] of messages.entries()) {
                const isFirst = msgIdx === 0;
                const isLast = msgIdx === messages.length - 1;
                const sendFn = isFirst
                    ? interaction.editReply.bind(interaction)
                    : interaction.followUp.bind(interaction);

                if (isLast) {
                    if (className) {
                        const learnableButton = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`learnable-skills|${modName}|${className}`)
                                    .setLabel(`View All ${className} Skills`)
                                    .setStyle(ButtonStyle.Success)
                            );
                        await sendFn({ content: msg, components: [...rows, learnableButton] });
                    } else {
                        await sendFn({ content: msg, components: rows });
                    }
                } else {
                    await sendFn({ content: msg });
                }
            }

        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding the skill.' });
            else await interaction.reply({ content: 'An error occurred while finding the skill.', ephemeral: true });
        }
    }
};


