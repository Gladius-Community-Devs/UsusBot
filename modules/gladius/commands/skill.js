const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod (optional)] [class (optional)] [skill name]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        // Adjusted sanitizeInput to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s'’-]/g, '').trim();
        };

        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the skill name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Sanitize modNameInput
            let modNameInput = sanitizeInput(args[1]);

            // Check if args[1] is a valid mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2; // Move index to next argument
                    break;
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
                message.channel.send({ content: `That mod does not have files yet!` });
                return;
            }

            if (!fs.existsSync(skillsFilePath)) {
                message.channel.send({ content: `That mod is missing its skills.tok file!` });
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

            // Initialize variables
            let className = '';
            let skillName = '';
            let foundMatchingSkills = false;
            let matchingSkills = [];

            // Try all possible splits between class name and skill name
            for (let splitIndex = index; splitIndex <= args.length; splitIndex++) {
                let potentialClassName = args.slice(index, splitIndex).join(' ').trim();
                let potentialSkillName = args.slice(splitIndex, args.length).join(' ').trim();

                if (!potentialSkillName) continue; // Skill name is required

                // Sanitize inputs
                potentialClassName = sanitizeInput(potentialClassName);
                potentialSkillName = sanitizeInput(potentialSkillName);

                skillName = potentialSkillName;

                // Get all entry IDs for the potential skill name
                const entryIds = skillNameToEntryIds[potentialSkillName.toLowerCase()] || [];

                if (entryIds.length === 0) {
                    continue; // No skill with this name, try next split
                }

                // For each skill chunk, collect matching skills
                matchingSkills = [];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = parseSkillChunk(chunk);
                        if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID'][0]))) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            // Check if the skill matches the potential class name (if provided)
                            if (potentialClassName) {
                                if (skillClasses.some(cls => cls.toLowerCase() === potentialClassName.toLowerCase())) {
                                    matchingSkills.push({
                                        entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]),
                                        chunk: chunk.trim(),
                                        classNames: skillClasses,
                                        skillData: skillData // Include skillData for later use
                                    });
                                }
                            } else {
                                // No class name specified, collect all matching skills
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

                if (matchingSkills.length > 0) {
                    className = potentialClassName;
                    foundMatchingSkills = true;

                    // Now, get the target SKILLDISPLAYNAMEID and SKILLUSECLASS of the first matching skill
                    const targetSKILLDISPLAYNAMEID = matchingSkills[0].entryId;
                    const targetSKILLUSECLASS = matchingSkills[0].classNames[0];

                    // Now collect all skill chunks that have this SKILLDISPLAYNAMEID and SKILLUSECLASS
                    let allMatchingSkills = [];
                    for (const chunk of skillsChunks) {
                        if (chunk.includes('SKILLCREATE:')) {
                            const skillData = parseSkillChunk(chunk);
                            if (skillData['SKILLDISPLAYNAMEID'] && parseInt(skillData['SKILLDISPLAYNAMEID'][0]) === targetSKILLDISPLAYNAMEID) {
                                let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                                if (!Array.isArray(skillClasses)) {
                                    skillClasses = [skillClasses];
                                }
                                if (skillClasses.some(cls => cls.toLowerCase() === targetSKILLUSECLASS.toLowerCase())) {
                                    allMatchingSkills.push({
                                        entryId: targetSKILLDISPLAYNAMEID,
                                        chunk: chunk.trim(),
                                        classNames: skillClasses,
                                        skillData: skillData // Include skillData for later use
                                    });
                                }
                            }
                        }
                    }

                    matchingSkills = allMatchingSkills;

                    break; // Exit the loop as we've found matching skills
                }
            }

            if (!foundMatchingSkills) {
                message.channel.send({ content: `No skill named '${args.slice(index).join(' ')}' found in '${modName}'.` });
                return;
            }

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

            // Prepare the response
            let messages = [];
            let header = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:\n\n`;
            let currentMessage = header;

            for (const skill of matchingSkills) {
                const skillText = `\`\`\`\n${skill.chunk}\n\`\`\`\n`;
                if (currentMessage.length + skillText.length > 2000) {
                    messages.push(currentMessage);
                    currentMessage = skillText;
                } else {
                    currentMessage += skillText;
                }
            }

            // Combine all classes into one array
            const allClasses = [...new Set([...matchingSkillClassNames, ...otherClasses])];

            // URL encode the modName and skillName to safely include them in customId
            const encodedModName = encodeURIComponent(modName);
            const encodedSkillName = encodeURIComponent(skillName);

            // Create options for the select menu
            const classOptions = allClasses.map(cls => ({
                label: cls.charAt(0).toUpperCase() + cls.slice(1),
                value: encodeURIComponent(cls.toLowerCase())
            }));

            // Create the select menu with the modName and skillName in customId
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`class-select|${encodedModName}|${encodedSkillName}`)
                .setPlaceholder('Select a class')
                .addOptions(classOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Send the messages
            for (const msg of messages) {
                await message.channel.send({ content: msg });
            }

            // Send the message with the select menu
            await message.channel.send({ content: 'Please select a class:', components: [row] });
        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
