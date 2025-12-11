const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally filtered by the best stat set.',
    syntax: 'recruits [mod (optional)] [class name] [statset5 (optional)] [debug (optional as last arg)]',
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
        let index = 1; // after command name
        let className = '';

        // Flags
        let useStatSetFilter = false;
        let debugMode = false;

        // Debug info to optionally show in Discord
        const debugLines = [];
        const warnLines = [];

        // Helper: safe, readable error output
        const sendError = async (title, details = []) => {
            const msg =
                `❌ **${title}**\n` +
                (modName ? `**Mod:** ${modName}\n` : '') +
                (className ? `**Class:** ${className}\n` : '') +
                (details.length ? `\n${details.map(d => `• ${d}`).join('\n')}` : '');
            return message.channel.send({ content: msg });
        };

        try {
            // ─────────────────────────────────────────────
            // Load modders.json
            // ─────────────────────────────────────────────
            let moddersConfig;
            try {
                moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            } catch (e) {
                return sendError('Failed to read modders.json', [e.message]);
            }

            // ─────────────────────────────────────────────
            // Determine mod if args[1] matches a mod name
            // ─────────────────────────────────────────────
            const modNameInput = helpers.sanitizeInput(args[1]);
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2;
                    break;
                }
            }

            // Sanitize modName
            modName = path.basename(helpers.sanitizeInput(modName));

            // Get file paths
            const filePaths = helpers.getModFilePaths(modName);

            // ─────────────────────────────────────────────
            // Validate required files/folders
            // ─────────────────────────────────────────────
            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                return sendError('Missing required file', ['gladiators.txt not found for this mod.']);
            }

            if (!fs.existsSync(filePaths.lookupFilePath)) {
                return sendError('Missing required file', ['lookuptext_eng.txt not found for this mod.']);
            }

            if (!fs.existsSync(filePaths.leaguesPath)) {
                return sendError('Missing required folder', ['leagues folder not found for this mod.']);
            }

            // Ensure leaguesPath is a directory
            try {
                if (!fs.statSync(filePaths.leaguesPath).isDirectory()) {
                    return sendError('Invalid leagues path', ['leagues path exists but is not a folder.']);
                }
            } catch (e) {
                return sendError('Unable to stat leagues path', [e.message]);
            }

            // ─────────────────────────────────────────────
            // Parse trailing flags:
            // - debug only if it is the LAST ARG
            // - statset5 can appear at the end, or right before debug
            // Examples supported:
            //   recruits mod class
            //   recruits mod class statset5
            //   recruits mod class debug
            //   recruits mod class statset5 debug
            // ─────────────────────────────────────────────
            let argsToProcess = [...args.slice(index)];

            // debug ONLY if last arg
            if (argsToProcess.length && argsToProcess[argsToProcess.length - 1] === 'debug') {
                debugMode = true;
                argsToProcess.pop();
            }

            // statset5 can now be last after removing debug
            if (argsToProcess.length && argsToProcess[argsToProcess.length - 1] === 'statset5') {
                useStatSetFilter = true;
                argsToProcess.pop();

                if (!fs.existsSync(filePaths.statsetsFilePath)) {
                    return sendError('Missing required file', ['statsets.txt is required when using statset5.']);
                }
            }

            // Parse class name
            className = argsToProcess.join(' ').trim();
            if (!className) {
                return message.channel.send({ content: 'Please provide the class name.' });
            }

            const sanitizedClassName = helpers.sanitizeInput(className);

            // ─────────────────────────────────────────────
            // Function to apply class variant regex patterns
            // (keep behavior from older version)
            // ─────────────────────────────────────────────
            const applyClassVariantPatterns = (classInFile) => {
                let baseClass = classInFile;

                // Gender variant: trailing F
                if (baseClass.match(/^(.+)F$/)) {
                    baseClass = baseClass.replace(/^(.+)F$/, '$1');
                }

                // Regional/variant suffix: Imp|Nor|Ste|Exp|A|B (optional F)
                if (baseClass.match(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/)) {
                    baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
                }

                // Undead special-case preserved from old code
                if (baseClass.match(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/)) {
                    baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
                }

                return baseClass;
            };

            // ─────────────────────────────────────────────
            // Read gladiators.txt and find units matching class
            // ─────────────────────────────────────────────
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);

            const matchingGladiators = [];
            const statSetData = new Map(); // statSet -> array of gladiatorData

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                const gladiatorData = { name: '', class: '', statSet: '' };

                for (const line of lines) {
                    if (line.startsWith('Name:')) {
                        gladiatorData.name = line.split(':')[1]?.trim() ?? '';
                    } else if (line.startsWith('Class:')) {
                        gladiatorData.class = line.split(':')[1]?.trim() ?? '';
                    } else if (line.startsWith('Stat set:')) {
                        gladiatorData.statSet = line.split(':')[1]?.trim() ?? '';
                    }
                }

                if (gladiatorData.name && gladiatorData.class && gladiatorData.statSet !== '') {
                    const baseClass = applyClassVariantPatterns(gladiatorData.class);

                    if (baseClass.toLowerCase() === sanitizedClassName.toLowerCase()) {
                        matchingGladiators.push(gladiatorData);

                        if (!statSetData.has(gladiatorData.statSet)) statSetData.set(gladiatorData.statSet, []);
                        statSetData.get(gladiatorData.statSet).push(gladiatorData);
                    }
                }
            }

            if (!matchingGladiators.length) {
                return sendError('No gladiators found', [
                    `No units found for class '${className}' in '${modName}'.`,
                    `Tip: verify the internal class name (case-insensitive) and mod spelling.`
                ]);
            }

            // ─────────────────────────────────────────────
            // Optional: statset5 filtering (top statset by avg at level 30)
            // with robust parsing (no NaN)
            // ─────────────────────────────────────────────
            let targetGladiators = matchingGladiators;
            let filterDescription = '';

            if (useStatSetFilter) {
                const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
                const statsetChunks = statsetsContent.split(/\n\s*\n/);

                const statSetAverages = new Map(); // statSetNumber -> { average, statsObj }

                for (const chunk of statsetChunks) {
                    const lines = chunk.trim().split(/\r?\n/);
                    const statSetMatch = lines[0]?.match(/^Statset (\d+):$/);
                    if (!statSetMatch) continue;

                    const statSetNumber = statSetMatch[1];

                    const lvl30Line = lines.find(l => l.trim().startsWith('30:'));
                    if (!lvl30Line) {
                        if (debugMode) warnLines.push(`Statset ${statSetNumber}: missing level 30 line`);
                        continue;
                    }

                    // Robust parse: split on whitespace, Number(), filter finite
                    const rightSide = lvl30Line.split(':')[1] ?? '';
                    const nums = rightSide
                        .trim()
                        .split(/\s+/)
                        .map(Number)
                        .filter(Number.isFinite);

                    if (nums.length !== 5) {
                        if (debugMode) warnLines.push(`Statset ${statSetNumber}: malformed level 30 line "${lvl30Line}"`);
                        continue;
                    }

                    const average = nums.reduce((sum, n) => sum + n, 0) / 5;
                    statSetAverages.set(statSetNumber, {
                        average,
                        stats: { con: nums[0], pwr: nums[1], acc: nums[2], def: nums[3], ini: nums[4] }
                    });
                }

                const relevantStatSets = Array.from(statSetData.keys())
                    .map(statSet => {
                        const avgData = statSetAverages.get(statSet);
                        if (!avgData) {
                            if (debugMode) warnLines.push(`Missing statset data in statsets.txt for statset ${statSet}`);
                            return null;
                        }
                        return {
                            statSet,
                            average: avgData.average,
                            stats: avgData.stats,
                            gladiators: statSetData.get(statSet)
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.average - a.average)
                    .slice(0, 1);

                if (!relevantStatSets.length) {
                    return sendError('Statset filtering failed', [
                        `No valid statset data found for class '${className}' in '${modName}'.`,
                        `Tip: check that statsets.txt contains the statsets referenced by these units.`
                    ]);
                }

                const top = relevantStatSets[0];
                targetGladiators = top.gladiators;

                filterDescription =
                    `\n*Showing only gladiators with the top stat set by level 30 average stats*\n` +
                    `**Top Stat Set:** ${top.statSet} (Avg: ${top.average.toFixed(1)}) - ` +
                    `CON:${top.stats.con} PWR:${top.stats.pwr} ACC:${top.stats.acc} DEF:${top.stats.def} INI:${top.stats.ini}\n\n`;

                if (debugMode) {
                    debugLines.push(`Top statset chosen: ${top.statSet} (avg ${top.average.toFixed(2)})`);
                    debugLines.push(`Target gladiators after filter: ${targetGladiators.length}`);
                }
            }

            // ─────────────────────────────────────────────
            // Load lookup text for arena names
            // ─────────────────────────────────────────────
            let lookupTextMap = {};
            try {
                const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);
                lookupTextMap = idToText || {};
            } catch (e) {
                // Not fatal, but arena names may be fallback filenames
                warnLines.push(`Lookup text failed to load: ${e.message}`);
            }

            // ─────────────────────────────────────────────
            // Read league .tok files and find recruitment locations
            // ─────────────────────────────────────────────
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(f => f.endsWith('.tok'));
            const recruitmentData = new Map(); // gladiatorName -> { gladiator, arenas[] }

            if (debugMode) debugLines.push(`League files scanned: ${leagueFiles.length}`);

            for (const file of leagueFiles) {
                const filePath = path.join(filePaths.leaguesPath, file);

                let leagueContent;
                try {
                    leagueContent = fs.readFileSync(filePath, 'utf8');
                } catch (e) {
                    warnLines.push(`Failed reading ${file}: ${e.message}`);
                    continue;
                }

                // Extract arena name from OFFICENAME line (fallback to file name)
                let arenaName = file.replace('_league.tok', '').replace('.tok', '');
                const officeNameMatch = leagueContent.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);

                if (officeNameMatch) {
                    const lookupId = Number(officeNameMatch[1]);
                    if (Number.isFinite(lookupId) && lookupTextMap[lookupId]) {
                        arenaName = lookupTextMap[lookupId];
                    } else if (debugMode) {
                        warnLines.push(`Arena ${file}: OFFICENAME id=${officeNameMatch[1]} not found in lookup map`);
                    }
                } else if (debugMode) {
                    warnLines.push(`Arena ${file}: OFFICENAME not found; using filename fallback`);
                }

                // Check each target gladiator
                for (const gladiator of targetGladiators) {
                    if (leagueContent.includes(gladiator.name)) {
                        if (!recruitmentData.has(gladiator.name)) {
                            recruitmentData.set(gladiator.name, { gladiator, arenas: [] });
                        }
                        recruitmentData.get(gladiator.name).arenas.push(arenaName);
                    }
                }
            }

            // ─────────────────────────────────────────────
            // Build embed output (restored functionality)
            // ─────────────────────────────────────────────
            const embed = new EmbedBuilder()
                .setTitle(`🏛️ Recruitment Locations for ${className}`)
                .setDescription(`**Mod:** ${modName}${filterDescription}`)
                .setColor(0x00AE86)
                .setTimestamp();

            if (recruitmentData.size === 0) {
                embed.addFields({
                    name: 'No Recruitment Data Found',
                    value: `No recruitment information found for class '${className}' in any league files.`
                });
            } else {
                // Group by arena
                const arenaGroups = new Map(); // arenaName -> [{name, statSet, variant}]
                for (const [gladiatorName, data] of recruitmentData) {
                    for (const arena of data.arenas) {
                        if (!arenaGroups.has(arena)) arenaGroups.set(arena, []);
                        arenaGroups.get(arena).push({
                            name: gladiatorName,
                            statSet: data.gladiator.statSet,
                            variant: data.gladiator.class
                        });
                    }
                }

                // Sort arenas alphabetically
                const sortedArenas = Array.from(arenaGroups.keys()).sort((a, b) => a.localeCompare(b));

                for (const arena of sortedArenas) {
                    const gladiators = arenaGroups.get(arena);

                    // Sort gladiators by name
                    gladiators.sort((a, b) => a.name.localeCompare(b.name));

                    let gladiatorList = '';
                    for (const glad of gladiators) {
                        if (useStatSetFilter) {
                            gladiatorList += `• **${glad.name}** (${glad.variant}) - Stat Set ${glad.statSet}\n`;
                        } else {
                            gladiatorList += `• **${glad.name}** (${glad.variant})\n`;
                        }
                    }

                    // Discord field value limit
                    if (gladiatorList.length > 1024) {
                        gladiatorList = gladiatorList.slice(0, 1021) + '...';
                    }

                    embed.addFields({
                        name: `🏟️ ${arena}`,
                        value: gladiatorList || 'No gladiators found',
                        inline: true
                    });
                }

                // Summary
                const totalGladiators = recruitmentData.size;
                const totalArenas = arenaGroups.size;

                embed.addFields({
                    name: '📊 Summary',
                    value: `Found **${totalGladiators}** ${className} gladiators available across **${totalArenas}** arenas.`,
                    inline: false
                });
            }

            // Optional debug field
            if (debugMode) {
                const dbg = [];
                if (debugLines.length) dbg.push('**Debug:**', ...debugLines.map(x => `• ${x}`));
                if (warnLines.length) dbg.push('**Warnings:**', ...warnLines.map(x => `• ${x}`));

                const dbgText = dbg.join('\n').slice(0, 1024) || 'No debug info.';
                embed.addFields({
                    name: '🧪 Debug',
                    value: dbgText,
                    inline: false
                });
            }

            return message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Error finding recruits:', error);

            const details = [];
            details.push(error.message || 'Unknown error');

            // If it looks like a NaN / number issue, add a hint
            if ((error.message || '').toLowerCase().includes('invalid number')) {
                details.push('Hint: This often happens when stat parsing produced NaN. This version should prevent that—if it still occurs, run with "debug" and share the debug output.');
            }

            return sendError('An error occurred while finding recruitment information', details);
        }
    }
};
