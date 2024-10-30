module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod name (optional)] [class name (optional)] [skill name]',
    num_args: 1, // minimum number of arguments to accept
    args_to_lower: true, // if the arguments should be lower case
    needs_api: false, // if this command needs access to the api
    has_state: false, // if this command uses the state engine
    async execute(message, args, extra) {
        const fs = require('fs');
        const path = require('path');

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

            // Check if args[1] is a mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === args[1].replace(/\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2; // Move index to next argument
                    break;
                }
            }

            // Define file paths
            const lookupFilePath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'skills.tok');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                message.channel.send({ content: `Lookup file not found at path: ${lookupFilePath}` });
                return;
            }

            if (!fs.existsSync(skillsFilePath)) {
                message.channel.send({ content: `Skills file not found at path: ${skillsFilePath}` });
                return;
            }

            // Read the lookuptext_eng.txt file
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Collect all possible skill names
            const skillNamesSet = new Set();
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const name = fields[fields.length - 1].trim();
                skillNamesSet.add(name.toLowerCase());
            }
            const skillNames = Array.from(skillNamesSet);

            // Attempt to find the longest matching skill name starting from the end
            let foundSkillName = false;
            for (let i = args.length; i > index; i--) {
                const potentialSkillName = args.slice(i - (args.length - index), args.length).join(' ').trim().toLowerCase();
                if (skillNames.includes(potentialSkillName)) {
                    skillName = args.slice(i - (args.length - index), args.length).join(' ').trim();
                    className = args.slice(index, i - (args.length - index)).join(' ').trim();
                    foundSkillName = true;
                    break;
                }
            }

            if (!foundSkillName) {
                message.channel.send({ content: `Skill '${args.slice(index).join(' ')}' not found in '${modName}'.` });
                return;
            }

            // Find all entry IDs for the skill name
            let entryIds = [];
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0];
                const name = fields[fields.length - 1].trim();
                if (name.toLowerCase() === skillName.toLowerCase()) {
                    entryIds.push(parseInt(id));
                }
            }

            if (entryIds.length === 0) {
                message.channel.send({ content: `Skill '${skillName}' not found in '${modName}'.` });
                return;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');

            // Split skills.tok file by empty lines
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // For each entryId, find the corresponding skill chunks
            let matchingSkills = [];
            for (const entryId of entryIds) {
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:') && chunk.includes(`SKILLDISPLAYNAMEID: ${entryId}`)) {
                        const lines = chunk.trim().split(/\r?\n/);
                        let skillClass = 'Unknown';
                        for (const line of lines) {
                            if (line.startsWith('SKILLUSERCLASS:')) {
                                skillClass = line.split(':')[1].trim();
                                break;
                            }
                        }
                        matchingSkills.push({ entryId, chunk: chunk.trim(), className: skillClass });
                        break;
                    }
                }
            }

            if (matchingSkills.length === 0) {
                message.channel.send({ content: `No skills found for '${skillName}' in '${modName}'.` });
                return;
            }

            // Filter by class name if provided
            if (className) {
                const filteredSkills = matchingSkills.filter(skill => skill.className.toLowerCase() === className.toLowerCase());
                if (filteredSkills.length > 0) {
                    matchingSkills = filteredSkills;
                } else {
                    message.channel.send({ content: `No skill named '${skillName}' found for class '${className}' in '${modName}'.` });
                    return;
                }
            }

            // Prepare the response
            const firstSkill = matchingSkills[0];
            const otherClasses = matchingSkills
                .map(skill => skill.className)
                .filter(cls => cls.toLowerCase() !== firstSkill.className.toLowerCase());
            const uniqueOtherClasses = [...new Set(otherClasses)].sort();

            let response = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:
\`\`\`${firstSkill.chunk}\`\`\``;

            if (uniqueOtherClasses.length > 0) {
                response += `\nOther classes that share this skill name: ${uniqueOtherClasses.join(', ')}`;
            }

            // Send the response
            message.channel.send({ content: response });

        } catch (error) {
            console.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
