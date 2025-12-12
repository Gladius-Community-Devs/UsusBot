const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const helpers = require('../functions');

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
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally filtered by statset.',
    syntax: 'recruits [mod (optional)] [class name] [statset5 (optional)] [debug (optional)]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,

    async execute(message, args) {
        if (args.length <= 1) {
            return message.channel.send({ content: 'Please provide the class name.' });
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');

        let modName = 'Vanilla';
        let index = 1;
        let className = '';

        let useStatSetFilter = false;
        let debugMode = false;

        try {
            // ─────────────────────────────────────────────
            // Load modders.json
            // ─────────────────────────────────────────────
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // ─────────────────────────────────────────────
            // Detect mod name
            // ─────────────────────────────────────────────
            const modNameInput = helpers.sanitizeInput(args[1]);
            for (const modder in moddersConfig) {
                const cfgName = moddersConfig[modder]
                    .replace(/\s+/g, '_')
                    .toLowerCase();

                if (cfgName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2;
                    break;
                }
            }

            modName = path.basename(helpers.sanitizeInput(modName));
            const filePaths = helpers.getModFilePaths(modName);

            // ─────────────────────────────────────────────
            // Parse trailing flags
            // ─────────────────────────────────────────────
            let argsToProcess = [...args.slice(index)];

            if (argsToProcess.at(-1) === 'debug') {
                debugMode = true;
                argsToProcess.pop();
            }

            if (argsToProcess.at(-1) === 'statset5') {
                useStatSetFilter = true;
                argsToProcess.pop();
            }

            className = argsToProcess.join(' ').trim();
            if (!className) {
                return message.channel.send({ content: 'Please provide the class name.' });
            }

            const result = this.generateRecruitsEmbed(modName, className, useStatSetFilter, debugMode);

            if (result.error) {
                return message.channel.send({
                    content:
                        `❌ **${result.error.title}**\n` +
                        `**Mod:** ${modName}\n` +
                        (className ? `**Class:** ${className}\n` : '') +
                        (result.error.lines.length ? '\n' + result.error.lines.map(l => `• ${l}`).join('\n') : '')
                });
            }

            // Create dropdowns
            const rows = [];
            if (result.allClasses && result.allClasses.length > 0) {
                const encodedModName = encodeURIComponent(modName);
                // Filter out duplicates and sort (already done in generateRecruitsEmbed, but good to be safe)
                const classOptions = result.allClasses.map(cls => ({
                    label: cls.charAt(0).toUpperCase() + cls.slice(1),
                    value: encodeURIComponent(cls.toLowerCase())
                }));

                // Split into chunks of 25
                for (let i = 0; i < classOptions.length; i += 25) {
                    const optionsChunk = classOptions.slice(i, i + 25);
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`recruits-class-select|${encodedModName}|${i}`)
                        .setPlaceholder('Select a class')
                        .addOptions(optionsChunk);
                    rows.push(new ActionRowBuilder().addComponents(selectMenu));
                }
            }

            return message.channel.send({ embeds: [result.embed], components: rows });

        } catch (err) {
            console.error('[recruits]', err);
            return message.channel.send({ content: 'An error occurred while finding recruitment information.' });
        }
    },

    generateRecruitsEmbed(modName, className, useStatSetFilter, debugMode) {
        const debugLines = [];
        const warnLines = [];
        const filePaths = helpers.getModFilePaths(modName);
        const sanitizedClassName = helpers.sanitizeInput(className);

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
        // Class variant handling (unchanged)
        // ─────────────────────────────────────────────
        const applyClassVariantPatterns = (classInFile) => {
            let baseClass = classInFile;

            if (/^(.+)F$/.test(baseClass)) {
                baseClass = baseClass.replace(/^(.+)F$/, '$1');
            }

            if (/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/.test(baseClass)) {
                baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
            }

            if (/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/.test(baseClass)) {
                baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
            }

            return baseClass;
        };

        // ─────────────────────────────────────────────
        // Read gladiators.txt
        // ─────────────────────────────────────────────
        const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
        const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);

        const allGladiators = []; // full parsed list for cross-check
        const allGladiatorNames = new Set();

        const matchingGladiators = [];
        const statSetData = new Map();
        const allClassesSet = new Set();

        for (const chunk of gladiatorChunks) {
            const lines = chunk.trim().split(/\r?\n/);
            const gladiator = { name: '', class: '', statSet: '' };

            for (const line of lines) {
                if (line.startsWith('Name:')) gladiator.name = line.split(':')[1]?.trim();
                else if (line.startsWith('Class:')) gladiator.class = line.split(':')[1]?.trim();
                else if (line.startsWith('Stat set:')) gladiator.statSet = line.split(':')[1]?.trim();
            }

            if (!gladiator.name || !gladiator.class || gladiator.statSet === '') continue;

            allGladiators.push(gladiator);
            allGladiatorNames.add(gladiator.name);

            const baseClass = applyClassVariantPatterns(gladiator.class);
            allClassesSet.add(baseClass.toLowerCase());

            if (baseClass.toLowerCase() === sanitizedClassName.toLowerCase()) {
                matchingGladiators.push(gladiator);

                if (!statSetData.has(gladiator.statSet)) statSetData.set(gladiator.statSet, []);
                statSetData.get(gladiator.statSet).push(gladiator);
            }
        }

        const allClasses = [...allClassesSet].sort();

        if (!matchingGladiators.length) {
            return { 
                error: { title: 'No gladiators found', lines: [`No units found for class '${className}'`] },
                allClasses 
            };
        }

        let targetGladiators = matchingGladiators;
        let filterDescription = '';

        // ─────────────────────────────────────────────
        // Statset5 filtering (hardened, unchanged behavior)
        // ─────────────────────────────────────────────
        if (useStatSetFilter) {
            const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
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
                content = fs.readFileSync(filePath, 'utf8');
            } catch (e) {
                warnLines.push(`Failed to read ${file}: ${e.message}`);
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

        // Identify target-class gladiators that never appear in any recruit list
        const neverRecruited = [];
        for (const g of targetGladiators) {
            if (!arenasMatchedByGladiator.has(g.name)) {
                neverRecruited.push(g.name);
            }
        }

        // NEW: compute accurate counts for summary
        const recruitedUniqueNames = new Set();
        for (const glads of arenaGroups.values()) {
            for (const g of glads) recruitedUniqueNames.add(g.name);
        }
        const recruitedUniqueCount = recruitedUniqueNames.size;
        const arenasWithRecruitsCount = arenaGroups.size;

        if (debugMode) {
            debugLines.push(`Class-matched gladiators in gladiators.txt: ${matchingGladiators.length}`);
            debugLines.push(`Unique recruits found (after filters): ${recruitedUniqueCount}`);

            if (skippedNoRecruit.length) {
                debugLines.push(`Skipped (no RECRUIT lines): ${capList(skippedNoRecruit, 6).join(', ')}`);
            }
            if (unknownRecruitNamesGlobal.size) {
                warnLines.push(
                    `Unknown recruits (in leagues but not gladiators.txt): ` +
                    `${capList([...unknownRecruitNamesGlobal], 10).join(', ')}`
                );
            }
            if (neverRecruited.length) {
                warnLines.push(
                    `${neverRecruited.length} target units never appeared in any RECRUIT list (showing some): ` +
                    `${capList(neverRecruited, 10).join(', ')}`
                );
            }
        }

        // ─────────────────────────────────────────────
        // Build embed (FIELD LIMIT SAFE)
        // ─────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Recruitment Locations for ${className}`)
            .setDescription(`**Mod:** ${modName}${filterDescription}`)
            .setColor(0x00AE86)
            .setTimestamp();

        if (arenaGroups.size === 0) {
            embed.addFields({
                name: 'No Recruitment Data Found',
                value:
                    `No recruit entries found for **${className}**.\n` +
                    `This usually means either:\n` +
                    `• There are no RECRUIT lines for these units in any league .tok files\n` +
                    `• The league .tok recruit names don’t match gladiators.txt names exactly`,
                inline: false
            });
        } else {
            const MAX_FIELDS = 25;
            let usedFields = 0;

            const arenas = [...arenaGroups.keys()].sort();

            for (const arena of arenas) {
                if (usedFields >= MAX_FIELDS - 2) break;

                const glads = arenaGroups.get(arena).sort((a, b) => a.name.localeCompare(b.name));
                let value = '';

                for (const g of glads) {
                    value += `• **${g.name}** (${g.class})\n`;
                    if (value.length > 1000) {
                        value = value.slice(0, 997) + '...';
                        break;
                    }
                }

                embed.addFields({
                    name: `🏟️ ${arena}`,
                    value: value || 'No gladiators found',
                    inline: true
                });

                usedFields++;
            }

            if (arenas.length > MAX_FIELDS - 2) {
                embed.addFields({
                    name: '⚠️ Truncated',
                    value: 'Some arenas were omitted due to Discord embed limits.',
                    inline: false
                });
            }

            // UPDATED: summary uses actual recruitable unique count
            embed.addFields({
                name: '📊 Summary',
                value: `Found **${recruitedUniqueCount}** recruitable ${className} gladiators across **${arenasWithRecruitsCount}** arenas.`,
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
