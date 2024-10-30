module.exports = {
    name: 'modlist',
    description: 'Gets the current list of mods and their modders',
    syntax: 'modlist',
    num_args: 0, // no arguments are needed for this command
    args_to_lower: false, // do not convert arguments to lowercase
    needs_api: false, // does not need access to the API
    has_state: false, // does not use the state engine
    async execute(message, args, extra) {
        const fs = require('fs');
        const path = require('path');
        const { EmbedBuilder } = require('discord.js');

        // Path to modders.json file
        const filePath = path.join(__dirname, '../modders.json');

        try {
            // Read the current modders.json
            const data = fs.readFileSync(filePath, 'utf8');
            const modders = JSON.parse(data);

            // Fetch author names using Discord API
            const modListPromises = Object.entries(modders).map(async ([authorId, modName]) => {
                try {
                    const member = await message.guild.members.fetch(authorId);
                    return { modName, authorName: member.nickname || member.user.username };
                } catch (err) {
                    this.logger.error(`Error fetching user with ID ${authorId}:`, err);
                    return { modName, authorName: 'Unknown' }; // Fallback if user not found
                }
            });

            // Resolve all promises
            const modList = await Promise.all(modListPromises);

            // Create an embed message
            const embed = new EmbedBuilder()
                .setTitle('List of Mods and Their Authors')
                .setColor('#5865F2')
                .setDescription('Below is a list of mods currently available and their respective authors:')
                .addFields(modList.map(({ modName, authorName }) => ({ name: `**${modName}**`, value: `by ${authorName}` })))
                .setFooter({ text: 'Use the modlist command to stay updated!' });

            // Send the embed message
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            this.logger.error('Error reading modders.json:', err);
            message.reply('There was an error reading the modders.json file.');
        }
    }
};
