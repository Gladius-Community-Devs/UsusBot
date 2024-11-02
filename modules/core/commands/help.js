const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    description: 'Provides a list of commands',
    syntax: 'help',
    num_args: 0,
    args_to_lower: false,
    needs_api: true,
    has_state: false,
    async execute(message, args, extra) {
        var mod_handler = extra.module_handler;
        var gladius_module = mod_handler.modules.get('gladius');

        const embed = new EmbedBuilder()
            .setTitle('Help - List of Commands ( (o) = optional input )')
            .setColor(0x00AE86);

        for (var current_command_name of Array.from(gladius_module.commands.keys())) {
            var current_command = gladius_module.commands.get(current_command_name);

            if (current_command.module === 'Core' || current_command.module === 'Admin') {
                continue;
            }

            const args = current_command.syntax.replace(current_command.name, '').trim();
            embed.addFields({
                name: `**${current_command.name}**`,
                value: `${args ? `**Args:** ${args}\n` : ''}${current_command.description.length > 85 ? current_command.description.substring(0, 82) + '...' : current_command.description}`,
                inline: true
            });
        }

        message.channel.send({ embeds: [embed] });
    }
};
