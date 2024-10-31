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
        var gladius_module = mod_handler.modules.get('gladius');

        for (var current_command_name of Array.from(gladius_module.commands.keys())) {
            var current_command = gladius_module.commands.get(current_command_name);
            if (current_command.syntax.length > longest_syntax.length) {
                longest_syntax = current_command.syntax;
            }
        }

        var header_syntax_length = Math.max(longest_syntax.length, 7); // "Command" length
        var desc_space = Math.max(50, 115 - header_syntax_length);

        var output = '```';
        output += `Command${" ".repeat(header_syntax_length - 7)} | Description
`;
        output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(desc_space) + "\n";

        var num_lines = 0;

        for (var current_command_name of Array.from(gladius_module.commands.keys())) {
            var current_command = gladius_module.commands.get(current_command_name);

            if (current_command.module === 'Core' || current_command.module === 'Admin') {
                continue;
            }

            output += current_command.syntax + " ".repeat(header_syntax_length - current_command.syntax.length);
            output += " | ";

            if (current_command.description.length > desc_space) {
                output += current_command.description.substring(0, desc_space - 3) + "...";
            } else {
                output += current_command.description;
            }

            output += "\n";

            num_lines++;
            if (num_lines >= 14) {
                output += "```";
                message.channel.send({ content: output });
                output = "```";
                output += `Command${" ".repeat(header_syntax_length - 7)} | Description
`;
                output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(desc_space) + "\n";
                num_lines = 0;
            }
        }
        output += "```";
        message.channel.send({ content: output });
    }
};
