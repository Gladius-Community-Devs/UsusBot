const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add_modder')
        .setDescription('(ADMIN ONLY) Update modders.json with a modder\'s Discord ID and mod name')
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

        const filePath = path.join(__dirname, '../modders.json');

        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const modders = JSON.parse(data);

            modders[discordId] = modName;
            fs.writeFileSync(filePath, JSON.stringify(modders, null, 4));

            await interaction.reply(`Successfully updated modder <@${discordId}> (\`${discordId}\`) with mod name \`${modName}\`.`);
        } catch (err) {
            console.error('Error updating modders.json:', err);
            await interaction.reply({ content: 'There was an error updating the modders.json file.', ephemeral: true });
        }
    }
};
