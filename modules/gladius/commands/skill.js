const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skill')
        .setDescription('Finds and displays information for a specified skill')
        .addStringOption(opt =>
            opt.setName('skill_name')
                .setDescription('The skill name to look up')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('class_name')
                .setDescription('Filter to a specific class (optional)')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod name to search in (optional, defaults to Vanilla)')
                .setAutocomplete(true)),
    name: 'skill',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const fs = require('fs');
        const path = require('path');
        const focused = interaction.options.getFocused().toLowerCase();
        const moddersConfigPath = path.join(__dirname, '../modders.json');
        const choices = ['Vanilla'];
        try {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            for (const modder in moddersConfig) {
                choices.push(moddersConfig[modder].replace(/\s+/g, '_'));
            }
        } catch {}
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },
    async execute(interaction, extra) {
        await interaction.deferReply();

        // Adjusted sanitizeInput to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''-]/g, '').trim();
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                const sanitizedModInput = sanitizeInput(modNameInput);
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === sanitizedModInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        break;
                    }
                }
            }

            // Sanitize modName
            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                await interaction.editReply({ content: `That mod does not have files yet!` });
                return;
            }

            if (!fs.existsSync(skillsFilePath)) {
                await interaction.editReply({ content: `That mod is missing its skills.tok file!` });
                return;
            }

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

            const skillName = sanitizeInput(interaction.options.getString('skill_name'));
            const className = sanitizeInput(interaction.options.getString('class_name') || '');

            const entryIds = skillNameToEntryIds[skillName.toLowerCase()] || [];
            if (entryIds.length === 0) {
                await interaction.editReply({ content: `No skill named '${skillName}' found in '${modName}'.` });
                return;
            }

            // Collect skills matching the name and optional class filter
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID'][0]))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) skillClasses = [skillClasses];
                        if (className) {
                            if (skillClasses.some(cls => cls.toLowerCase() === className.toLowerCase())) {
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
                    const skillData = parseSkillChunk(chunk);
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
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID']) {
                        const entryId = parseInt(skillData['SKILLDISPLAYNAMEID'][0]);
                        const skillEntryIds = skillNameToEntryIds[skillName.toLowerCase()] || [];
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
            console.error('Error finding the skill:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding the skill.' });
            else await interaction.reply({ content: 'An error occurred while finding the skill.', ephemeral: true });
        }
    }
};
