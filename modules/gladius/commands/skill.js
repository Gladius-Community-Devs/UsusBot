module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod name (optional)] [skill name]',
    num_args: 1, // minimum amount of arguments to accept
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
        let modName = null;
        let modNameInput = args[1];
        let skillName = '';

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Check if args[1] is a valid mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === args[1].replace(/\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    break;
                }
            }

            if (isMod) {
                // args[1] is a mod name
                if (args.length <= 2) {
                    message.channel.send({ content: 'Please provide the skill name.' });
                    return;
                }
                skillName = args.slice(2).join(' ');
            } else {
                // args[1] is not a mod name, default to Vanilla
                modName = 'Vanilla';
                skillName = args.slice(1).join(' ');
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

            // Find the entry ID for the skill name
            let entryId = null;
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0];
                const name = fields[fields.length - 1].trim();
                if (name.toLowerCase() === skillName.toLowerCase()) {
                    entryId = parseInt(id);
                    break;
                }
            }

            if (!entryId) {
                message.channel.send({ content: `Skill '${skillName}' not found in '${modName}'.` });
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
            console.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
