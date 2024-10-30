const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'upload',
    description: 'Allows a modder to upload a data.zip file and associates it with their mod based on a config file.',
    syntax: 'upload',
    num_args: 0,
    args_to_lower: false,
    needs_api: false,
    has_state: false,
    async execute(message) {
        if (!message.member.roles.cache.some(role => role.name === 'Modder')) {
            message.channel.send({ content: "You do not have permission to use this command." });
            return;
        }

        if (message.attachments.size === 0) {
            message.channel.send({ content: 'Please attach a data.zip file.' });
            return;
        }

        const attachment = message.attachments.first();
        if (!attachment.name.endsWith('.zip')) {
            message.channel.send({ content: 'The attached file must be a .zip file.' });
            return;
        }

        try {
            const configPath = path.join(__dirname, '../modders.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

            const modderId = message.author.id;
            const modDisplayName = config[modderId];

            if (!modDisplayName) {
                message.channel.send({ content: 'You are not listed as a modder in the configuration file.' });
                return;
            }

            const downloadPath = path.join(__dirname, `../../../uploads/${modDisplayName}_data.zip`);

            // Download and save the file
            const response = await fetch(attachment.url);
            const buffer = await response.buffer();
            fs.writeFileSync(downloadPath, buffer);

            message.channel.send({ content: `The data.zip file has been successfully uploaded for mod: ${modDisplayName}.` });
        } catch (error) {
            this.logger.error('Error handling the upload:', error);
            message.channel.send({ content: 'An error occurred while processing the upload.' });
        }
    }
};
