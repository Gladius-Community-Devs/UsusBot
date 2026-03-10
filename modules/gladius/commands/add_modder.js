const { SlashCommandBuilder } = require('discord.js');
const {
    getModdersFilePath,
    normalizeModNames,
    readModders,
    writeModders
} = require('../modders_store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add_modder')
        .setDescription('(ADMIN ONLY) Add or update a modder entry in the shared modders list')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord user to register as a modder')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('mod_name')
                .setDescription('The name of the mod')
                .setRequired(true)),
    name: 'add_modder',
    has_state: false,
    needs_api: false,
    async execute(interaction, extra) {
        if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        const modName = interaction.options.getString('mod_name');
        const discordId = targetUser.id;

        const filePath = getModdersFilePath();

        try {
            const modders = readModders();
            const existingMods = normalizeModNames(modders[discordId]);

            if (!existingMods.includes(modName)) {
                existingMods.push(modName);
            }

            modders[discordId] = existingMods.length === 1 ? existingMods[0] : existingMods;
            writeModders(modders);

            await interaction.reply(`Successfully updated modder <@${discordId}> (${discordId}) with mod(s): ${existingMods.join(', ')}.`);
        } catch (err) {
            console.error('Error updating shared modders list:', err);
            await interaction.reply({ content: `There was an error updating the shared modders list at ${filePath}.`, ephemeral: true });
        }
    }
};
