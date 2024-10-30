module.exports = {
    name: 'module',
    description: 'Enable or disable a module, or check whether the module is enabled.',
    syntax: 'module <enable|disable|status> <module>',
    num_args: 2,
    args_to_lower: true,
    needs_api: true,
    has_state: false,
    async execute(message, args, extra) {
        if (!message.member.roles.cache.has(role => role.name === 'Admin')) {
            message.channel.send({ content: "You do not have permission to use this command." });
            return;
        }
        var api = extra.api;

        if(args[1] == "enable") {
            var respModule = await api.get('module', {
                name: args[2]
            });

            if(respModule.modules.length <= 0) {
                message.channel.send({ content: "Sorry, I couldn't find that module!"});
                return;
            }

            var target_module_id = respModule.modules[0].module_id;

            var respEnabled = await api.get('enabled_module', {
                server_id: message.channel.guild.id,
                module_id: target_module_id
            });

            if(respEnabled.enabled_modules.length == 0) {
                var respCreate = await api.post('enabled_module', {
                    module_id: parseInt(target_module_id),
                    server_id: message.channel.guild.id
                });
                message.channel.send({ content: "Successfully enabled module on this server!"});
            } else {
                message.channel.send({ content: "That module is already enabled on this server!"});
            }
        } else if(args[1] == "disable") {
            var respModule = await api.get('module', {
                name: args[2]
            });

            if(respModule.modules.length <= 0) {
                message.channel.send({ content: "Sorry, I couldn't find that module!"});
                return;
            }

            var target_module_id = respModule.modules[0].module_id;

            var respEnabled = await api.get('enabled_module', {
                server_id: message.channel.guild.id,
                module_id: target_module_id
            });

            if(respEnabled.enabled_modules.length == 0) {
                message.channel.send({ content: "That module is already disabled on this server!"});
            } else {
                console.log("Deleting link: " + respEnabled.enabled_modules[0].link_id);
                var respDelete = await api.delete('enabled_module', {
                    link_id: parseInt(respEnabled.enabled_modules[0].link_id)
                });
                message.channel.send({ content: "Successfully disabled module on this server!"});
            }
        } else if(args[1] == "status") {
            var respModule = await api.get('module', {
                name: args[2]
            });

            if(respModule.modules.length <= 0) {
                message.channel.send({ content: "Sorry, I couldn't find that module!"});
                return;
            }

            var target_module_id = respModule.modules[0].module_id;

            var respEnabled = await api.get('enabled_module', {
                server_id: message.channel.guild.id,
                module_id: target_module_id
            });

            if(respEnabled.enabled_modules.length == 0) {
                message.channel.send({ content: "Module Status: Disabled"});
            } else {
                message.channel.send({ content: "Module Status: Enabled"});
            }
        } else {
            message.channel.send({ content: "Unrecognized argument! Syntax: " + this.syntax.toString()});
        }
    }
};
