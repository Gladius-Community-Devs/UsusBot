const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const helpers = require('../functions');
const classCatalog = require('../class_catalog');

/**
 * Extract ONLY recruit names from a league .tok file.
 * This prevents false positives from common words like "Dark".
 *
 * Expected format example:
 *   RECRUIT "Alexander" 0 1000 ...
 */
const extractRecruitNamesFromLeagueTok = (leagueContent) => {
    const names = new Set();

    // Multiline + case-insensitive:
    // Captures: RECRUIT "Some Name" ...
    const re = /^\s*RECRUIT\s+"([^"]+)"\s+/gmi;

    let m;
    while ((m = re.exec(leagueContent)) !== null) {
        const name = (m[1] || '').trim();
        if (name) names.add(name);
    }
    return names;
};

/**
 * Utility: cap an array for debug display.
 */
const capList = (arr, max = 10) => {
    if (arr.length <= max) return arr;
    return [...arr.slice(0, max), `...(+${arr.length - max} more)`];
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recruits')
        .setDescription('Shows where to recruit gladiators of a specified class')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('class_name')
                .setDescription('The class name to search for')
                .setRequired(true)
                .setAutocomplete(true))
        .addBooleanOption(opt =>
            opt.setName('statset5')
                .setDescription('Filter results by the best statset at level 30')
                .setRequired(false))
        .addBooleanOption(opt =>
            opt.setName('debug')
                .setDescription('Show internal debug information')
                .setRequired(false)),
    name: 'recruits',
    needs_api: false,
    has_state: false,
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
                await interaction.respond(classCatalog.classChoices(catalog.recruitClasses, focused));
            } catch (error) {
                this.logger.error(`Failed to load recruits class autocomplete data for ${modName}:`, error);
                await interaction.respond([]);
            }
        }
    },

    async execute(interaction, extra) {
        await interaction.deferReply();

        const className = (interaction.options.getString('class_name') || '').trim();
        const modNameInput = interaction.options.getString('mod_name');
        const useStatSetFilter = interaction.options.getBoolean('statset5') ?? false;
        const debugMode = interaction.options.getBoolean('debug') ?? false;

        let modName = 'Vanilla';

        try {
            if (modNameInput) {
                modName = helpers.resolveModName(modNameInput);
            }

            modName = helpers.resolveModName(helpers.sanitizeInput(modName));

            const result = this.generateRecruitsEmbed(modName, className, useStatSetFilter, debugMode);

            if (result.error) {
                return interaction.editReply({
                    content:
                        `❌ **${result.error.title}**\n` +
                        `**Mod:** ${modName}\n` +
                        (className ? `**Class:** ${className}\n` : '') +
                        (result.error.lines.length ? '\n' + result.error.lines.map(l => `• ${l}`).join('\n') : '')
                });
            }

            // Create class-browser dropdowns
            const rows = [];
            if (result.allClasses && result.allClasses.length > 0) {
                const encodedModName = encodeURIComponent(modName);
                const classOptions = result.allClasses.map(cls => ({
                    label: cls.label,
                    value: encodeURIComponent(cls.code)
                }));

                for (let i = 0; i < classOptions.length; i += 25) {
                    const optionsChunk = classOptions.slice(i, i + 25);
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`recruits-class-select|${encodedModName}|${i}`)
                        .setPlaceholder('Select a class')
                        .addOptions(optionsChunk);
                    rows.push(new ActionRowBuilder().addComponents(selectMenu));
                }
            }

            return interaction.editReply({ embeds: [result.embed], components: rows });

        } catch (err) {
            this.logger.error('Error finding recruitment information:', err);
            return interaction.editReply({ content: 'An error occurred while finding recruitment information.' });
        }
    },

    generateRecruitsEmbed(modName, className, useStatSetFilter, debugMode) {
        const debugLines = [];
        const warnLines = [];
        const filePaths = helpers.getModFilePaths(modName);

        // ─────────────────────────────────────────────
        // Validate required files / folders
        // ─────────────────────────────────────────────
        if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
            return { error: { title: 'Missing required file', lines: ['gladiators.txt not found'] } };
        }

        if (!fs.existsSync(filePaths.lookupFilePath)) {
            return { error: { title: 'Missing required file', lines: ['lookuptext_eng.txt not found'] } };
        }

        if (!fs.existsSync(filePaths.leaguesPath)) {
            return { error: { title: 'Missing required folder', lines: ['leagues folder not found'] } };
        }

        if (!fs.statSync(filePaths.leaguesPath).isDirectory()) {
            return { error: { title: 'Invalid leagues path', lines: ['leagues exists but is not a directory'] } };
        }

        if (useStatSetFilter && !fs.existsSync(filePaths.statsetsFilePath)) {
            return { error: { title: 'Missing required file', lines: ['statsets.txt required for statset5'] } };
        }

        // ─────────────────────────────────────────────
        // Resolve the class through the catalog
        // ─────────────────────────────────────────────
        const catalog = classCatalog.getCatalog(modName);
        const resolvedClass = classCatalog.resolveClassInput(className, catalog);
        const allClasses = catalog.recruitClasses.map((cls) => ({ code: cls.code, label: cls.label }));

        if (!resolvedClass) {
            return { error: { title: 'No class named', lines: [`No class named '${className}' in '${modName}'.`] }, allClasses };
        }

        const targetCodes = new Set(resolvedClass.codes.map((code) => code.toLowerCase()));
        const classLabel = resolvedClass.label;

        // ─────────────────────────────────────────────
        // Read gladiators.txt
        // ─────────────────────────────────────────────
        const gladiatorsContent = helpers.readTextFile(filePaths.gladiatorsFilePath);
        const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);

        const allGladiators = [];
        const allGladiatorNames = new Set();
        const matchingGladiators = [];
        const statSetData = new Map();

        for (const chunk of gladiatorChunks) {
            const lines = chunk.trim().split(/\r?\n/);
            const gladiator = { name: '', class: '', statSet: '', school: 0 };

            for (const line of lines) {
                if (line.startsWith('Name:')) gladiator.name = line.split(':')[1]?.trim();
                else if (line.startsWith('Class:')) gladiator.class = line.split(':')[1]?.trim();
                else if (line.startsWith('Stat set:')) gladiator.statSet = line.split(':')[1]?.trim();
                else if (line.startsWith('School:')) gladiator.school = Number.parseInt(line.split(':')[1]?.trim(), 10) || 0;
            }

            if (!gladiator.name || !gladiator.class || gladiator.statSet === '') continue;

            allGladiators.push(gladiator);
            allGladiatorNames.add(gladiator.name);

            if (targetCodes.has(gladiator.class.toLowerCase())) {
                matchingGladiators.push(gladiator);
                if (!statSetData.has(gladiator.statSet)) statSetData.set(gladiator.statSet, []);
                statSetData.get(gladiator.statSet).push(gladiator);
            }
        }

        if (!matchingGladiators.length) {
            return {
                error: { title: 'No gladiators found', lines: [`No units found for class '${classLabel}'`] },
                allClasses
            };
        }

        let targetGladiators = matchingGladiators;
        let filterDescription = '';

        // ─────────────────────────────────────────────
        // Statset5 filtering (hardened, unchanged behavior)
        // ─────────────────────────────────────────────
        if (useStatSetFilter) {
            const statsetsContent = helpers.readTextFile(filePaths.statsetsFilePath);
            const statChunks = statsetsContent.split(/\n\s*\n/);
            const statAverages = new Map();

            for (const chunk of statChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                const match = lines[0]?.match(/^Statset (\d+):$/);
                if (!match) continue;

                const statSetNum = match[1];
                const lvl30 = lines.find(l => l.trim().startsWith('30:'));
                if (!lvl30) {
                    if (debugMode) warnLines.push(`Statset ${statSetNum} missing level 30`);
                    continue;
                }

                const nums = (lvl30.split(':')[1] || '')
                    .trim()
                    .split(/\s+/)
                    .map(Number)
                    .filter(Number.isFinite);

                if (nums.length !== 5) {
                    if (debugMode) warnLines.push(`Malformed statset ${statSetNum}: ${lvl30}`);
                    continue;
                }

                statAverages.set(statSetNum, {
                    avg: nums.reduce((a, b) => a + b, 0) / 5,
                    stats: nums
                });
            }

            // rank only statsets used by our matching class
            const ranked = [...statSetData.keys()]
                .map(id => {
                    if (!statAverages.has(id)) return null;
                    return { id, ...statAverages.get(id), glads: statSetData.get(id) };
                })
                .filter(Boolean)
                .sort((a, b) => b.avg - a.avg);

            if (!ranked.length) {
                // explain which statsets were referenced but missing in statsets.txt
                const missing = [...statSetData.keys()].filter(id => !statAverages.has(id));
                return { 
                    error: { 
                        title: 'Statset filtering failed', 
                        lines: ['No valid statsets found for this class.', missing.length ? `Missing statsets in statsets.txt: ${missing.join(', ')}` : ''] 
                    },
                    allClasses
                };
            }

            const best = ranked[0];
            targetGladiators = best.glads;

            filterDescription =
                `\n**Top Statset:** ${best.id} ` +
                `(CON ${best.stats[0]} | PWR ${best.stats[1]} | ACC ${best.stats[2]} | DEF ${best.stats[3]} | INI ${best.stats[4]})`;

            if (debugMode) {
                debugLines.push(`Top statset: ${best.id} (avg ${best.avg.toFixed(2)})`);
                debugLines.push(`Target gladiators after statset filter: ${targetGladiators.length}`);
            }
        }

        // Fast lookup for target gladiators by name (exact match)
        const targetByName = new Map(targetGladiators.map(g => [g.name, g]));

        // ─────────────────────────────────────────────
        // Load lookup text
        // ─────────────────────────────────────────────
        let lookupMap = {};
        try {
            const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);
            lookupMap = idToText || {};
        } catch (e) {
            warnLines.push(`Lookup load failed: ${e.message}`);
            this.logger.error(`Lookup load failed for recruits in ${modName}:`, e);
        }

        // ─────────────────────────────────────────────
        // Scan leagues (robust recruit parsing + cross-check)
        // ─────────────────────────────────────────────
        const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(f => f.endsWith('.tok'));
        const arenaGroups = new Map(); // arenaName -> [gladiator objects]
        const arenasMatchedByGladiator = new Map(); // gladiator name -> set(arenas)

        const skippedNoRecruit = [];
        const unknownRecruitNamesGlobal = new Set();

        if (debugMode) debugLines.push(`League files scanned: ${leagueFiles.length}`);

        for (const file of leagueFiles) {
            const filePath = path.join(filePaths.leaguesPath, file);

            let content;
            try {
                content = helpers.readTextFile(filePath);
            } catch (e) {
                warnLines.push(`Failed to read ${file}: ${e.message}`);
                this.logger.error(`Failed to read recruits league file ${file} for ${modName}:`, e);
                continue;
            }

            // Resolve arena name
            let arena = file.replace('_league.tok', '').replace('.tok', '');
            const m = content.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);
            if (m && lookupMap[m[1]]) arena = lookupMap[m[1]];

            // Extract recruit list ONLY
            const recruitNames = extractRecruitNamesFromLeagueTok(content);

            if (recruitNames.size === 0) {
                skippedNoRecruit.push(file);
                continue; // no recruits in this file => cannot recruit anyone here
            }

            const matchedHere = [];
            const unknownHere = [];

            for (const rName of recruitNames) {
                // Cross-check against gladiators.txt
                if (!allGladiatorNames.has(rName)) {
                    unknownRecruitNamesGlobal.add(rName);
                    unknownHere.push(rName);
                    continue;
                }

                // Only include recruits belonging to our target class (or filtered statset)
                if (targetByName.has(rName)) {
                    const gladiator = targetByName.get(rName);

                    if (!arenaGroups.has(arena)) arenaGroups.set(arena, []);
                    arenaGroups.get(arena).push(gladiator);

                    matchedHere.push(rName);

                    if (!arenasMatchedByGladiator.has(rName)) {
                        arenasMatchedByGladiator.set(rName, new Set());
                    }
                    arenasMatchedByGladiator.get(rName).add(arena);
                }
            }

            if (debugMode) {
                debugLines.push(
                    `${arena}: recruits=${recruitNames.size}, matched=${matchedHere.length}` +
                    (unknownHere.length ? `, unknown=${unknownHere.length}` : '')
                );

                if (matchedHere.length) {
                    debugLines.push(`  matched: ${capList(matchedHere, 6).join(', ')}`);
                }
                if (unknownHere.length) {
                    warnLines.push(`  ${arena} unknown recruits: ${capList(unknownHere, 6).join(', ')}`);
                }
            }
        }

        // Remove duplicates per arena (same gladiator can appear multiple times in RECRUIT lines)
        for (const [arena, glads] of arenaGroups.entries()) {
            const seen = new Set();
            const deduped = [];
            for (const g of glads) {
                const key = `${g.name}||${g.class}||${g.statSet}`;
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(g);
            }
            arenaGroups.set(arena, deduped);
        }

        // Target-class units that never appear in a league RECRUIT list
        const neverRecruited = [];
        for (const g of targetGladiators) {
            if (!arenasMatchedByGladiator.has(g.name)) neverRecruited.push(g.name);
        }

        const recruitedUniqueNames = new Set();
        for (const glads of arenaGroups.values()) for (const g of glads) recruitedUniqueNames.add(g.name);
        const recruitedUniqueCount = recruitedUniqueNames.size;
        const arenasWithRecruitsCount = arenaGroups.size;

        if (debugMode) {
            debugLines.push(`Class-matched gladiators in gladiators.txt: ${matchingGladiators.length}`);
            debugLines.push(`Unique recruits found (after filters): ${recruitedUniqueCount}`);
            if (skippedNoRecruit.length) {
                debugLines.push(`Skipped (no RECRUIT lines): ${capList(skippedNoRecruit, 6).join(', ')}`);
            }
            if (unknownRecruitNamesGlobal.size) {
                warnLines.push(`Unknown recruits (in leagues but not gladiators.txt): ${capList([...unknownRecruitNamesGlobal], 10).join(', ')}`);
            }
            if (neverRecruited.length) {
                warnLines.push(`${neverRecruited.length} target units never appeared in any RECRUIT list (showing some): ${capList(neverRecruited, 10).join(', ')}`);
            }
        }

        // Build embed, field-limit safe
        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Recruitment Locations for ${classLabel}`)
            .setDescription(`**Mod:** ${modName}${filterDescription}`)
            .setColor(0x00AE86)
            .setTimestamp();

        const MAX_FIELDS = 25;
        let usedFields = 0;
        const addLocationField = (name, glads) => {
            if (usedFields >= MAX_FIELDS - 2) return;
            let value = '';
            for (const gladiator of glads.sort((a, b) => a.name.localeCompare(b.name))) {
                value += `• **${gladiator.name}** (${gladiator.class})\n`;
                if (value.length > 1000) {
                    value = value.slice(0, 997) + '...';
                    break;
                }
            }
            embed.addFields({ name, value: value || 'No gladiators found', inline: true });
            usedFields++;
        };

        for (const arena of [...arenaGroups.keys()].sort()) addLocationField(`🏟️ ${arena}`, arenaGroups.get(arena));

        if (arenasWithRecruitsCount > usedFields) {
            embed.addFields({ name: '⚠️ Truncated', value: 'Some locations were omitted due to Discord embed limits.', inline: false });
        }

        if (arenasWithRecruitsCount === 0) {
            embed.addFields({
                name: 'No Standard Location',
                value: `No league RECRUIT lines for **${classLabel}**.\n` +
                    'These units are event or story rewards rather than standard recruits.',
                inline: false
            });
        } else {
            embed.addFields({
                name: '📊 Summary',
                value: `Found **${recruitedUniqueCount}** recruitable ${classLabel} gladiators across **${arenasWithRecruitsCount}** arenas.`,
                inline: false
            });
        }

        // ─────────────────────────────────────────────
        // Debug embed field
        // ─────────────────────────────────────────────
        if (debugMode) {
            const dbg = [];
            if (debugLines.length) dbg.push('**Debug**', ...debugLines.map(l => `• ${l}`));
            if (warnLines.length) dbg.push('**Warnings**', ...warnLines.map(l => `• ${l}`));

            embed.addFields({
                name: '🧪 Debug',
                value: dbg.join('\n').slice(0, 1024) || 'No debug info.',
                inline: false
            });
        }

        return { embed, allClasses, error: null };
    }
};

