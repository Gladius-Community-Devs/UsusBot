module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod (o)] [class (o)] [skill name]',
    num_args: 1,
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

                // Get all entry IDs for the potential skill name
                const entryIds = skillNameToEntryIds[potentialSkillName.toLowerCase()] || [];

                if (entryIds.length === 0) {
                    continue; // No skill with this name, try next split
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
                                // Handle multiple keys that can have multiple values
                                if (skillData[key]) {
                                    if (Array.isArray(skillData[key])) {
                                        skillData[key].push(value);
                                    } else {
                                        skillData[key] = [skillData[key], value];
                                    }
                                } else {
                                    skillData[key] = value;
                                }
                            }
                        }
                    }
                    return skillData;
                };

                // For each skill chunk, collect matching skills
                matchingSkills = [];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = parseSkillChunk(chunk);
                        if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID']))) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            // Check if the skill matches the potential class name (if provided)
                            if (potentialClassName) {
                                if (skillClasses.some(cls => cls.toLowerCase() === potentialClassName.toLowerCase())) {
                                    matchingSkills.push({
                                        entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
                                        chunk: chunk.trim(),
                                        classNames: skillClasses
                                    });
                                }
                            } else {
                                // No class name specified, collect all matching skills
                                matchingSkills.push({
                                    entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
                                    chunk: chunk.trim(),
                                    classNames: skillClasses
                                });
                            }
                        }
                    }
                }

                if (matchingSkills.length > 0) {
                    className = potentialClassName;
                    skillName = potentialSkillName;
                    foundMatchingSkills = true;
                    break; // Exit the loop as we've found matching skills
                }
            }

            if (!foundMatchingSkills) {
                message.channel.send({ content: `No skill named '${args.slice(index).join(' ')}' found in '${modName}'.` });
                return;
            }

            // Prepare the response
            let response = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:\n\n`;

            // Collect all classNames from matchingSkills
            const allClassNames = matchingSkills.flatMap(skill => skill.classNames);
            const uniqueClassNames = [...new Set(allClassNames.map(cls => cls.toLowerCase()))];

            // If a className was specified, exclude it from otherClasses
            let specifiedClassNames = [];
            if (className) {
                specifiedClassNames.push(className.toLowerCase());
            }
            const otherClasses = uniqueClassNames.filter(cls => !specifiedClassNames.includes(cls) && cls !== 'unknown');

            for (const skill of matchingSkills) {
                response += `\`\`\`${skill.chunk}\`\`\`\n`;
            }

            if (otherClasses.length > 0) {
                response += `Other classes that share this skill name: ${otherClasses.join(', ')}`;
            }

            // Use the custom splitMessage function to split and send the message
            const messageChunks = splitMessage(response, {
                maxLength: 2000,
                char: '\n'
            });

            for (const chunk of messageChunks) {
                await message.channel.send({ content: chunk });
            }

        } catch (error) {
            console.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    },
};

// Custom splitMessage function
function splitMessage(text, { maxLength = 2000, char = '\n' } = {}) {
    if (text.length <= maxLength) return [text];
    const splitText = text.split(char);
    if (splitText.some(chunk => chunk.length > maxLength)) throw new RangeError('A chunk is too big!');
    const messages = [];
    let msg = '';
    for (const chunk of splitText) {
        if (msg && (msg + char + chunk).length > maxLength) {
            messages.push(msg);
            msg = '';
        }
        msg += (msg ? char : '') + chunk;
    }
    messages.push(msg);
    return messages;
}
