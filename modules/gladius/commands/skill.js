module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod name] [skill name]',
    num_args: 2, //minimum amount of arguments to accept
    args_to_lower: true, //if the arguments should be lower case
    needs_api: false, //if this command needs access to the api
    has_state: false, //if this command uses the state engine
    async execute(message, args, extra) {
        const fs = require('fs');
        const path = require('path');

        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the skill name.' });
            return;
        }

        const modNameInput = args.length > 2 ? args[1] : 'Vanilla';
        const skillName = args.length > 2 ? args.slice(2).join(' ') : args.slice(1).join(' ');
        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = null;

        try {
            // Check if mod exists in modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            for (const modder in moddersConfig) {
                if (moddersConfig[modder].replace(/\s+/g, '_').toLowerCase() === modNameInput.toLowerCase()) {
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    break;
                }
            }

            if (!modName) {
                modName = 'Vanilla';
            }

            // Define file paths
            const lookupFilePath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'skills.tok');

            // Read the lookuptext_eng.txt file
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split('\n');

            // Find the entry ID for the skill name
            let entryId = null;
            for (const line of lookupLines) {
                const [id, ...nameParts] = line.split('^');
                const name = nameParts.join('^').trim();
                if (name.toLowerCase() === skillName.toLowerCase()) {
                    entryId = parseInt(id);
                    break;
                }
            }

            if (!entryId) {
                message.channel.send({ content: `Skill '${skillName}' not found in lookuptext_eng.txt.` });
                return;
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');

            // Split skills.tok file by empty lines
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // Find the skill chunk with the matching SKILLDISPLAYNAMEID
            let skillChunk = null;
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:') && chunk.includes(`SKILLDISPLAYNAMEID: ${entryId}`)) {
                    skillChunk = chunk.trim();
                    break;
                }
            }

            if (!skillChunk) {
                message.channel.send({ content: `No skill found with SKILLDISPLAYNAMEID: ${entryId}.` });
                return;
            }

            // Send the skill chunk to the channel
            message.channel.send({ content: `Skill details for '${skillName}' in '${modName}':
\`\`\`${skillChunk}\`\`\`` });
        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
