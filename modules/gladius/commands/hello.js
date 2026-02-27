const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Say hi to Usus! Used to test if the bot is working.'),
    async execute(interaction, extra) {
        await interaction.reply("Hello there! Ready to participate in the games?");
    }
};
