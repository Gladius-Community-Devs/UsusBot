const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    needs_api: true,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('modules')
        .setDescription('Provides information about the modules UsusBot has loaded.')
        .addStringOption(option => 
            option.setName('filter')
                .setDescription('Filter modules by status')
                .setRequired(false)
                .addChoices(
                    { name: 'enabled', value: 'enabled' },
                    { name: 'disabled', value: 'disabled' },
                    { name: 'all', value: 'all' }
                )),
    async execute(interaction, extra) {
        if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
            await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            return;
        }

        await interaction.deferReply();
        var api = extra.api;
        var mod_handler = extra.module_handler;

        var output = '```';
        const module_type = interaction.options.getString('filter') || 'all';

        if(module_type == "enabled" || module_type == "all") {
            var num_mods = 0;
            output += "Enabled Modules:\n";

            var respEnabled = await api.get('enabled_module', {
                _limit: 100,
                server_id: interaction.guild.id
            });

            if (respEnabled && respEnabled.enabled_modules) {
                for(var current_module of respEnabled.enabled_modules) {
                    var respModule = await api.get('module', {
                        module_id: parseInt(current_module.module_id)
                    });

                    if(!respModule || !respModule.modules || respModule.modules.length == 0 || !mod_handler.modules.has(respModule.modules[0].name)) {
                        continue;
                    }

                    output += "  - " + respModule.modules[0].name + " (" + mod_handler.modules.get(respModule.modules[0].name).config.display_name + ")\n";
                    num_mods++;
                }
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
                server_id: interaction.guild.id
            });
            const enabledModulesMap = new Set();
            if (respEnabled && respEnabled.enabled_modules) {
                for(const em of respEnabled.enabled_modules) {
                     var respModule = await api.get('module', {
                        module_id: parseInt(em.module_id)
                    });
                    if (respModule && respModule.modules && respModule.modules.length > 0) {
                        enabledModulesMap.add(respModule.modules[0].name);
                    }
                }
            }

            for(var current_module_name of Array.from(mod_handler.modules.keys())) {
                var current_module = mod_handler.modules.get(current_module_name);
                
                if(!enabledModulesMap.has(current_module.config.name)) {
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
            if (mod_handler.disabled_modules) {
                for(var current_module_name of Array.from(mod_handler.disabled_modules.keys())) {
                    var current_module = mod_handler.disabled_modules.get(current_module_name);
                    output += "  - " + current_module.config.name + " (" + current_module.config.display_name + ")\n";
                    num_mods++;
                }
            }

            if(num_mods == 0) {
                output += "  (None)\n";
            }
        }

        output += "```";
        await interaction.editReply({ content: output });
    }
};
