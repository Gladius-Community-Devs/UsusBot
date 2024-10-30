module.exports = {
    name: 'upload',
    description: 'Allows a modder to upload a data.zip file',
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
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const unzipper = require('unzipper');

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
            const extractPath = path.join(__dirname, `../../../uploads/${modDisplayName}`);

            // Download and save the file
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            fs.writeFileSync(downloadPath, buffer);

            // Unzip the file
            fs.createReadStream(downloadPath)
                .pipe(unzipper.Extract({ path: extractPath }))
                .on('close', () => {
                    message.channel.send({ content: `The data.zip file has been successfully uploaded and extracted for mod: ${modDisplayName}.` });
                })
                .on('error', (err) => {
                    this.logger.error('Error extracting the zip file:', err);
                    message.channel.send({ content: 'An error occurred while extracting the uploaded file.' });
                });
        } catch (error) {
            this.logger.error('Error handling the upload:', error);
            message.channel.send({ content: 'An error occurred while processing the upload.' });
        }
    }
};
