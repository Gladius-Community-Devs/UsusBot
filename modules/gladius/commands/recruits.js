// recruits.js – revamped to use DISPLAYNAMEID → lookuptext mapping
// and CREATECLASS values for precise class matching

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

/**
 * Build a mapping from *front‑end* class names (what the player types)
 *               → internal CREATECLASS identifiers used in gladiators.txt
 *
 * Returns an object: {
 *    'amazon': {
 *        frontEndName   : 'Amazon',
 *        createClasses  : ['Amazon']
 *    }, ...
 * }
 */
function buildClassMap(classdefsPath, lookupFilePath) {
    const mapping = {};

    // Ensure required files exist
    if (!fs.existsSync(classdefsPath) || !fs.existsSync(lookupFilePath)) {
        return mapping; // empty map – caller will handle the error path
    }

    const { idToText } = helpers.loadLookupText(lookupFilePath); // { id: text }

    const classdefsContent = fs.readFileSync(classdefsPath, 'utf8');
    const chunks = helpers.splitContentIntoChunks(classdefsContent);

    for (const chunk of chunks) {
        if (!chunk.includes('CREATECLASS:')) continue;

        const parsed = helpers.parseClassChunk(chunk); // returns null if malformed
        if (!parsed || !parsed.className || !parsed.DISPLAYNAMEID) continue;

        const displayId = parseInt(parsed.DISPLAYNAMEID, 10);
        const frontName = idToText[displayId];
        if (!frontName) continue; // skip if the lookuptable doesn't contain that ID

        const key = frontName.toLowerCase();
        if (!mapping[key]) {
            mapping[key] = {
                frontEndName  : frontName,
                createClasses : []
            };
        }
        mapping[key].createClasses.push(parsed.className);
    }

    return mapping;
}

