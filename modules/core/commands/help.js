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

        var longest_syntax = "";
        var longest_description = "";
        var gladius_module = mod_handler.modules.get('gladius');

        for (var current_command_name of Array.from(gladius_module.commands.keys())) {
            var current_command = gladius_module.commands.get(current_command_name);
            if (current_command.syntax.length > longest_syntax.length) {
                longest_syntax = current_command.syntax;
            }
            if (current_command.description.length > longest_description.length) {
                longest_description = current_command.description;
            }
        }

        var header_syntax_length = Math.max(longest_syntax.length, 20); // "Command (o) = optional" length
        var header_desc_length = Math.max(longest_description.length, 11); // "Description" length

        var output = '```';
        output += `Command (o) = optional${" ".repeat(header_syntax_length - 20)} | Description\n`;
        output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(header_desc_length) + "\n";

        var num_lines = 0;

        for (var current_command_name of Array.from(gladius_module.commands.keys())) {
            var current_command = gladius_module.commands.get(current_command_name);

            if (current_command.module === 'Core' || current_command.module === 'Admin') {
                continue;
            }

            output += current_command.syntax + " ".repeat(header_syntax_length - current_command.syntax.length);
            output += " | ";

            output += current_command.description;

            output += "\n";

            num_lines++;
            if (num_lines >= 14) {
                output += "```";
                message.channel.send({ content: output });
                output = "```";
                output += `Command (o) = optional${" ".repeat(header_syntax_length - 20)} | Description\n`;
                output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(header_desc_length) + "\n";
                num_lines = 0;
            }
        }
        output += "```";
        message.channel.send({ content: output });
    }
};
