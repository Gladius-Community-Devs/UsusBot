module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [skill name]',
    num_args: 1, //minimum amount of arguments to accept
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

        const skillName = args.slice(1).join(' ');
        const lookupFilePath = path.join(__dirname, '../../../uploads', 'lookuptext_eng.txt');
        const skillsFilePath = path.join(__dirname, '../../../uploads', 'config', 'skills.tok');

        try {
            // Read the lookuptext_eng.txt file
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split('\n');

            // Find the entry ID for the skill name
            let entryId = null;
            for (const line of lookupLines) {
                const [id, ...nameParts] = line.split('^');
                const name = nameParts.join('^');
                if (name && name.trim().toLowerCase() === skillName.toLowerCase()) {
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
            const skillsChunks = skillsContent.split(':SNIPPET END');

            // Find the skill chunk with the matching SKILLDISPLAYNAMEID
            let skillChunk = null;
            for (const chunk of skillsChunks) {
                if (chunk.includes(`SKILLDISPLAYNAMEID: ${entryId}`)) {
                    skillChunk = chunk.trim();
                    break;
                }
            }

            if (!skillChunk) {
                message.channel.send({ content: `No skill found with SKILLDISPLAYNAMEID: ${entryId}.` });
                return;
            }

            // Send the skill chunk to the channel
            message.channel.send({ content: `Skill details for '${skillName}':
\`\`\`${skillChunk}\`\`\`` });
        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