module.exports = {
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally restricted to the best stat set.',
    syntax: 'recruits [mod] <class name> [statset5]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,

    /**
     * Discord command entry point
     */
    async execute(message, args, extra) {
        if (args.length <= 1) {
            await message.channel.send({ content: 'Please provide the class name.' });
            return;
        }

        //------------------------------------------------------------------
        // 1.  Resolve which mod folder the user is targeting
        //------------------------------------------------------------------
        const moddersConfigPath = path.join(__dirname, './modders.json');
        const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

        let modName = 'Vanilla';      // default
        let argIndex = 1;             // where the class‑name might start

        const firstArg = helpers.sanitizeInput(args[1]);
        for (const modder in moddersConfig) {
            const canonical = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
            if (canonical === firstArg.replace(/\s+/g, '_').toLowerCase()) {
                modName = moddersConfig[modder].replace(/\s+/g, '_');
                argIndex = 2; // class name starts after the mod name
                break;
            }
        }

        // Guard against path‑traversal and build file paths
        modName = path.basename(helpers.sanitizeInput(modName));
        const filePaths = helpers.getModFilePaths(modName);

        // Mandatory files
        const required = ['gladiatorsFilePath', 'leaguesPath', 'lookupFilePath', 'classdefsPath'];
        for (const key of required) {
            if (!fs.existsSync(filePaths[key])) {
                await message.channel.send({ content: `That mod is missing its ${key}.` });
                return;
            }
        }

        //------------------------------------------------------------------
        // 2.  Parse flags – look for trailing "statset5"
        //------------------------------------------------------------------
        let useStatSetFilter = false;
        let classArgs = args.slice(argIndex);
        if (classArgs[classArgs.length - 1] === 'statset5') {
            useStatSetFilter = true;
            classArgs = classArgs.slice(0, -1);
            if (!fs.existsSync(filePaths.statsetsFilePath)) {
                await message.channel.send({ content: 'That mod does not have statsets.txt file!' });
                return;
            }
        }

        const classQuery = classArgs.join(' ').trim();
        if (!classQuery) {
            await message.channel.send({ content: 'Please provide the class name.' });
            return;
        }

        //------------------------------------------------------------------
        // 3.  Build/resolve the class mapping and work out the CreateClass IDs
        //------------------------------------------------------------------
        const classMap = buildClassMap(filePaths.classdefsPath, filePaths.lookupFilePath);

        const key = helpers.sanitizeInput(classQuery).toLowerCase();
        let internalClasses = [];
        let frontEndName   = classQuery; // fallback display

        if (classMap[key]) {
            internalClasses = classMap[key].createClasses;
            frontEndName    = classMap[key].frontEndName;
        } else {
            // Fallback: treat the user input as a raw internal class name
            internalClasses = [classQuery];
        }

        if (internalClasses.length === 0) {
            await message.channel.send({ content: `Unknown class '${classQuery}'.` });
            return;
        }

        //------------------------------------------------------------------
        // 4.  Scan gladiators.txt for matches
        //------------------------------------------------------------------
        const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
        const gladiatorChunks = helpers.splitContentIntoChunks(gladiatorsContent);

        const matchingGladiators = [];
        const statSetBuckets = new Map(); // statSet → [gladiators]

        for (const chunk of gladiatorChunks) {
            const lines = chunk.trim().split(/\r?\n/);
            const gladiator = { name: '', class: '', statSet: '' };

            for (const line of lines) {
                if (line.startsWith('Name:'))      gladiator.name     = line.split(':')[1].trim();
                else if (line.startsWith('Class:')) gladiator.class    = line.split(':')[1].trim();
                else if (line.startsWith('Stat set:')) gladiator.statSet = line.split(':')[1].trim();
            }

            if (!gladiator.name || !gladiator.class) continue;
            if (!internalClasses.includes(gladiator.class)) continue;

            matchingGladiators.push(gladiator);

            if (!statSetBuckets.has(gladiator.statSet)) {
                statSetBuckets.set(gladiator.statSet, []);
            }
            statSetBuckets.get(gladiator.statSet).push(gladiator);
        }

        if (matchingGladiators.length === 0) {
            await message.channel.send({ content: `No gladiators found for class '${frontEndName}' in '${modName}'.` });
            return;
        }

        //------------------------------------------------------------------
        // 5.  Optionally filter by the SINGLE best stat‑set (average of level‑30 stats)
        //------------------------------------------------------------------
        let targetGladiators = matchingGladiators;
        let filterDescription = '';

        if (useStatSetFilter) {
            const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
            const statsetChunks = helpers.splitContentIntoChunks(statsetsContent);

            // Build map: statSet → average (at lvl 30) & breakdown
            const statSetAverages = new Map();
            for (const chunk of statsetChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                const headerMatch = lines[0]?.match(/^Statset (\d+):$/);
                if (!headerMatch) continue;

                const statSetId = headerMatch[1];
                for (const line of lines) {
                    if (!line.trim().startsWith('30:')) continue;
                    const stats = line.split(':')[1].trim().split(' ').map(s => parseInt(s.trim(), 10));
                    if (stats.length !== 5) break; // malformed
                    const average = stats.reduce((a, b) => a + b, 0) / 5;
                    statSetAverages.set(statSetId, {
                        average,
                        stats: {
                            con: stats[0],
                            pwr: stats[1],
                            acc: stats[2],
                            def: stats[3],
                            ini: stats[4]
                        }
                    });
                    break;
                }
            }

            // Pick the highest‑average stat set actually used by our gladiators
            const rankedStatsets = Array.from(statSetBuckets.keys())
                .filter(id => statSetAverages.has(id))
                .map(id => ({ id, average: statSetAverages.get(id).average }))
                .sort((a, b) => b.average - a.average);

            if (rankedStatsets.length === 0) {
                await message.channel.send({ content: `No stat set data found for '${frontEndName}' in '${modName}'.` });
                return;
            }

            const bestId = rankedStatsets[0].id;
            targetGladiators = statSetBuckets.get(bestId);

            const stats = statSetAverages.get(bestId).stats;
            filterDescription = `\n*Showing only gladiators with the best stat set by level‑30 average stats*\n` +
                `**Top Stat Set:** ${bestId} (Avg: ${statSetAverages.get(bestId).average.toFixed(1)}) ` +
                `‑ CON:${stats.con} PWR:${stats.pwr} ACC:${stats.acc} DEF:${stats.def} INI:${stats.ini}\n\n`;
        }

        //------------------------------------------------------------------
        // 6.  Discover arenas (league files) where each gladiator can appear
        //------------------------------------------------------------------
        const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);
        const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(f => f.endsWith('.tok'));

        const recruitment = new Map(); // gladiatorName → Set(arenaName)

        for (const file of leagueFiles) {
            const full = path.join(filePaths.leaguesPath, file);
            const content = fs.readFileSync(full, 'utf8');

            // Pull the OFFICENAME id → arena name via lookup
            let arenaName = file.replace('_league.tok', '').replace('.tok', ''); // sensible fallback
            const officeMatch = content.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);
            if (officeMatch && idToText[parseInt(officeMatch[1], 10)]) {
                arenaName = idToText[parseInt(officeMatch[1], 10)];
            }

            // Check each target gladiator
            for (const glad of targetGladiators) {
                if (!content.includes(glad.name)) continue;
                if (!recruitment.has(glad.name)) recruitment.set(glad.name, new Set());
                recruitment.get(glad.name).add(arenaName);
            }
        }

        //------------------------------------------------------------------
        // 7.  Compose embed
        //------------------------------------------------------------------
        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Recruitment Locations for ${frontEndName}`)
            .setDescription(`**Mod:** ${modName}${filterDescription}`)
            .setColor(0x00AE86)
            .setTimestamp();

        if (recruitment.size === 0) {
            embed.addFields({ name: 'No Recruitment Data Found', value: `No arenas contain ${frontEndName} gladiators.` });
        } else {
            // Group gladiators by arena for nicer display
            const arenaBuckets = new Map(); // arena → [{ name, variant, statSet }]

            for (const [gladName, arenas] of recruitment) {
                const glad = targetGladiators.find(g => g.name === gladName);
                const info = {
                    name    : gladName,
                    variant : glad.class,
                    statSet : glad.statSet
                };
                for (const arena of arenas) {
                    if (!arenaBuckets.has(arena)) arenaBuckets.set(arena, []);
                    arenaBuckets.get(arena).push(info);
                }
            }

            // Sort arenas alphabetically and add embed fields
            for (const arena of Array.from(arenaBuckets.keys()).sort((a, b) => a.localeCompare(b))) {
                const list = arenaBuckets.get(arena)
                    .map(g => useStatSetFilter ? `• **${g.name}** (${g.variant}) - Stat ${g.statSet}`
                                               : `• **${g.name}** (${g.variant})`)
                    .join('\n');

                embed.addFields({
                    name  : `🏟️ ${arena}`,
                    value : list.length > 1024 ? list.slice(0, 1021) + '…' : list,
                    inline: true
                });
            }

            // Summary
            embed.addFields({
                name : '📊 Summary',
                value: `Found **${recruitment.size}** ${frontEndName} gladiator(s) across **${arenaBuckets.size}** arena(s).`,
                inline: false
            });
        }

        await message.channel.send({ embeds: [embed] });
    }
};
