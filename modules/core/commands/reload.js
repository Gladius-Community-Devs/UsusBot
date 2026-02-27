const { SlashCommandBuilder } = require('discord.js');
var fs = require('fs');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reloads all modules and their commands/config files.'),
    async execute(interaction, extra) {
        if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
            await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            return;
        }
        var mod_handler = extra.module_handler;

        var config = JSON.parse(fs.readFileSync(mod_handler.program_path + '/ususbot.json'));
        mod_handler.discover_modules(mod_handler.program_path + "/" + config.modules_folder);
        // discover_commands needs to be updated to handle slash command registration updates? 
        // Or just re-read files. Discovery just re-reads files. 
        // Registration with Discord is API rate limited, so maybe we don't auto-register on reload unless asked.
        mod_handler.discover_commands();

        var num_commands = 0;
        for(var current_module_name of Array.from(mod_handler.modules.keys())) {
            var current_module = mod_handler.modules.get(current_module_name);
            num_commands += current_module.commands.size;
        }

        await interaction.reply({ content: "Reload Complete! Loaded " + mod_handler.modules.size + " modules and " + num_commands + " commands. (Note: Slash command definitions are not updated on Discord API by this command)"});
    }
};
