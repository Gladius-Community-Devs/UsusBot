var fs = require('fs');

module.exports = {
    name: 'reload',
    description: 'Reloads all modules and their commands/config files.',
    syntax: 'reload',
    num_args: 0,
    args_to_lower: false,
    needs_api: false,
    has_state: false,
    execute(message, args, extra) {
        if (!message.member.roles.cache.some(role => role.name === 'Admin')) {
            message.channel.send({ content: "You do not have permission to use this command." });
            return;
        }
        var mod_handler = extra.module_handler;

        var config = JSON.parse(fs.readFileSync(mod_handler.program_path + '/ususbot.json'));
        mod_handler.discover_modules(mod_handler.program_path + "/" + config.modules_folder);
        mod_handler.discover_commands();

        var num_commands = 0;
        for(var current_module_name of Array.from(mod_handler.modules.keys())) {
            var current_module = mod_handler.modules.get(current_module_name);
            num_commands += current_module.commands.size;
        }

        message.channel.send({ content: "Reload Complete! Loaded " + mod_handler.modules.size + " modules and " + num_commands + " commands."});
    }
};
