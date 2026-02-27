const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('modlist')
        .setDescription('Gets the current list of mods and their modders'),
    async execute(interaction, extra) {
        // Path to modders.json file
        const filePath = path.join(__dirname, '../modders.json');

        try {
            await interaction.deferReply();
            // Read the current modders.json
            const data = fs.readFileSync(filePath, 'utf8');
            const modders = JSON.parse(data);

            const modListPromises = Object.entries(modders).map(async ([authorId, modName]) => {
                try {
                    const member = await interaction.guild.members.fetch(authorId);
                    return { modName, authorName: member.displayName || member.user.username };
                } catch (err) {
                    if (this.logger) this.logger.error(`Error fetching user with ID ${authorId}:`, err);
                    else console.error(`Error fetching user with ID ${authorId}:`, err);
                    return { modName, authorName: 'Unknown' }; 
                }
            });

            const modList = await Promise.all(modListPromises);

            const embed = new EmbedBuilder()
                .setTitle('List of Mods and Their Authors')
                .setColor('#5865F2')
                .setDescription('Below is a list of mods currently available and their respective authors:')
                .addFields(modList.map(({ modName, authorName }) => ({ name: `**${modName}**`, value: `by ${authorName}` })))
                .setFooter({ text: 'Use the modlist command to stay updated!' });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            if (this.logger) this.logger.error('Error reading modders.json:', err);
            else console.error('Error reading modders.json:', err);
            
            if(interaction.deferred) await interaction.editReply({ content: 'There was an error reading the modders.json file.' });
            else await interaction.reply({ content: 'There was an error reading the modders.json file.', ephemeral: true });
        }
    }
};
