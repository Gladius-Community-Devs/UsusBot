const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Sends a message back. Used to test if the bot is working.')
        .addStringOption(option => 
            option.setName('input')
                .setDescription('Arbitrary argument for testing')
                .setRequired(false)),
    async execute(interaction, extra) {
        await interaction.reply("Admin Pong!");
    }
};
