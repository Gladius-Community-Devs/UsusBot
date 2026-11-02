const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const GROUPS = [
    {
        name: '👋 General',
        commands: ['hello']
    },
    {
        name: '⚔️ Skills & Classes',
        commands: ['skill', 'explain', 'classes', 'recruits']
    },
    {
        name: '🎁 Items & Prizes',
        commands: ['itemskill', 'itemprizes', 'prizes']
    },
    {
        name: '📊 Leagues & Stats',
        commands: ['stats']
    },
    {
        name: '🛠️ Mods & Tools',
        commands: ['modlist', 'cheats', 'updatemod', 'add_modder']
    }
];

function shortDescription(description) {
    const text = `${description || 'No description'}`.replace(/\s+/g, ' ').trim();
    return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

const SUMMARIES = {
    hello: 'Test that the bot responds',
    skill: 'Find a skill',
    explain: 'Explain a skill in plain language',
    classes: 'Browse gladiator classes',
    recruits: 'Find where to recruit a class',
    itemskill: 'Find items and their skills',
    itemprizes: 'Find where an item can be won',
    prizes: 'Browse league and encounter prizes',
    stats: 'Compare class stats by level',
    modlist: 'List the installed mods',
    cheats: 'Show Gladius cheat codes',
    updatemod: 'Upload a mod patch (modder)',
    add_modder: 'Manage modder access (admin)'
};

function commandLine(command) {
    const name = command.data ? command.data.name : command.name;
    const description = SUMMARIES[name] || (command.data ? command.data.description : command.description);
    return `**\`/${name}\`** — ${shortDescription(description)}`;
}

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Lists the available commands by category'),
    async execute(interaction, extra) {
        const module = extra.module_handler?.modules?.get('gladius');
        const commands = new Map();

        if (module && module.commands) {
            for (const [key, command] of module.commands) {
                const name = command.data ? command.data.name : command.name;
                if (typeof name !== 'string' || name.startsWith('h-')) continue;
                commands.set(name, command);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('UsusBot Commands')
            .setDescription(`**${commands.size} commands**. Use the slash menu to see each command's options and autocomplete.`)
            .setColor(0x00AE86);

        const grouped = new Set();
        for (const group of GROUPS) {
            const lines = group.commands
                .map(name => commands.get(name))
                .filter(Boolean)
                .map(commandLine);
            for (const name of group.commands) grouped.add(name);
            if (lines.length) {
                embed.addFields({
                    name: group.name,
                    value: lines.join('\n'),
                    inline: false
                });
            }
        }

        const other = [...commands.entries()]
            .filter(([name]) => !grouped.has(name))
            .map(([, command]) => commandLine(command));
        if (other.length) {
            embed.addFields({
                name: '📦 Other',
                value: other.join('\n'),
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};
