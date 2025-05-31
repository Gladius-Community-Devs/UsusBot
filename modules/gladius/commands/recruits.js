const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

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
            this.logger.error('User did not provide class name for recruits command.');
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name
        this.logger.info(`Recruits command initiated by user: ${message.author.tag} with args: ${args.join(' ')}`);

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            this.logger.info('Successfully loaded modders.json');

            // Sanitize modNameInput
            let modNameInput = helpers.sanitizeInput(args[1]);

            // Check if args[1] is a valid mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\\\\s+/g, '_').toLowerCase();
                if (modConfigName === modNameInput.replace(/\\\\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\\\\s+/g, '_');
                    index = 2; // Move index to next argument
                    this.logger.info(`Mod identified: ${modName}`);
                    break;
                }
            }
            if (!isMod) {
                this.logger.info(`No mod identified, defaulting to Vanilla. Input was: ${args[1]}`);
            }

            // Sanitize modName
            modName = path.basename(helpers.sanitizeInput(modName));
            // Define file paths using helper
            const filePaths = helpers.getModFilePaths(modName);
            this.logger.info(`File paths for mod ${modName}: ${JSON.stringify(filePaths)}`);

            // Check if required files exist
            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                message.channel.send({ content: `That mod does not have gladiators.txt file!` });
                this.logger.error(`Gladiators file not found for mod: ${modName} (${filePaths.gladiatorsFilePath})`);
                return;
            }
            if (!fs.existsSync(filePaths.leaguesPath)) {
                message.channel.send({ content: `That mod does not have leagues folder!` });
                this.logger.error(`Leagues folder not found for mod: ${modName} (${filePaths.leaguesPath})`);
                return;
            }

            if (!fs.existsSync(filePaths.lookupFilePath)) {
                message.channel.send({ content: `That mod does not have lookuptext_eng.txt file!` });
                this.logger.error(`Lookuptext_eng file not found for mod: ${modName} (${filePaths.lookupFilePath})`);
                return;
            }

            if (!fs.existsSync(filePaths.classdefsPath)) { // Added check for classdefs.tok
                message.channel.send({ content: `That mod does not have classdefs.tok file!` });
                this.logger.error(`Classdefs file not found for mod: ${modName} (${filePaths.classdefsPath})`);
                return;
            }
            this.logger.info('All required files exist.');

            // Load lookup text for class names
            const { idToText: classLookupIdToText, textToId: classLookupTextToId } = helpers.loadLookupText(filePaths.lookupFilePath);
            this.logger.info('Loaded lookup text for class names.');
            if (Object.keys(classLookupIdToText).length === 0) {
                this.logger.warn('classLookupIdToText (for class names) is EMPTY after loading. This will prevent classNameMap population.');
            } else {
                this.logger.info(`classLookupIdToText loaded with ${Object.keys(classLookupIdToText).length} entries. Example (first key): '${Object.keys(classLookupIdToText)[0]}' -> '${classLookupIdToText[Object.keys(classLookupIdToText)[0]]}'`);
            }

            // Read and parse classdefs.tok
            const classdefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');
            const classdefRawChunks = classdefsContent.split(/\nCREATECLASS:/);
            const classNameMap = new Map(); // Maps display name (lowercase) to Set<CREATECLASS name>
            this.logger.info(`Read classdefs.tok. Split into ${classdefRawChunks.length} raw chunks using \nCREATECLASS: splitter.`);

            for (let i = 0; i < classdefRawChunks.length; i++) {
                let currentChunkContent = classdefRawChunks[i];
                let chunkToParse;

                if (i === 0) {
                    chunkToParse = currentChunkContent.trim();
                    // If this first raw chunk doesn't actually start with CREATECLASS:, it's likely a header/comment and should be skipped.
                    if (!chunkToParse.startsWith('CREATECLASS:')) {
                        this.logger.info(`Skipping initial content as it doesn't appear to be a class definition (first 100 chars): "${chunkToParse.substring(0,100).replace(/\n/g, "\\n")}"`);
                        continue;
                    }
                } else {
                    // For subsequent chunks, they were preceded by "\nCREATECLASS:", so we need to add "CREATECLASS:" back.
                    chunkToParse = ("CREATECLASS:" + currentChunkContent).trim();
                }

                if (!chunkToParse) {
                    this.logger.info(`Skipping empty chunk at index ${i}.`);
                    continue;
                }

                const lines = chunkToParse.split(/\r?\n/);
                let createClassName = '';
                let displayNameId = '';

                for (const line of lines) {
                    if (line.startsWith('CREATECLASS:')) {
                        createClassName = line.split(':')[1].trim();
                    } else if (line.startsWith('DISPLAYNAMEID:')) {
                        displayNameId = line.split(':')[1].trim();
                    }
                }

                if (createClassName && displayNameId) {
                    const lookedUpDisplayName = classLookupIdToText[displayNameId];
                    if (lookedUpDisplayName) {
                        const displayNameLower = lookedUpDisplayName.toLowerCase();
                        if (!classNameMap.has(displayNameLower)) {
                            classNameMap.set(displayNameLower, new Set());
                        }
                        classNameMap.get(displayNameLower).add(createClassName);
                        // this.logger.info(`Mapped displayName '${displayNameLower}' (from ID '${displayNameId}') to CREATECLASS '${createClassName}'`);
                    } else {
                        this.logger.warn(`Did not map CREATECLASS '${createClassName}'. Reason: DISPLAYNAMEID '${displayNameId}' not found in classLookupIdToText, or its looked-up value was falsy. classLookupIdToText has '${displayNameId}': ${classLookupIdToText.hasOwnProperty(displayNameId)}. Value: '${classLookupIdToText[displayNameId]}'. Chunk (first 100 chars): '${chunkToParse.substring(0,100).replace(/\n/g, "\\n")}'`);
                    }
                } else {
                    if (chunkToParse.trim()) {
                       this.logger.warn(`Skipped mapping for a chunk. Reason: Missing CREATECLASS (found: '${createClassName}') or DISPLAYNAMEID (found: '${displayNameId}'). Chunk (first 100 chars): '${chunkToParse.substring(0,100).replace(/\n/g, "\\n")}'`);
                    }
                }
            }
            this.logger.info(`Built classNameMap. Size: ${classNameMap.size}. Example entry for 'behemoth': ${JSON.stringify(Array.from(classNameMap.get('behemoth') || []))}`);


            // Check for statset5 option
            let useStatSetFilter = false;
            let argsToProcess = args.slice(index);
            
            if (argsToProcess[argsToProcess.length - 1] === 'statset5') {
                useStatSetFilter = true;
                argsToProcess = argsToProcess.slice(0, -1); // Remove 'statset5' from the end
                this.logger.info('Statset5 filter enabled.');
                
                // Check if statsets file exists when using statset filter
                if (!fs.existsSync(filePaths.statsetsFilePath)) {
                    message.channel.send({ content: `That mod does not have statsets.txt file!` });
                    this.logger.error(`Statsets file not found for mod: ${modName} (${filePaths.statsetsFilePath}) when statset5 filter is enabled.`);
                    return;
                }
            }

            // Parse class name from remaining arguments
            const userInputClassName = argsToProcess.join(' ').trim();
            if (!userInputClassName) {
                message.channel.send({ content: 'Please provide the class name.' });
                this.logger.error('User did not provide class name after mod/filter processing.');
                return;
            }
            this.logger.info(`User input class name: ${userInputClassName}`);

            const sanitizedUserInputClassName = helpers.sanitizeInput(userInputClassName).toLowerCase();

            // Find the CREATECLASS name from the user input
            let createClassNamesForSearch = new Set();

            if (classNameMap.has(sanitizedUserInputClassName)) {
                const namesFromMap = classNameMap.get(sanitizedUserInputClassName);
                namesFromMap.forEach(name => createClassNamesForSearch.add(name));
                this.logger.info(`Found CREATECLASS name(s) ${JSON.stringify(Array.from(namesFromMap))} from classNameMap for input '${sanitizedUserInputClassName}'.`);
            }

            // Fallback: if user input wasn't a display name, it might be a CREATECLASS name directly.
            // Also, if it was a display name but didn't map (e.g. DISPLAYNAMEID: 0), try direct match.
            if (createClassNamesForSearch.size === 0) {
                this.logger.info(`Input class '${sanitizedUserInputClassName}' not found as a display name in classNameMap, or it mapped to no CREATECLASS names. Attempting to use it as a direct CREATECLASS name.`);
                let foundAsCreateClassDirectly = false;
                // Iterate all CREATECLASS names collected (e.g., from classNameMap values)
                for (const classSet of classNameMap.values()) {
                    for (const ccName of classSet) {
                        if (ccName.toLowerCase() === sanitizedUserInputClassName.toLowerCase()) {
                            createClassNamesForSearch.add(ccName); // Add the actual cased name
                            foundAsCreateClassDirectly = true;
                        }
                    }
                }
                // Also check against any CREATECLASS name that might not have made it into the map (e.g. DISPLAYNAMEID 0)
                // This requires re-iterating classdefChunks or having a list of all createClassNames.
                // For simplicity, if the above found matches, we use them.
                // If not, we consider the input itself as a potential CREATECLASS name.
                if (foundAsCreateClassDirectly) {
                     this.logger.info(`Input '${sanitizedUserInputClassName}' matched one or more known CREATECLASS names directly: ${JSON.stringify(Array.from(createClassNamesForSearch))}`);
                } else {
                    this.logger.info(`Input '${sanitizedUserInputClassName}' also not found as a direct CREATECLASS name among mapped classes. Adding input itself as a potential CREATECLASS name for search.`);
                    createClassNamesForSearch.add(userInputClassName); // Add user input (original case for this direct attempt)
                }
            }


            if (createClassNamesForSearch.size === 0) {
                message.channel.send({ content: `Class '${userInputClassName}' not found in '${modName}'.` });
                this.logger.error(`Could not determine any CREATECLASS name(s) for input '${userInputClassName}' in mod '${modName}'.`);
                return;
            }

            const createClassNamesToSearchLower = Array.from(createClassNamesForSearch).map(c => c.toLowerCase());
            this.logger.info(`Final set of CREATECLASS names to search (lowercase): ${JSON.stringify(createClassNamesToSearchLower)}`);


            // Function to apply class variant regex patterns
            const applyClassVariantPatterns = (classInFile) => {
                let baseClass = classInFile;
                
                // Gender variant pattern: remove trailing F
                if (baseClass.match(/^(.+)F$/)) {
                    baseClass = baseClass.replace(/^(.+)F$/, '$1');
                }
                
                // Regional variant pattern: remove Imp|Nor|Ste|Exp|A|B with optional F
                if (baseClass.match(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/)) {
                    baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
                }
                
                // Undead variant pattern: keep UndeadMelee prefix, remove suffixes
                if (baseClass.match(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/)) {
                    baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
                }
                
                return baseClass;
            };

            // Read gladiators.txt and find all units with the matching class
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\\n\\s*\\n/);
            this.logger.info('Read gladiators.txt.');

            let matchingGladiators = [];
            let statSetData = new Map(); // Map stat set number to gladiator info

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\\r?\\n/);
                let gladiatorData = {
                    name: '',
                    class: '',
                    statSet: ''
                };
                
                for (const line of lines) {
                    if (line.startsWith('Name:')) {
                        gladiatorData.name = line.split(':')[1].trim();
                    } else if (line.startsWith('Class:')) {
                        gladiatorData.class = line.split(':')[1].trim();
                    } else if (line.startsWith('Stat set:')) {
                        gladiatorData.statSet = line.split(':')[1].trim();
                    }
                }

                if (gladiatorData.name && gladiatorData.class && gladiatorData.statSet !== '') {
                    // Apply regex patterns to get base class
                    const baseClassInFile = applyClassVariantPatterns(gladiatorData.class);
                    const baseClassInFileLower = baseClassInFile.toLowerCase();

                    if (createClassNamesToSearchLower.includes(baseClassInFileLower)) {
                        matchingGladiators.push(gladiatorData);
                        
                        // Store stat set data for filtering
                        if (!statSetData.has(gladiatorData.statSet)) {
                            statSetData.set(gladiatorData.statSet, []);
                        }
                        statSetData.get(gladiatorData.statSet).push(gladiatorData);
                    }
                }
            }
            this.logger.info(`Found ${matchingGladiators.length} matching gladiators for class(es) ${JSON.stringify(createClassNamesToSearchLower)}.`);

            if (matchingGladiators.length === 0) {
                message.channel.send({ content: `No gladiators found for class \'${userInputClassName}\' (mapped to ${JSON.stringify(Array.from(createClassNamesForSearch))}) in \'${modName}\'.` });
                this.logger.info(`No gladiators found for class '${userInputClassName}' (mapped to ${JSON.stringify(Array.from(createClassNamesForSearch))}) in mod '${modName}'.`);
                return;
            }

            // Filter by top 5 stat sets if requested
            let targetGladiators = matchingGladiators;
            let filterDescription = '';

            if (useStatSetFilter) {
                this.logger.info('Applying statset5 filter.');
                // Read and parse statsets.txt
                const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
                const statsetChunks = statsetsContent.split(/\\n\\s*\\n/);
                this.logger.info('Read statsets.txt for filtering.');
                
                // Calculate average stats at level 30 for each stat set
                const statSetAverages = new Map();
                
                for (const chunk of statsetChunks) {
                    const lines = chunk.trim().split(/\\r?\\n/);
                    const statSetMatch = lines[0].match(/^Statset (\d+):$/);
                    
                    if (statSetMatch) {
                        const statSetNumber = statSetMatch[1];
                        
                        // Find level 30 stats
                        for (const line of lines) {
                            if (line.trim().startsWith('30:')) {
                                const stats = line.trim().split(':')[1].trim().split(' ').map(s => parseInt(s.trim()));
                                if (stats.length === 5) { // CON PWR ACC DEF INI
                                    const average = stats.reduce((sum, stat) => sum + stat, 0) / stats.length;
                                    statSetAverages.set(statSetNumber, {
                                        average: average,
                                        stats: {
                                            con: stats[0],
                                            pwr: stats[1],
                                            acc: stats[2],
                                            def: stats[3],
                                            ini: stats[4]
                                        }
                                    });
                                }
                                break;
                            }
                        }
                    }
                }                // Find stat sets used by our matching gladiators and sort by average
                const relevantStatSets = Array.from(statSetData.keys())
                    .filter(statSet => statSetAverages.has(statSet))
                    .map(statSet => ({
                        statSet: statSet,
                        average: statSetAverages.get(statSet).average,
                        stats: statSetAverages.get(statSet).stats,
                        gladiators: statSetData.get(statSet)
                    }))
                    .sort((a, b) => b.average - a.average) // Sort by highest average first
                    .slice(0, 1); // Take only top 1
                this.logger.info(`Calculated relevant stat sets for filtering: ${relevantStatSets.length} found.`);

                if (relevantStatSets.length === 0) {
                    message.channel.send({ content: `No stat set data found for class \\\'${userInputClassName}\\\' in \\\'${modName}\\\'.` });
                    this.logger.info(`No relevant stat sets found for class \'${userInputClassName}\' after filtering.`);
                    return;
                }

                // Get gladiators from top stat set only
                targetGladiators = relevantStatSets.flatMap(statSetInfo => statSetInfo.gladiators);
                this.logger.info(`Filtered to ${targetGladiators.length} gladiators based on top stat set.`);
                
                const topStatSet = relevantStatSets[0];
                const stats = topStatSet.stats;
                filterDescription = `\n*Showing only gladiators with the top stat set by level 30 average stats*\n`;
                filterDescription += `**Top Stat Set:** ${topStatSet.statSet} (Avg: ${topStatSet.average.toFixed(1)}) - CON:${stats.con} PWR:${stats.pwr} ACC:${stats.acc} DEF:${stats.def} INI:${stats.ini}\n\n`;
            }            // Load lookup text for arena names
            let lookupTextMap = {};
            if (fs.existsSync(filePaths.lookupFilePath)) {
                const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);
                lookupTextMap = idToText;
                this.logger.info('Loaded lookup text for arena names.');
            } else {
                this.logger.warn(`Lookup file not found at ${filePaths.lookupFilePath}, arena names might be IDs.`);
            }

            // Read all league files and find where these gladiators can be recruited
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(file => file.endsWith('.tok'));
            const recruitmentData = new Map(); // Map gladiator name to arenas
            this.logger.info(`Found ${leagueFiles.length} league files to process.`);

            for (const file of leagueFiles) {
                const filePath = path.join(filePaths.leaguesPath, file);
                const leagueContent = fs.readFileSync(filePath, 'utf8');
                this.logger.info(`Processing league file: ${file}`);
                
                // Extract arena name from OFFICENAME line
                let arenaName = file.replace('_league.tok', '').replace('.tok', ''); // fallback
                const officeNameMatch = leagueContent.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);
                if (officeNameMatch) {
                    const lookupId = parseInt(officeNameMatch[1]);
                    if (lookupTextMap[lookupId]) {
                        arenaName = lookupTextMap[lookupId];
                    }
                }
                
                // Check each target gladiator in this league file
                for (const gladiator of targetGladiators) {
                    if (leagueContent.includes(gladiator.name)) {
                        if (!recruitmentData.has(gladiator.name)) {
                            recruitmentData.set(gladiator.name, {
                                gladiator: gladiator,
                                arenas: []
                            });
                        }
                        recruitmentData.get(gladiator.name).arenas.push(arenaName);
                    }
                }
            }
            this.logger.info(`Built recruitment data with ${recruitmentData.size} entries.`);

            // Create embed response
            const embed = new EmbedBuilder()
                .setTitle(`🏛️ Recruitment Locations for ${userInputClassName}`)
                .setDescription(`**Mod:** ${modName}${filterDescription}`)
                .setColor(0x00AE86)
                .setTimestamp();

            if (recruitmentData.size === 0) {
                embed.addFields({
                    name: 'No Recruitment Data Found',
                    value: `No recruitment information found for class \\\'${userInputClassName}\\\' in any league files.`
                });
                this.logger.info(`No recruitment data found for class \'${userInputClassName}\'.`);
            } else {
                // Group by arena for better display
                const arenaGroups = new Map();
                
                for (const [gladiatorName, data] of recruitmentData) {
                    for (const arena of data.arenas) {
                        if (!arenaGroups.has(arena)) {
                            arenaGroups.set(arena, []);
                        }
                        arenaGroups.get(arena).push({
                            name: gladiatorName,
                            statSet: data.gladiator.statSet,
                            variant: data.gladiator.class
                        });
                    }
                }

                // Sort arenas alphabetically and add fields
                const sortedArenas = Array.from(arenaGroups.keys()).sort();
                
                for (const arena of sortedArenas) {
                    const gladiators = arenaGroups.get(arena);
                    let gladiatorList = '';
                    
                    gladiators.forEach(glad => {
                        if (useStatSetFilter) {
                            gladiatorList += `• **${glad.name}** (${glad.variant}) - Stat Set ${glad.statSet}\n`;
                        } else {
                            gladiatorList += `• **${glad.name}** (${glad.variant})\n`;
                        }
                    });
                    
                    // Limit field value length for Discord
                    if (gladiatorList.length > 1024) {
                        gladiatorList = gladiatorList.substring(0, 1021) + '...';
                    }
                      embed.addFields({
                        name: `🏟️ ${arena}`,
                        value: gladiatorList || 'No gladiators found',
                        inline: true
                    });
                }

                // Add summary field
                const totalGladiators = Array.from(recruitmentData.keys()).length;
                const totalArenas = arenaGroups.size;
                
                embed.addFields({
                    name: '📊 Summary',
                    value: `Found **${totalGladiators}** ${userInputClassName} gladiators available across **${totalArenas}** arenas.`,
                    inline: false
                });
            }

            await message.channel.send({ embeds: [embed] });
            this.logger.info(`Successfully sent recruits embed for class \'${userInputClassName}\'.`);

        } catch (error) {
            this.logger.error(`Error in recruits command: ${error.message}`, error);
            console.error('Error finding recruits:', error);
            message.channel.send({ content: 'An error occurred while finding recruitment information.' });
        }
    }
};
