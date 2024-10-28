module.exports = {
    name: 'modules',
    description: 'Provides information about the modules ModBot has loaded. Optional second argument to filter modules. Default is \'all\'',
    syntax: 'modules [enabled|disabled|all]',
    num_args: 0,
    args_to_lower: false,
    needs_api: true,
    has_state: false,
    async execute(message, args, extra) {
        var api = extra.api;
        var mod_handler = extra.module_handler;

        var output = '```';
        var module_type = "all";
        if(args.length > 1) {
            module_type = args[1];
        }

        if(module_type == "enabled" || module_type == "all") {
            var num_mods = 0;
            output += "Enabled Modules:\n";

            var respEnabled = await api.get('enabled_module', {
                _limit: 100,
                server_id: message.channel.guild.id
            });

            for(var current_module of respEnabled.enabled_modules) {
                var respModule = await api.get('module', {
                    module_id: parseInt(current_module.module_id)
                });

                if(!mod_handler.modules.has(respModule.modules[0].name)) {
                    continue;
                }

                output += "  - " + respModule.modules[0].name + " (" + mod_handler.modules.get(respModule.modules[0].name).config.display_name + ")\n";
                num_mods++;
            }

            if(num_mods == 0) {
                output += "  (None)\n";
            }
        }

        if(module_type == "all") {
            output += "\n";
        }

        if(module_type == "disabled" || module_type == "all") {
            var num_mods = 0;
            output += "Disabled Modules:\n";

            var respEnabled = await api.get('enabled_module', {
                _limit: 100,
                server_id: message.channel.guild.id
            });

            for(var current_module_name of Array.from(mod_handler.modules.keys())) {
                var current_module = mod_handler.modules.get(current_module_name);
                var module_enabled = false;
                for(var enabled_mod of respEnabled.enabled_modules) {
                    var respModule = await api.get('module', {
                        module_id: parseInt(enabled_mod.module_id)
                    });

                    if(respModule.modules[0].name == current_module.config.name) {
                        module_enabled = true;
                    }
                }
                if(!module_enabled) {
                    output += "  - " + current_module.config.name + " (" + current_module.config.display_name + ")\n";
                    num_mods++;
                }
            }

            if(num_mods == 0) {
                output += "  (None)\n";
            }

            output += "\n";

            num_mods = 0;
            output += "Globally Disabled Modules:\n";
            for(var current_module_name of Array.from(mod_handler.disabled_modules.keys())) {
                var current_module = mod_handler.disabled_modules.get(current_module_name);
                output += "  - " + current_module.config.name + " (" + current_module.config.display_name + ")\n";
                num_mods++;
            }

            if(num_mods == 0) {
                output += "  (None)\n";
            }
        }

        output += "```";
        message.channel.send(output);
    }
};
