module.exports = {
    name: 'help',
    description: 'Provides a list of commands, optionally just the ones from a specific module',
    syntax: 'help [module_name]',
    num_args: 0,
    args_to_lower: false,
    needs_api: true,
    has_state: false,
    async execute(message, args, extra) {
        var api = extra.api;
        var mod_handler = extra.module_handler;

        var longest_syntax = "";
        var longest_module_name = "";
        for (var current_module_name of Array.from(mod_handler.modules.keys())) {
            var current_module = mod_handler.modules.get(current_module_name);

            for (var current_command_name of Array.from(current_module.commands.keys())) {
                var current_command = current_module.commands.get(current_command_name);
                if (current_command.syntax.length > longest_syntax.length) {
                    longest_syntax = current_command.syntax;
                }
                if (current_module.config.display_name.length > longest_module_name.length) {
                    longest_module_name = current_module.config.display_name;
                }
            }
        }

        var header_syntax_length = Math.max(longest_syntax.length, 7); // "Command" length
        var header_module_length = Math.max(longest_module_name.length, 6); // "Module" length
        var desc_space = Math.max(50, 100 - header_syntax_length - header_module_length);

        var output = '```';
        output += `Command${" ".repeat(header_syntax_length - 7)} | Module${" ".repeat(header_module_length - 6)} | Description
`;
        output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(header_module_length) + "-+-" + "-".repeat(desc_space) + "\n";

        if(args.length > 1) {
            var module_name = args[1];
            
            var respGetModule = await api.get('module', {
                name: module_name
            });

            if(respGetModule.modules.length <= 0) {
                message.channel.send({ content: "Sorry, that module doesn't exist in the server-specific registries!"});
                return;
            }

            var respModEnabled = await api.get('enabled_module', {
                module_id: parseInt(respGetModule.modules[0].module_id),
                server_id: message.guild.id
            });
            
            if(mod_handler.modules.has(module_name) && respModEnabled.enabled_modules.length > 0) {
                var selected_module = mod_handler.modules.get(module_name);
                var num_lines = 0;

                for(var current_command_name of Array.from(selected_module.commands.keys())) {
                    var current_command = selected_module.commands.get(current_command_name);

                    output += current_command.syntax + " ".repeat(header_syntax_length - current_command.syntax.length);
                    output += " | " + selected_module.config.display_name + " ".repeat(header_module_length - selected_module.config.display_name.length);
                    output += " | ";

                    if(current_command.description.length > desc_space) {
                        output += current_command.description.substring(0, desc_space - 3) + "...";
                    } else {
                        output += current_command.description;
                    }

                    output += "\n";
                    num_lines++;

                    if(num_lines >= 14) {
                        output += "```";
                        message.channel.send({ content: output});
                        output = "```";
                        output += `Command${" ".repeat(header_syntax_length - 7)} | Module${" ".repeat(header_module_length - 6)} | Description
`;
                        output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(header_module_length) + "-+-" + "-".repeat(desc_space) + "\n";
                        num_lines = 0;
                    }
                }
                output += "```";
                message.channel.send({ content: output});
            } else {
                message.channel.send({ content: "Sorry, I couldn't find that module!"});
            }
        } else {
            var num_lines = 0;

            for(var current_module_name of Array.from(mod_handler.modules.keys())) {
                var current_module = mod_handler.modules.get(current_module_name);
                if(current_module.config.display_name == "Core" || current_module.config.display_name == "Admin") {
                    continue;
                }
                var respModule = await api.get('module', {
                    name: current_module_name
                });

                if(respModule.modules.length <= 0) {
                    message.channel.send({ content: "Oops, something went wrong!"});
                    return;
                }

                var respModEnabled = await api.get('enabled_module', {
                    module_id: parseInt(respModule.modules[0].module_id)
                });

                if(respModEnabled.enabled_modules.length > 0) {
                    for(var current_command_name of Array.from(current_module.commands.keys())) {
                        var current_command = current_module.commands.get(current_command_name);

                        output += current_command.syntax + " ".repeat(header_syntax_length - current_command.syntax.length);
                        output += " | " + current_module.config.display_name + " ".repeat(header_module_length - current_module.config.display_name.length);
                        output += " | ";

                        if(current_command.description.length > desc_space) {
                            output += current_command.description.substring(0, desc_space - 3) + "...";
                        } else {
                            output += current_command.description;
                        }

                        output += "\n";

                        num_lines++;
                        if(num_lines >= 14) {
                            output += "```";
                            message.channel.send({ content: output});
                            output = "```";
                            output += `Command${" ".repeat(header_syntax_length - 7)} | Module${" ".repeat(header_module_length - 6)} | Description
`;
                            output += "-".repeat(header_syntax_length) + "-+-" + "-".repeat(header_module_length) + "-+-" + "-".repeat(desc_space) + "\n";
                            num_lines = 0;
                        }
                    }
                }
            }
            output += "```";
            message.channel.send({ content: output});
        }
    }
};
