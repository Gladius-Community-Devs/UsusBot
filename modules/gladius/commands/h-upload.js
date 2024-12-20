module.exports = {
    name: 'h-upload',
    description: '(MODDER ONLY)Allows a modder to upload a data.zip file or allows an admin to upload on behalf of a modder',
    syntax: 'upload [mod_name]',
    num_args: 0,
    args_to_lower: false,
    needs_api: false,
    has_state: false,
    async execute(message, args) {
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const unzipper = require('unzipper');

        if (!message.member.roles.cache.some(role => role.name === 'Modder') && !message.member.roles.cache.some(role => role.name === 'Admin')) {
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
        message.channel.send({ content: 'Processing the uploaded file...' });
        try {
            const configPath = path.join(__dirname, '../modders.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

            let modDisplayName;

            if (message.member.roles.cache.some(role => role.name === 'Admin') && args.length > 1) {
                // Skip the first argument (the command name) and join the rest
                const modName = args.slice(1).join(' ').toLowerCase().trim();
                const modderId = Object.keys(config).find(key => config[key].toLowerCase() === modName);
                if (modderId) {
                    modDisplayName = config[modderId];
                } else {
                    message.channel.send({ content: `The specified mod name "${modName}" was not found in the configuration file. Please make sure you have typed it correctly.` });
                    this.logger.error(`Mod name "${modName}" was not found in the configuration.`);
                    return;
                }
            } else if (message.member.roles.cache.some(role => role.name === 'Modder')) {
                const modderId = message.author.id;
                modDisplayName = config[modderId];
            
                if (!modDisplayName) {
                    message.channel.send({ content: 'You are not listed as a modder in the configuration file.' });
                    this.logger.error(`Modder with ID "${modderId}" was not found in the configuration.`);
                    return;
                }
            }
            

            // Replace spaces with underscores in modDisplayName
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            const downloadPath = path.join(__dirname, `../../../uploads/${sanitizedModDisplayName}_data.zip`);
            const extractPath = path.join(__dirname, `../../../uploads/${sanitizedModDisplayName}`);

            // Delete existing files if they exist
            if (fs.existsSync(downloadPath)) {
                fs.unlinkSync(downloadPath);
            }
            if (fs.existsSync(extractPath)) {
                message.channel.send({ content: 'An existing data.zip file has been found and will be replaced.' });
                fs.rmSync(extractPath, { recursive: true, force: true });
            }

            // Download and save the file
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            fs.writeFileSync(downloadPath, buffer);

            // Unzip the file
            fs.createReadStream(downloadPath)
                .pipe(unzipper.Extract({ path: extractPath }))
                .on('close', () => {
                    message.channel.send({ content: `The data.zip file has been successfully uploaded and extracted for mod: ${sanitizedModDisplayName}.` });
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
