const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    needs_api: true,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('module')
        .setDescription('Enable or disable a module, or check whether the module is enabled.')
        .addStringOption(option => 
            option.setName('action')
                .setDescription('The action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'enable', value: 'enable' },
                    { name: 'disable', value: 'disable' },
                    { name: 'status', value: 'status' }
                ))
        .addStringOption(option => 
            option.setName('module_name')
                .setDescription('The name of the module')
                .setRequired(true)),
    async execute(interaction, extra) {
        if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
            await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            return;
        }
        var api = extra.api;
        
        const action = interaction.options.getString('action');
        const moduleName = interaction.options.getString('module_name');

        var respModule = await api.get('module', {
            name: moduleName
        });

        if (!respModule || !respModule.modules || respModule.modules.length <= 0) {
            await interaction.reply({ content: "Sorry, I couldn't find that module!", ephemeral: true });
            return;
        }

        var target_module_id = respModule.modules[0].module_id;

        var respEnabled = await api.get('enabled_module', {
            server_id: interaction.guild.id,
            module_id: target_module_id
        });

        if (action == "enable") {
            if (!respEnabled.enabled_modules || respEnabled.enabled_modules.length == 0) {
                await api.post('enabled_module', {
                    module_id: parseInt(target_module_id),
                    server_id: interaction.guild.id
                });
                await interaction.reply({ content: "Successfully enabled module on this server!" });
            } else {
                await interaction.reply({ content: "That module is already enabled on this server!" });
            }
        } else if (action == "disable") {
            if (!respEnabled.enabled_modules || respEnabled.enabled_modules.length == 0) {
                await interaction.reply({ content: "That module is already disabled on this server!" });
            } else {
                await api.delete('enabled_module', {
                    link_id: parseInt(respEnabled.enabled_modules[0].link_id)
                });
                await interaction.reply({ content: "Successfully disabled module on this server!" });
            }
        } else if (action == "status") {
            if (!respEnabled.enabled_modules || respEnabled.enabled_modules.length == 0) {
                await interaction.reply({ content: "Module Status: Disabled" });
            } else {
                await interaction.reply({ content: "Module Status: Enabled" });
            }
        }
    }
};
