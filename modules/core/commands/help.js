const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    needs_api: true,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Provides a list of commands'),
    async execute(interaction, extra) {
        var mod_handler = extra.module_handler;
        var gladius_module = mod_handler.modules.get('gladius');

        const embed = new EmbedBuilder()
            .setTitle('Help - List of Commands')
            .setColor(0x00AE86);

        if (gladius_module && gladius_module.commands) {
            for (var current_command_name of Array.from(gladius_module.commands.keys())) {
                var current_command = gladius_module.commands.get(current_command_name);

                if (current_command.module === 'Core' || current_command.module === 'Admin') {
                    continue;
                }
                
                // Get name from data or legacy property
                const name = current_command.data ? current_command.data.name : current_command.name;
                
                // Check if name is a string before calling startsWith
                if (typeof name !== 'string' || name.startsWith('h-')) {
                    continue;
                }

                const description = current_command.data ? current_command.data.description : (current_command.description || 'No description');
                
                // Try to construct syntax from options if available, else legacy syntax
                let args = "";
                if (current_command.data) {
                     const jsonData = current_command.data.toJSON();
                     if (jsonData.options && jsonData.options.length > 0) {
                        args = jsonData.options.map(opt => `[${opt.name}]`).join(' ');
                     }
                } else if (current_command.syntax) {
                     args = current_command.syntax.replace(name, '').trim();
                } else {
                     args = "[args]";
                }

                embed.addFields({
                    name: `**${name}**`,
                    value: `${args ? `**Inputs:** ${args}\n` : ''}${description.length > 85 ? description.substring(0, 82) + '...' : description}`,
                    inline: true
                });
            }
        }

        await interaction.reply({ embeds: [embed] });
    }
};
