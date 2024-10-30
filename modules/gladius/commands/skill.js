module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod name (optional)] [class name (optional)] [skill name]',
    num_args: 1, // minimum number of arguments to accept
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        const fs = require('fs');
        const path = require('path');

        const sanitizeInput = (input) => {
            return input.replace(/[^a-zA-Z0-9_\s]/g, '').trim();
        };

        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the skill name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name
        let className = '';
        let skillName = '';

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
                const id = fields[0].trim();
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(parseInt(id));
            }

            // Attempt to find the longest matching skill name starting from the earliest point
            let foundSkillName = false;
            for (let i = args.length; i > index; i--) {
                const potentialSkillName = args.slice(index, i).join(' ').trim().toLowerCase();
                if (skillNameToEntryIds[potentialSkillName]) {
                    skillName = args.slice(index, i).join(' ').trim();
                    className = args.slice(i, args.length).join(' ').trim();
                    foundSkillName = true;
                    break;
                }
            }

            if (!foundSkillName) {
                message.channel.send({ content: `Skill '${args.slice(index).join(' ')}' not found in '${modName}'.` });
                return;
            }

            // Sanitize className and skillName
            className = sanitizeInput(className);
            skillName = sanitizeInput(skillName);

            // Get all entry IDs for the skill name
            const entryIds = skillNameToEntryIds[skillName.toLowerCase()] || [];

            if (entryIds.length === 0) {
                message.channel.send({ content: `Skill '${skillName}' not found in '${modName}'.` });
                return;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');

            // Split skills.tok file by empty lines
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
                        const value = match[2].trim();
                        if (key === 'SKILLUSECLASS') {
                            if (skillData[key]) {
                                // Append to array if key already exists
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

            // For each skill chunk, collect matching skills
            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID']))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) {
                            skillClasses = [skillClasses];
                        }
                        matchingSkills.push({
                            entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
                            chunk: chunk.trim(),
                            classNames: skillClasses
                        });
                    }
                }
            }

            // For debugging: log the collected matching skills
            console.log('Matching Skills:', matchingSkills.map(skill => ({
                entryId: skill.entryId,
                classNames: skill.classNames,
                chunkSnippet: skill.chunk.substring(0, 50) // Short snippet for readability
            })));

            if (matchingSkills.length === 0) {
                message.channel.send({ content: `No skills found for '${skillName}' in '${modName}'.` });
                return;
            }

            // Filter by class name if provided
            if (className) {
                const filteredSkills = matchingSkills.filter(skill =>
                    skill.classNames.some(cls => cls.toLowerCase() === className.toLowerCase())
                );
                if (filteredSkills.length > 0) {
                    matchingSkills = filteredSkills;
                } else {
                    message.channel.send({ content: `No skill named '${skillName}' found for class '${className}' in '${modName}'.` });
                    return;
                }
            }

            // Prepare the response
            const firstSkill = matchingSkills[0];

            const allClassNames = matchingSkills.flatMap(skill => skill.classNames);
            const uniqueClassNames = [...new Set(allClassNames.map(cls => cls.toLowerCase()))];

            const firstSkillClassNames = firstSkill.classNames.map(cls => cls.toLowerCase());

            const otherClasses = uniqueClassNames.filter(cls => !firstSkillClassNames.includes(cls) && cls !== 'unknown');

            let response = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:
\`\`\`${firstSkill.chunk}\`\`\``;

            if (otherClasses.length > 0) {
                response += `\nOther classes that share this skill name: ${otherClasses.join(', ')}`;
            }

            // Send the response
            message.channel.send({ content: response });

        } catch (error) {
            console.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
