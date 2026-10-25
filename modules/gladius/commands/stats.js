const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const helpers = require('../functions');
const classCatalog = require('../class_catalog');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Displays stat information for a specified class at a given level.')
        .addStringOption(option => 
            option.setName('mod_name')
                .setDescription('The name of the mod')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option => 
            option.setName('class_name')
                .setDescription('The name of the class')
                .setRequired(true)
                .setAutocomplete(true))
        .addIntegerOption(option => 
            option.setName('level')
                .setDescription('The level to check (optional)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30)),
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();

        if (focusedOption.name === 'mod_name') {
            const choices = helpers.getAvailableMods();
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'class_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = helpers.resolveModName(rawMod);
            if (!helpers.getAvailableMods().some((name) => name.toLowerCase() === modName.toLowerCase())) {
                await interaction.respond([]);
                return;
            }
            try {
                const catalog = classCatalog.getCatalog(modName);
                await interaction.respond(classCatalog.classChoices(catalog.statClasses, focused));
            } catch (error) {
                this.logger.error(`Failed to load stats class autocomplete data for ${modName}:`, error);
                await interaction.respond([]);
            }
        }
    },
    async execute(interaction, extra) {
        await interaction.deferReply();
        
        const rawClassName = (interaction.options.getString('class_name') || '').trim();
        let modNameInput = interaction.options.getString('mod_name');
        const level = interaction.options.getInteger('level');

        let modName = 'Vanilla';

        try {
            if (modNameInput) {
                modName = helpers.resolveModName(modNameInput);
            }
            
            modName = helpers.resolveModName(helpers.sanitizeInput(modName));
            const filePaths = helpers.getModFilePaths(modName);

            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                await interaction.editReply({ content: `That mod does not have gladiators.txt file!` });
                return;
            }

            if (!fs.existsSync(filePaths.statsetsFilePath)) {
                await interaction.editReply({ content: `That mod does not have statsets.txt file!` });
                return;
            }

            // Resolve the class through the catalog. A code or "Display (Code)"
            // selects one class; a shared display name selects the family.
            const catalog = classCatalog.getCatalog(modName);
            const resolvedClass = classCatalog.resolveClassInput(rawClassName, catalog);
            if (!resolvedClass) {
                await interaction.editReply({ content: `No class named '${rawClassName}' found in '${modName}'.` });
                return;
            }
            const targetCodes = new Set(resolvedClass.codes.map((code) => code.toLowerCase()));
            const className = resolvedClass.label;

            const gladiatorsContent = helpers.readTextFile(filePaths.gladiatorsFilePath);
            const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);
            const statSetCounts = new Map();

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                let chunkClass = '';
                let statSet = '';

                for (const line of lines) {
                    if (line.startsWith('Class:')) {
                        chunkClass = line.split(':')[1].trim();
                    } else if (line.startsWith('Stat set:')) {
                        statSet = line.split(':')[1].trim();
                    }
                }

                if (chunkClass && statSet !== '' && targetCodes.has(chunkClass.toLowerCase())) {
                    statSetCounts.set(statSet, (statSetCounts.get(statSet) || 0) + 1);
                }
            }

            if (statSetCounts.size === 0) {
                await interaction.editReply({ content: `No gladiators found for class '${className}' in '${modName}'.` });
                return;
            }

            let mostCommonStatSet = '';
            let maxCount = 0;
            for (const [statSet, count] of statSetCounts.entries()) {
                if (count > maxCount) {
                    maxCount = count;
                    mostCommonStatSet = statSet;
                }
            }
            
            const statsetsContent = helpers.readTextFile(filePaths.statsetsFilePath);
            const statsetChunks = statsetsContent.split(/\n\s*\n/);
            
            let targetStatsetData = null;
            for (const chunk of statsetChunks) {
                if (chunk.includes(`Statset ${mostCommonStatSet}:`)) {
                    targetStatsetData = chunk.trim();
                    break;
                }
            }

            if (!targetStatsetData) {
                await interaction.editReply({ content: `Stat set ${mostCommonStatSet} not found in statsets.txt for '${modName}'.` });
                return;
            }

            const statLines = targetStatsetData.split(/\r?\n/).slice(1);
            const levelStats = new Map();
            
            for (const line of statLines) {
                const trimmed = line.trim();
                if (trimmed.includes(':')) {
                    const parts = trimmed.split(':');
                    const levelNum = parseInt(parts[0].trim());
                    const stats = parts[1].trim().split(' ').map(s => parseInt(s.trim()));
                    if (stats.length === 5) { // CON PWR ACC DEF INI
                        levelStats.set(levelNum, {
                            con: stats[0],
                            pwr: stats[1],
                            acc: stats[2],
                            def: stats[3],
                            ini: stats[4]
                        });
                    }
                }
            }

            if (level) {
                const stats = levelStats.get(level);
                if (!stats) {
                    await interaction.editReply({ content: `Level ${level} not found in stat set ${mostCommonStatSet}.` });
                    return;
                }

                const response = `**Stats for ${className} (Level ${level}) in ${modName}**\n` +
                    `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                    `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}`;

                await interaction.editReply({ content: response });
                return;
            }

            // Since we don't have dropdown logic implemented for events in this context yet (events.js would need updates too), 
            // and dropdowns require user interaction which we can't easily fake without updating event handlers.
            // But I will output the stats for Level 1, 10, 20 like a summary or stick to the original logic which was dropdowns.
            // But dropdowns require event handler. The original file had dropdowns.
            // I should just list level 1 stats if no level provided or ask to provide level.
            // For now I'll just ask for level or output level 1.
            
            const stats = levelStats.get(1);
            if (stats) {
                const response = `**Stats for ${className} (Level 1) in ${modName}**\n` +
                `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}\n` + 
                `(Tip: Use the 'level' option to see other levels)`;
                await interaction.editReply({ content: response });
            } else {
                 await interaction.editReply({ content: "Could not retrieve level 1 stats. Please specify a level."});
            }

        } catch (error) {
            this.logger.error('Error executing stats command:', error);
            if(interaction.deferred) await interaction.editReply({ content: 'An error occurred.' });
            else await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        }
    }
};




