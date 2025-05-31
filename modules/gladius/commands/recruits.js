const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    name: 'recruits',
    description: 'Shows where to recruit gladiators of a specified class, optionally filtered by the best stat set.',
    syntax: 'recruits [mod (optional)] [class name] [statset5 (optional)]',
    num_args: 1, // Minimum 1 argument (class name)
    args_to_lower: false, // Keep class name case for lookup, but compare case-insensitively
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        if (args.length < 1) { // Command name is args[0] if not using a prefix
            message.channel.send({ content: 'Please provide the class name. Syntax: `recruits [mod (optional)] <class name> [statset5 (optional)]`' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let classNameInputIndex = 1; // Index for class name in args, assuming no prefix for command

        // Determine if a mod name is provided
        if (args.length > 1) {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            const potentialModName = helpers.sanitizeInput(args[0]); // User might type "recruits ModName ClassName"
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\\s+/g, '_').toLowerCase();
                if (modConfigName === potentialModName.replace(/\\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\\s+/g, '_');
                    classNameInputIndex = 1; // Class name is the next argument
                    break;
                }
            }
        }
        
        // If only one arg is given, it must be the class name (or mod name if it's the only arg and it's a mod)
        // This logic needs to be careful if a single arg could be a class name or a mod name
        // For simplicity, let's assume if a mod is specified, it's the first arg after command.

        const filePaths = helpers.getModFilePaths(modName);

        // Validate required files
        const requiredFilesCheck = {
            lookupFilePath: filePaths.lookupFilePath,
            classdefsPath: filePaths.classdefsPath,
            gladiatorsFilePath: filePaths.gladiatorsFilePath,
            leaguesPath: filePaths.leaguesPath,
        };
        for (const [key, filePath] of Object.entries(requiredFilesCheck)) {
            if (!fs.existsSync(filePath)) {
                message.channel.send({ content: `Required file not found for mod '${modName}': ${path.basename(filePath)}` });
                return;
            }
        }

        // Check for statset5 option
        let useStatSetFilter = false;
        let remainingArgs = args.slice(classNameInputIndex);
        
        if (remainingArgs.length > 1 && remainingArgs[remainingArgs.length - 1].toLowerCase() === 'statset5') {
            useStatSetFilter = true;
            remainingArgs = remainingArgs.slice(0, -1); // Remove 'statset5'
            if (!fs.existsSync(filePaths.statsetsFilePath)) {
                message.channel.send({ content: `Statsets file (statsets.txt) not found for mod '${modName}', cannot use 'statset5' filter.` });
                return;
            }
        }

        const classNameInput = remainingArgs.join(' ').trim();
        if (!classNameInput) {
            message.channel.send({ content: 'Please provide the class name. Syntax: `recruits [mod (optional)] <class name> [statset5 (optional)]`' });
            return;
        }

        try {
            // 1. Load lookuptext_eng.txt
            const { idToText, nameToIds } = helpers.loadLookupText(filePaths.lookupFilePath);

            // 2. Find DISPLAYNAMEID for the input class name
            const lowerClassNameInput = classNameInput.toLowerCase();
            const matchingDisplayIds = nameToIds[lowerClassNameInput];

            if (!matchingDisplayIds || matchingDisplayIds.length === 0) {
                message.channel.send({ content: `Class display name '${classNameInput}' not found in lookuptext for mod '${modName}'.` });
                return;
            }
            // For simplicity, let's assume the first matched ID is the one we want if multiple exist.
            // Or, we could try to be smarter if multiple display names map to the same text.
            // The prompt implies we find *a* DISPLAYNAMEID, then find all CLASSDEFS with that ID.
            
            // 3. Load and parse classdefs.tok
            const classdefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');
            const classdefChunks = helpers.splitContentIntoChunks(classdefsContent);
            
            const internalClassNames = new Set();
            let foundDisplayName = '';

            for (const displayId of matchingDisplayIds) {
                // Find the actual display name text for this ID to use in messages
                if (idToText[displayId] && idToText[displayId].toLowerCase() === lowerClassNameInput) {
                    foundDisplayName = idToText[displayId]; // Store the correctly cased display name
                }

                for (const chunk of classdefChunks) {
                    const classData = helpers.parseClassChunk(chunk);
                    if (classData && classData.DISPLAYNAMEID && parseInt(classData.DISPLAYNAMEID) === displayId) {
                        if (classData.className) {
                            internalClassNames.add(classData.className);
                        }
                    }
                }
            }
            
            if (internalClassNames.size === 0) {
                message.channel.send({ content: `No internal classes (CREATECLASS) found for display name '${classNameInput}' (ID: ${matchingDisplayIds.join(', ')}) in mod '${modName}'.` });
                return;
            }
            if (!foundDisplayName) foundDisplayName = classNameInput; // Fallback if exact case not found but ID matched

            // 4. Load gladiators.txt and find matching gladiators
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorFileChunks = helpers.splitContentIntoChunks(gladiatorsContent); // Assuming gladiators.txt is also chunked

            let matchingGladiators = [];
            let statSetData = new Map();

            for (const chunk of gladiatorFileChunks) {
                const lines = chunk.trim().split(/\\r?\\n/);
                let gladiatorData = { name: '', class: '', statSet: '' };
                for (const line of lines) {
                    if (line.startsWith('Name:')) {
                        gladiatorData.name = line.split(':')[1].trim();
                    } else if (line.startsWith('Class:')) {
                        gladiatorData.class = line.split(':')[1].trim();
                    } else if (line.startsWith('Stat set:')) {
                        gladiatorData.statSet = line.split(':')[1].trim();
                    }
                }

                if (gladiatorData.name && gladiatorData.class && internalClassNames.has(gladiatorData.class)) {
                    matchingGladiators.push(gladiatorData);
                    if (!statSetData.has(gladiatorData.statSet)) {
                        statSetData.set(gladiatorData.statSet, []);
                    }
                    statSetData.get(gladiatorData.statSet).push(gladiatorData);
                }
            }

            if (matchingGladiators.length === 0) {
                message.channel.send({ content: `No gladiators found for class '${foundDisplayName}' (internal: ${Array.from(internalClassNames).join(', ')}) in '${modName}'.` });
                return;
            }

            // Filter by top stat set if requested (statset5 logic)
            let targetGladiators = matchingGladiators;
            let filterDescription = '';

            if (useStatSetFilter) {
                const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
                const statsetFileChunks = helpers.splitContentIntoChunks(statsetsContent); // Assuming statsets.txt is chunked
                
                const statSetAverages = new Map();
                
                for (const chunk of statsetFileChunks) {
                    const lines = chunk.trim().split(/\\r?\\n/);
                    if (lines.length === 0) continue;

                    const statSetMatch = lines[0].match(/^Statset (\\d+):$/);
                    if (statSetMatch) {
                        const statSetNumber = statSetMatch[1];
                        for (const line of lines) {
                            if (line.trim().startsWith('30:')) { // Level 30 stats
                                const statsParts = line.trim().split(':')[1].trim().split(' ').map(s => parseInt(s.trim()));
                                if (statsParts.length === 5) { // CON PWR ACC DEF INI
                                    const average = statsParts.reduce((sum, stat) => sum + stat, 0) / statsParts.length;
                                    statSetAverages.set(statSetNumber, {
                                        average: average,
                                        stats: { con: statsParts[0], pwr: statsParts[1], acc: statsParts[2], def: statsParts[3], ini: statsParts[4] }
                                    });
                                }
                                break;
                            }
                        }
                    }
                }
                
                const relevantStatSets = Array.from(statSetData.keys())
                    .filter(statSet => statSetAverages.has(statSet))
                    .map(statSet => ({
                        statSet: statSet,
                        average: statSetAverages.get(statSet).average,
                        stats: statSetAverages.get(statSet).stats,
                        gladiators: statSetData.get(statSet) // Gladiators having this stat set
                    }))
                    .sort((a, b) => b.average - a.average); // Sort by highest average

                if (relevantStatSets.length === 0) {
                    message.channel.send({ content: `No stat set data found for the gladiators of class '${foundDisplayName}' in '${modName}'. Cannot apply 'statset5' filter.` });
                    // Optionally, proceed without filter or return
                } else {
                    // Take top 1 stat set (as per original logic for 'statset5')
                    const topStatSetInfo = relevantStatSets[0];
                    targetGladiators = topStatSetInfo.gladiators; // Filter to only gladiators with this top stat set
                    
                    const stats = topStatSetInfo.stats;
                    filterDescription = `\\n*Showing only gladiators with the top stat set (Level 30 average)*\\n`;
                    filterDescription += `**Top Stat Set:** ${topStatSetInfo.statSet} (Avg: ${topStatSetInfo.average.toFixed(1)}) - CON:${stats.con} PWR:${stats.pwr} ACC:${stats.acc} DEF:${stats.def} INI:${stats.ini}\\n\\n`;
                }
            }
            
            // Load lookup text for arena names (already loaded as idToText)
            // Read all league files and find where these gladiators can be recruited
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(file => file.endsWith('.tok'));
            const recruitmentData = new Map(); // Map gladiator name to { gladiator, arenas }

            for (const file of leagueFiles) {
                const filePath = path.join(filePaths.leaguesPath, file);
                const leagueContent = fs.readFileSync(filePath, 'utf8');
                
                let arenaName = path.basename(file, '.tok').replace('_league', ''); // Fallback
                const officeNameMatch = leagueContent.match(/OFFICENAME\\s+\\"[^\\"]*\\",\\s*(\\d+)/);
                if (officeNameMatch) {
                    const lookupId = parseInt(officeNameMatch[1]);
                    if (idToText[lookupId]) {
                        arenaName = idToText[lookupId];
                    }
                }
                
                for (const gladiator of targetGladiators) { // Use targetGladiators (potentially filtered)
                    if (leagueContent.includes(`"${gladiator.name}"`)) { // More specific match for gladiator name in league files
                        if (!recruitmentData.has(gladiator.name)) {
                            recruitmentData.set(gladiator.name, {
                                gladiator: gladiator, // Store full gladiator object
                                arenas: []
                            });
                        }
                        recruitmentData.get(gladiator.name).arenas.push(arenaName);
                    }
                }
            }

            // Create embed response
            const embed = new EmbedBuilder()
                .setTitle(`🏛️ Recruitment Locations for ${foundDisplayName}`)
                .setDescription(`**Mod:** ${modName}${filterDescription}`)
                .setColor(0x00AE86)
                .setTimestamp();

            if (recruitmentData.size === 0) {
                embed.addFields({
                    name: 'No Recruitment Data Found',
                    value: `No recruitment information found for class '${foundDisplayName}' in any league files${useStatSetFilter ? ' with the specified stat set filter' : ''}.`
                });
            } else {
                const arenaGroups = new Map();
                for (const [gladiatorName, data] of recruitmentData) {
                    for (const arena of data.arenas) {
                        if (!arenaGroups.has(arena)) {
                            arenaGroups.set(arena, []);
                        }
                        // Push gladiator object which includes name, class (internal), and statSet
                        arenaGroups.get(arena).push(data.gladiator); 
                    }
                }

                const sortedArenas = Array.from(arenaGroups.keys()).sort();
                
                for (const arena of sortedArenas) {
                    const gladiatorsInArena = arenaGroups.get(arena);
                    let gladiatorList = '';
                    
                    gladiatorsInArena.forEach(glad => {
                        // glad.class is the internal CREATECLASS name. 
                        // We might want to show the user-friendly class name (foundDisplayName) or the specific variant.
                        // For now, let's show the internal name as "variant" as per original logic.
                        gladiatorList += `• **${glad.name}** (${glad.class})${useStatSetFilter || !filterDescription ? ` - Stat Set ${glad.statSet}` : ''}\\n`;
                    });
                    
                    if (gladiatorList.length > 1024) {
                        gladiatorList = gladiatorList.substring(0, 1021) + '...';
                    }
                    embed.addFields({
                        name: `🏟️ ${arena}`,
                        value: gladiatorList || 'No gladiators found in this arena with current filters.',
                        inline: true
                    });
                }

                const totalUniqueGladiators = recruitmentData.size; // Number of unique gladiator names found
                const totalArenas = arenaGroups.size;
                
                embed.addFields({
                    name: '📊 Summary',
                    value: `Found **${totalUniqueGladiators}** unique gladiators of class '${foundDisplayName}' available across **${totalArenas}** arenas.`,
                    inline: false
                });
            }

            await message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Error in recruits command:', error);
            message.channel.send({ content: 'An error occurred while processing the recruits command.' });
        }
    }
};