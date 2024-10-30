module.exports = {
    name: 'add_modder',
    description: '(ADMIN ONLY)Update the modders.json file with a modder Discord ID and mod name',
    syntax: 'add_modder <Discord ID> <Mod Name>',
    num_args: 2, // minimum amount of arguments to accept (ID + Mod Name)
    args_to_lower: false, // do not convert arguments to lowercase
    needs_api: false, // does not need access to the API
    has_state: false, // does not use the state engine
    async execute(message, args, extra) {
        if (!message.member.roles.cache.some(role => role.name === 'Admin')) {
            message.channel.send({ content: "You do not have permission to use this command." });
            return;
        }
        if (args.length < 2 || !message.mentions.users.size) {
            message.reply('Please mention a user and provide the mod name. Syntax: `add_modder @User <Mod Name>`');
            return;
        }
        const fs = require('fs');
        const path = require('path');
        // Extract Discord ID and mod name
        const discordId = message.mentions.users.first()?.id;
        const modName = args.slice(2).join(' '); // Support mod names with spaces

        // Path to modders.json file
        const filePath = path.join(__dirname, '../modders.json');

        try {
            // Read the current modders.json
            const data = fs.readFileSync(filePath, 'utf8');
            const modders = JSON.parse(data);

            // Update or add the modder information
            modders[discordId] = modName;

            // Write the updated JSON back to the file
            fs.writeFileSync(filePath, JSON.stringify(modders, null, 4));

            // Send confirmation message
            message.reply(`Successfully updated modder ID \`${discordId}\` with mod name \`${modName}\`.`);
        } catch (err) {
            console.error('Error updating modders.json:', err);
            message.reply('There was an error updating the modders.json file.');
        }
    }
};
