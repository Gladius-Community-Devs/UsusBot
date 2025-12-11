const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally filtered by the best stat set.',
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

        try {
            // ─────────────────────────────────────────────
            // Load modders.json
            // ─────────────────────────────────────────────
            const moddersConfig = JSON.parse(
                fs.readFileSync(moddersConfigPath, 'utf8')
            );

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
            // Validate required files and folders
            // ─────────────────────────────────────────────
            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                return message.channel.send({
                    content: `**Mod:** ${modName}\n❌ Missing gladiators.txt`
                });
            }

            if (!fs.existsSync(filePaths.lookupFilePath)) {
                return message.channel.send({
                    content: `**Mod:** ${modName}\n❌ Missing lookuptext_eng.txt`
                });
            }

            if (!fs.existsSync(filePaths.leaguesPath)) {
                return message.channel.send({
                    content: `**Mod:** ${modName}\n❌ Missing leagues folder`
                });
            }

            if (!fs.statSync(filePaths.leaguesPath).isDirectory()) {
                return message.channel.send({
                    content: `**Mod:** ${modName}\n❌ leagues path exists but is not a folder`
                });
            }

            // ─────────────────────────────────────────────
            // Parse trailing flags (statset5 / debug)
            // ─────────────────────────────────────────────
            let argsToProcess = [...args.slice(index)];

            while (argsToProcess.length) {
                const last = argsToProcess[argsToProcess.length - 1];
                if (last === 'statset5') {
                    useStatSetFilter = true;
                    argsToProcess.pop();
                } else if (last === 'debug') {
                    debugMode = true;
                    argsToProcess.pop();
                } else {
                    break;
                }
            }

            if (useStatSetFilter && !fs.existsSync(filePaths.statsetsFilePath)) {
                return message.channel.send({
                    content: `**Mod:** ${modName}\n❌ Missing statsets.txt (required for statset5)`
                });
            }

            // ─────────────────────────────────────────────
            // Parse class name
            // ─────────────────────────────────────────────
            className = argsToProcess.join(' ').trim();
            if (!className) {
                return message.channel.send({ content: 'Please provide the class name.' });
            }

            const sanitizedClassName = helpers.sanitizeInput(className);

            // ─────────────────────────────────────────────
            // Normalize class variants
            // ─────────────────────────────────────────────
            const normalizeClass = (cls) => {
                let base = cls;
                base = base.replace(/F$/, '');
                base = base.replace(/(Imp|Nor|Ste|Exp|[AB])F?$/, '');
                return base;
            };

            // ─────────────────────────────────────────────
            // Read gladiators.txt
            // ─────────────────────────────────────────────
            const gladiatorsContent = fs.readFileSync(
                filePaths.gladiatorsFilePath,
                'utf8'
            );

            const chunks = gladiatorsContent.split(/\n\s*\n/);
            const matching = [];
            const statSetMap = new Map();

            for (const chunk of chunks) {
                const lines = chunk.split(/\r?\n/);
                const data = {};

                for (const line of lines) {
                    const [key, value] = line.split(':').map(s => s?.trim());
                    if (key && value !== undefined) {
                        data[key] = value;
                    }
                }

                if (!data.Name || !data.Class || data['Stat set'] === undefined) {
                    continue;
                }

                const baseClass = normalizeClass(data.Class);
                if (baseClass.toLowerCase() === sanitizedClassName.toLowerCase()) {
                    matching.push(data);

                    if (!statSetMap.has(data['Stat set'])) {
                        statSetMap.set(data['Stat set'], []);
                    }
                    statSetMap.get(data['Stat set']).push(data);
                }
            }

            if (!matching.length) {
                return message.channel.send({
                    content:
                        `**Mod:** ${modName}\n` +
                        `**Class:** ${className}\n` +
                        `❌ No matching units found.`
                });
            }

            let targetUnits = matching;
            let statInfoText = '';

            // ─────────────────────────────────────────────
            // Statset5 filtering
            // ─────────────────────────────────────────────
            if (useStatSetFilter) {
                const statsetsContent = fs.readFileSync(
                    filePaths.statsetsFilePath,
                    'utf8'
                );

                const statChunks = statsetsContent.split(/\n\s*\n/);
                const statAverages = new Map();

                for (const chunk of statChunks) {
                    const lines = chunk.split(/\r?\n/);
                    const headerMatch = lines[0]?.match(/^Statset (\d+):$/);
                    if (!headerMatch) continue;

                    const statSetNumber = headerMatch[1];
                    const lvl30Line = lines.find(l => l.trim().startsWith('30:'));
                    if (!lvl30Line) continue;

                    const stats = lvl30Line
                        .split(':')[1]
                        .trim()
                        .split(/\s+/)
                        .map(Number)
                        .filter(Number.isFinite);

                    if (stats.length !== 5) {
                        if (debugMode) {
                            debugLines.push(
                                `⚠️ Statset ${statSetNumber} malformed: "${lvl30Line}"`
                            );
                        }
                        continue;
                    }

                    const avg = stats.reduce((a, b) => a + b, 0) / 5;
                    statAverages.set(statSetNumber, { avg, stats });
                }

                const ranked = [...statSetMap.keys()]
                    .map(id => {
                        const statData = statAverages.get(id);
                        if (!statData) {
                            if (debugMode) {
                                debugLines.push(
                                    `⚠️ Missing statset ${id} in statsets.txt`
                                );
                            }
                            return null;
                        }

                        return {
                            statSet: id,
                            avg: statData.avg,
                            stats: statData.stats,
                            units: statSetMap.get(id)
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.avg - a.avg);

                if (!ranked.length) {
                    return message.channel.send({
                        content:
                            `**Mod:** ${modName}\n` +
                            `**Class:** ${className}\n` +
                            `❌ No valid statsets found for this class.`
                    });
                }

                const best = ranked[0];
                targetUnits = best.units;

                statInfoText =
                    `\n**Top Statset:** ${best.statSet}` +
                    `\n**Lvl 30 Stats:** ` +
                    `CON ${best.stats[0]} | ` +
                    `PWR ${best.stats[1]} | ` +
                    `ACC ${best.stats[2]} | ` +
                    `DEF ${best.stats[3]} | ` +
                    `INI ${best.stats[4]}`;
            }

            // ─────────────────────────────────────────────
            // Output
            // ─────────────────────────────────────────────
            let output =
                `**Mod:** ${modName}\n` +
                `**Class:** ${className}\n` +
                `**Units Found:** ${targetUnits.length}` +
                statInfoText;

            if (debugMode && debugLines.length) {
                output += `\n\n🧪 **Debug Info:**\n` + debugLines.join('\n');
            }

            message.channel.send({ content: output });

        } catch (err) {
            console.error('[recruits]', err);
            message.channel.send({
                content:
                    `❌ **Recruitment Error**\n` +
                    `**Mod:** ${modName}\n` +
                    `**Class:** ${className || 'Unknown'}\n` +
                    `**Reason:** ${err.message || 'Unknown error'}`
            });
        }
    }
};
