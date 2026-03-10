const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    getModdersFilePath,
    normalizeModNames,
    readModders
} = require('../modders_store');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('modlist')
        .setDescription('Gets the current list of mods and their modders'),
    async execute(interaction, extra) {
        const filePath = getModdersFilePath();

        try {
            await interaction.deferReply();
            const modders = readModders();

            const modListPromises = Object.entries(modders).map(async ([authorId, modValue]) => {
                const ownedMods = normalizeModNames(modValue);
                try {
                    const member = await interaction.guild.members.fetch(authorId);
                    return {
                        authorName: member.displayName || member.user.username,
                        ownedMods
                    };
                } catch (err) {
                    if (this.logger) this.logger.error(`Error fetching user with ID ${authorId}:`, err);
                    else console.error(`Error fetching user with ID ${authorId}:`, err);
                    return {
                        authorName: 'Unknown',
                        ownedMods
                    };
                }
            });

            const modList = await Promise.all(modListPromises);
            const fields = modList.flatMap(({ authorName, ownedMods }) => ownedMods.map((modName) => ({
                name: `**${modName}**`,
                value: `by ${authorName}`
            })));

            if (!fields.length) {
                await interaction.editReply({ content: `No mods are currently listed in ${filePath}.` });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('List of Mods and Their Authors')
                .setColor('#5865F2')
                .setDescription('Below is a list of mods currently available and their respective authors:')
                .addFields(fields.slice(0, 25))
                .setFooter({ text: 'Use the modlist command to stay updated!' });

            if (fields.length > 25) {
                embed.setDescription(`Below is a partial list (first 25 entries) from ${fields.length} total mods.`);
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            if (this.logger) this.logger.error('Error reading shared modders list:', err);
            else console.error('Error reading shared modders list:', err);
            
            if(interaction.deferred) await interaction.editReply({ content: `There was an error reading the shared modders list at ${filePath}.` });
            else await interaction.reply({ content: `There was an error reading the shared modders list at ${filePath}.`, ephemeral: true });
        }
    }
};
