const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

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

        const debugLines = [];
        const warnLines = [];

        const sendError = (title, lines = []) => {
            return message.channel.send({
                content:
                    `❌ **${title}**\n` +
                    `**Mod:** ${modName}\n` +
                    (className ? `**Class:** ${className}\n` : '') +
                    (lines.length ? '\n' + lines.map(l => `• ${l}`).join('\n') : '')
            });
        };

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
            // Validate required files / folders
            // ─────────────────────────────────────────────
            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                return sendError('Missing required file', ['gladiators.txt not found']);
            }

            if (!fs.existsSync(filePaths.lookupFilePath)) {
                return sendError('Missing required file', ['lookuptext_eng.txt not found']);
            }

            if (!fs.existsSync(filePaths.leaguesPath)) {
                return sendError('Missing required folder', ['leagues folder not found']);
            }

            if (!fs.statSync(filePaths.leaguesPath).isDirectory()) {
                return sendError('Invalid leagues path', ['leagues exists but is not a directory']);
            }

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

                if (!fs.existsSync(filePaths.statsetsFilePath)) {
                    return sendError('Missing required file', ['statsets.txt required for statset5']);
                }
            }

            className = argsToProcess.join(' ').trim();
            if (!className) {
                return message.channel.send({ content: 'Please provide the class name.' });
            }

            const sanitizedClassName = helpers.sanitizeInput(className);

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

            const matchingGladiators = [];
            const statSetData = new Map();

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                const gladiator = { name: '', class: '', statSet: '' };

                for (const line of lines) {
                    if (line.startsWith('Name:')) gladiator.name = line.split(':')[1]?.trim();
                    else if (line.startsWith('Class:')) gladiator.class = line.split(':')[1]?.trim();
                    else if (line.startsWith('Stat set:')) gladiator.statSet = line.split(':')[1]?.trim();
                }

                if (!gladiator.name || !gladiator.class || gladiator.statSet === '') continue;

                const baseClass = applyClassVariantPatterns(gladiator.class);
                if (baseClass.toLowerCase() === sanitizedClassName.toLowerCase()) {
                    matchingGladiators.push(gladiator);

                    if (!statSetData.has(gladiator.statSet)) statSetData.set(gladiator.statSet, []);
                    statSetData.get(gladiator.statSet).push(gladiator);
                }
            }

            if (!matchingGladiators.length) {
                return sendError('No gladiators found', [
                    `No units found for class '${className}'`
                ]);
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

                    const nums = lvl30.split(':')[1]
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

                const ranked = [...statSetData.keys()]
                    .map(id => statAverages.has(id)
                        ? { id, ...statAverages.get(id), glads: statSetData.get(id) }
                        : null
                    )
                    .filter(Boolean)
                    .sort((a, b) => b.avg - a.avg);

                if (!ranked.length) {
                    return sendError('Statset filtering failed', [
                        'No valid statsets found for this class'
                    ]);
                }

                const best = ranked[0];
                targetGladiators = best.glads;

                filterDescription =
                    `\n**Top Statset:** ${best.id} ` +
                    `(CON ${best.stats[0]} | PWR ${best.stats[1]} | ACC ${best.stats[2]} | DEF ${best.stats[3]} | INI ${best.stats[4]})`;

                if (debugMode) {
                    debugLines.push(`Top statset: ${best.id} (avg ${best.avg.toFixed(2)})`);
                }
            }

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
            // Scan leagues
            // ─────────────────────────────────────────────
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(f => f.endsWith('.tok'));
            const arenaGroups = new Map();

            if (debugMode) debugLines.push(`League files scanned: ${leagueFiles.length}`);

            for (const file of leagueFiles) {
                const content = fs.readFileSync(path.join(filePaths.leaguesPath, file), 'utf8');

                let arena = file.replace('_league.tok', '').replace('.tok', '');
                const m = content.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);

                if (m && lookupMap[m[1]]) arena = lookupMap[m[1]];

                for (const g of targetGladiators) {
                    if (content.includes(g.name)) {
                        if (!arenaGroups.has(arena)) arenaGroups.set(arena, []);
                        arenaGroups.get(arena).push(g);
                    }
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

            embed.addFields({
                name: '📊 Summary',
                value: `Found **${matchingGladiators.length}** ${className} gladiators across **${arenaGroups.size}** arenas.`,
                inline: false
            });

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

            return message.channel.send({ embeds: [embed] });

        } catch (err) {
            console.error('[recruits]', err);
            return sendError('An error occurred while finding recruitment information', [
                err.message || 'Unknown error'
            ]);
        }
    }
};
