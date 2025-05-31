const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

/**
 * Command: recruits
 * Usage  : recruits [mod (optional)] [class name] [statset5 (optional)]
 *
 * New lookup flow (2025‑05‑31):
 * 1. User enters a front‑end class name (e.g. "Amazon").
 * 2. We load lookuptext_eng.txt → map text‑to‑ID with helpers.loadLookupText().
 * 3. We find every DISPLAYNAMEID whose text matches that class name (case‑insensitive).
 * 4. We parse every chunk in classdefs.tok with helpers.parseClassChunk() and collect every
 *    CREATECLASS whose DISPLAYNAMEID belongs to that ID list (this automatically brings in all
 *    gender / regional / undead variants because the author keeps them under the same
 *    DISPLAYNAMEID).
 * 5. Finally, we scan gladiators.txt and grab every recruit whose Class equals one of the
 *    collected CREATECLASS strings.
 * 6. Optional "statset5" flag behaviour is unchanged – we still load statsets.txt, compute
 *    level‑30 averages, and keep only gladiators that use the single best stat set.
 */
module.exports = {
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally filtered by the best stat set.',
    syntax: 'recruits [mod (optional)] [class name] [statset5 (optional)]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the class name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, './modders.json');
        let modName = 'Vanilla';
        let index = 1; // pointer to the current arg we are processing

        try {
            /* ------------------------------------------------------------------
             *                      1. Detect optional mod argument
             * ----------------------------------------------------------------*/
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            const modNameInput = helpers.sanitizeInput(args[1]);

            for (const modder in moddersConfig) {
                const configured = moddersConfig[modder].replace(/\s+/g, '_');
                if (configured.toLowerCase() === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    modName = configured;
                    index = 2; // class name starts after the mod argument
                    break;
                }
            }
            modName = path.basename(helpers.sanitizeInput(modName));

            /* ------------------------------------------------------------------
             *                      2. Resolve all file paths
             * ----------------------------------------------------------------*/
            const filePaths = helpers.getModFilePaths(modName);
            const requiredFiles = [
                'lookupFilePath',
                'classdefsPath',
                'gladiatorsFilePath',
                'leaguesPath'
            ];
            for (const key of requiredFiles) {
                if (!fs.existsSync(filePaths[key])) {
                    message.channel.send({ content: `That mod does not have ${path.basename(filePaths[key])} file!` });
                    return;
                }
            }

            /* ------------------------------------------------------------------
             *                      3. Handle optional statset5 flag
             * ----------------------------------------------------------------*/
            let useStatSetFilter = false;
            let argsToProcess = args.slice(index);
            if (argsToProcess[argsToProcess.length - 1] === 'statset5') {
                useStatSetFilter = true;
                argsToProcess.pop();
                if (!fs.existsSync(filePaths.statsetsFilePath)) {
                    message.channel.send({ content: `That mod does not have statsets.txt file!` });
                    return;
                }
            }

            /* ------------------------------------------------------------------
             *                      4. Parse user‑supplied class name
             * ----------------------------------------------------------------*/
            const classNameInput = argsToProcess.join(' ').trim();
            if (!classNameInput) {
                message.channel.send({ content: 'Please provide the class name.' });
                return;
            }
            const sanitizedClassName = helpers.sanitizeInput(classNameInput);

            /* ------------------------------------------------------------------
             *              5. lookuptext → DISPLAYNAMEID(s) for that name
             * ----------------------------------------------------------------*/
            const { idToText, nameToIds } = helpers.loadLookupText(filePaths.lookupFilePath);
            const matchingIds = nameToIds[sanitizedClassName.toLowerCase()] || [];

            if (matchingIds.length === 0) {
                message.channel.send({ content: `No DISPLAYNAMEID found for '${classNameInput}'.` });
                return;
            }

            /* ------------------------------------------------------------------
             *              6. Parse classdefs.tok → CREATECLASS list
             * ----------------------------------------------------------------*/
            const classDefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');
            const classChunks = helpers.splitContentIntoChunks(classDefsContent);

            const createClassSet = new Set();
            for (const chunk of classChunks) {
                const classData = helpers.parseClassChunk(chunk);
                if (!classData || !classData.DISPLAYNAMEID) continue;
                const id = parseInt(classData.DISPLAYNAMEID, 10);
                if (matchingIds.includes(id)) {
                    createClassSet.add(classData.className);
                }
            }

            if (createClassSet.size === 0) {
                message.channel.send({ content: `No classes found in classdefs.tok for '${classNameInput}'.` });
                return;
            }

            /* ------------------------------------------------------------------
             *              7. Scan gladiators.txt for matching recruits
             * ----------------------------------------------------------------*/
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);

            const matchingGladiators = [];
            const statSetData = new Map();

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                const glad = { name: '', class: '', statSet: '' };
                for (const line of lines) {
                    if (line.startsWith('Name:')) glad.name = line.split(':')[1].trim();
                    else if (line.startsWith('Class:')) glad.class = line.split(':')[1].trim();
                    else if (line.startsWith('Stat set:')) glad.statSet = line.split(':')[1].trim();
                }
                if (!glad.name || !glad.class || glad.statSet === '') continue;
                if (createClassSet.has(glad.class)) {
                    matchingGladiators.push(glad);
                    if (!statSetData.has(glad.statSet)) statSetData.set(glad.statSet, []);
                    statSetData.get(glad.statSet).push(glad);
                }
            }

            if (matchingGladiators.length === 0) {
                message.channel.send({ content: `No gladiators found for class '${classNameInput}' in '${modName}'.` });
                return;
            }

            /* ------------------------------------------------------------------
             *              8. Optional stat set filter (unchanged logic)
             * ----------------------------------------------------------------*/
            let targetGladiators = matchingGladiators;
            let filterDescription = '';
            if (useStatSetFilter) {
                const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
                const statsetChunks = statsetsContent.split(/\n\s*\n/);

                const averages = new Map();
                for (const chunk of statsetChunks) {
                    const lines = chunk.trim().split(/\r?\n/);
                    const header = lines[0].match(/^Statset (\d+):$/);
                    if (!header) continue;
                    const number = header[1];
                    for (const line of lines) {
                        if (line.trim().startsWith('30:')) {
                            const parts = line.split(':')[1].trim().split(' ').map(n => parseInt(n.trim(), 10));
                            if (parts.length === 5) {
                                const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
                                averages.set(number, { avg, stats: { con: parts[0], pwr: parts[1], acc: parts[2], def: parts[3], ini: parts[4] } });
                            }
                            break;
                        }
                    }
                }

                const ranked = Array.from(statSetData.keys())
                    .filter(ss => averages.has(ss))
                    .map(ss => ({
                        ss,
                        avg: averages.get(ss).avg,
                        stats: averages.get(ss).stats,
                        gladiators: statSetData.get(ss)
                    }))
                    .sort((a, b) => b.avg - a.avg)
                    .slice(0, 1);

                if (ranked.length === 0) {
                    message.channel.send({ content: `No stat set data found for class '${classNameInput}' in '${modName}'.` });
                    return;
                }

                targetGladiators = ranked[0].gladiators;
                const s = ranked[0];
                filterDescription = `\n*Showing only gladiators with the top stat set by level 30 average stats*\n` +
                    `**Top Stat Set:** ${s.ss} (Avg: ${s.avg.toFixed(1)}) - CON:${s.stats.con} PWR:${s.stats.pwr} ACC:${s.stats.acc} DEF:${s.stats.def} INI:${s.stats.ini}\n\n`;
            }

            /* ------------------------------------------------------------------
             *              9. Map gladiators → arenas (league files)
             * ----------------------------------------------------------------*/
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(f => f.endsWith('.tok'));
            const recruitmentData = new Map();

            for (const file of leagueFiles) {
                const leaguePath = path.join(filePaths.leaguesPath, file);
                const leagueContent = fs.readFileSync(leaguePath, 'utf8');

                let arenaName = file.replace('_league.tok', '').replace('.tok', '');
                const officeMatch = leagueContent.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);
                if (officeMatch && idToText[parseInt(officeMatch[1], 10)]) {
                    arenaName = idToText[parseInt(officeMatch[1], 10)];
                }

                for (const gladiator of targetGladiators) {
                    if (leagueContent.includes(gladiator.name)) {
                        if (!recruitmentData.has(gladiator.name)) {
                            recruitmentData.set(gladiator.name, { gladiator, arenas: [] });
                        }
                        recruitmentData.get(gladiator.name).arenas.push(arenaName);
                    }
                }
            }

            /* ------------------------------------------------------------------
             *              10. Build Discord embed and send
             * ----------------------------------------------------------------*/
            const embed = new EmbedBuilder()
                .setTitle(`🏛️ Recruitment Locations for ${classNameInput}`)
                .setDescription(`**Mod:** ${modName}${filterDescription}`)
                .setColor(0x00AE86)
                .setTimestamp();

            if (recruitmentData.size === 0) {
                embed.addFields({ name: 'No Recruitment Data Found', value: `No recruitment information found for class '${classNameInput}' in any league files.` });
            } else {
                // group by arena for nicer display
                const arenaGroups = new Map();
                for (const [name, data] of recruitmentData) {
                    for (const arena of data.arenas) {
                        if (!arenaGroups.has(arena)) arenaGroups.set(arena, []);
                        arenaGroups.get(arena).push({ name, statSet: data.gladiator.statSet, variant: data.gladiator.class });
                    }
                }
                const sortedArenas = Array.from(arenaGroups.keys()).sort();
                for (const arena of sortedArenas) {
                    const glads = arenaGroups.get(arena);
                    let list = '';
                    glads.forEach(g => {
                        list += useStatSetFilter ? `• **${g.name}** (${g.variant}) - Stat Set ${g.statSet}\n` : `• **${g.name}** (${g.variant})\n`;
                    });
                    if (list.length > 1024) list = list.slice(0, 1021) + '.';
                    embed.addFields({ name: `🏟️ ${arena}`, value: list, inline: true });
                }
                embed.addFields({ name: '📊 Summary', value: `Found **${recruitmentData.size}** ${classNameInput} gladiators across **${arenaGroups.size}** arenas.`, inline: false });
            }

            await message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('Error executing recruits command:', err);
            message.channel.send({ content: 'An unexpected error occurred while retrieving recruitment information.' });
        }
    }
};
