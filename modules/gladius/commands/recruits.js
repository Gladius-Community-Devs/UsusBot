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
        this.logger.info(`Recruits command initiated by ${message.author.tag} with args: ${args.join(' ')}`);

        if (args.length <= 1) {
            this.logger.info('Recruits command: Not enough arguments provided.');
            message.channel.send({ content: 'Please provide the class name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            this.logger.info('Recruits command: Successfully loaded modders.json.');

            // Sanitize modNameInput
            let modNameInput = helpers.sanitizeInput(args[1]);

            // Check if args[1] is a valid mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2; // Move index to next argument
                    break;
                }
            }

            // Sanitize modName
            modName = path.basename(helpers.sanitizeInput(modName));            // Define file paths using helper
            const filePaths = helpers.getModFilePaths(modName);
            this.logger.info(`Recruits command: Using mod '${modName}'. File paths set.`);

            // Check if required files exist
            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                this.logger.error(`Recruits command: gladiators.txt not found for mod '${modName}'. Path: ${filePaths.gladiatorsFilePath}`);
                message.channel.send({ content: `That mod does not have gladiators.txt file!` });
                return;
            }

            if (!fs.existsSync(filePaths.leaguesPath)) {
                this.logger.error(`Recruits command: leagues folder not found for mod '${modName}'. Path: ${filePaths.leaguesPath}`);
                message.channel.send({ content: `That mod does not have leagues folder!` });
                return;
            }

            if (!fs.existsSync(filePaths.lookupFilePath)) {
                this.logger.error(`Recruits command: lookuptext_eng.txt not found for mod '${modName}'. Path: ${filePaths.lookupFilePath}`);
                message.channel.send({ content: `That mod does not have lookuptext_eng.txt file!` });
                return;
            }

            if (!fs.existsSync(filePaths.classdefsPath)) {
                this.logger.error(`Recruits command: classdefs.tok not found for mod '${modName}'. Path: ${filePaths.classdefsPath}`);
                message.channel.send({ content: `That mod does not have classdefs.tok file!` });
                return;
            }

            // Check for statset5 option
            let useStatSetFilter = false;
            let argsToProcess = args.slice(index);
            
            if (argsToProcess[argsToProcess.length - 1] === 'statset5') {
                useStatSetFilter = true;
                argsToProcess = argsToProcess.slice(0, -1); // Remove 'statset5' from the end
                this.logger.info('Recruits command: statset5 filter enabled.');
                // Check if statsets file exists when using statset filter
                if (!fs.existsSync(filePaths.statsetsFilePath)) {
                    this.logger.error(`Recruits command: statsets.txt not found for mod '${modName}' when statset5 filter is active. Path: ${filePaths.statsetsFilePath}`);
                    message.channel.send({ content: `That mod does not have statsets.txt file!` });
                    return;
                }
            }            // Parse class name from remaining arguments
            const className = argsToProcess.join(' ').trim();
            if (!className) {
                this.logger.info('Recruits command: Class name not provided after processing mod and statset5 args.');
                message.channel.send({ content: 'Please provide the class name.' });
                return;
            }            const sanitizedClassName = helpers.sanitizeInput(className);
            this.logger.info(`Recruits command: Searching for class: '${sanitizedClassName}'.`);

            // Load lookup text for class display name resolution
            const { idToText, nameToIds } = helpers.loadLookupText(filePaths.lookupFilePath);
            this.logger.info('Recruits command: Loaded lookuptext_eng.txt.');

            // Read and parse classdefs.tok to find matching classes
            const classdefsContent = fs.readFileSync(filePaths.classdefsPath, 'utf8');
            const classChunks = helpers.splitContentIntoChunks(classdefsContent);
            this.logger.info(`Recruits command: Loaded and split classdefs.tok into ${classChunks.length} chunks.`);

            let matchingCreateClasses = []; // This will store the actual class names from CREATECLASS lines

            // New logic:
            // Step 1: Iterate through classdefs.tok chunks.
            // Step 2: For each chunk, get its DISPLAYNAMEID and look up the text.
            // Step 3: If the looked-up text matches user input, parse CREATECLASS lines from that chunk.
            for (const chunk of classChunks) {
                const classData = helpers.parseClassChunk(chunk); // helpers.parseClassChunk extracts DISPLAYNAMEID
                if (!classData || !classData.DISPLAYNAMEID) {
                    continue;
                }

                let displayNameFromLookup = '';
                if (idToText[classData.DISPLAYNAMEID]) {
                    displayNameFromLookup = idToText[classData.DISPLAYNAMEID];
                }

                // Check if the display name obtained from lookuptext_eng.txt matches the user's input class name
                if (displayNameFromLookup && displayNameFromLookup.toLowerCase().includes(sanitizedClassName.toLowerCase())) {
                    // This chunk's DISPLAYNAMEID (when looked up) matches the user's input.
                    // Now, gather all CREATECLASS entries from this specific chunk's raw text.
                    const linesInChunk = chunk.split(/\\r?\\n/);
                    for (const line of linesInChunk) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('CREATECLASS:')) {
                            // Assuming format: CREATECLASS: "ClassNameToList"
                            const match = trimmedLine.match(/^CREATECLASS:\\s*\"([^\"]+)\"/);
                            if (match && match[1]) {
                                if (!matchingCreateClasses.includes(match[1])) { // Avoid duplicates
                                    matchingCreateClasses.push(match[1]);
                                }
                            }
                        }
                    }
                }
            }

            if (matchingCreateClasses.length === 0) {
                this.logger.info(`Recruits command: No CREATECLASS entries found for display name matching '${className}' in mod '${modName}'.`);
                message.channel.send({ content: `Could not find a class whose display name matches '${className}', or the matched class(es) had no CREATECLASS entries in '${modName}'.` });
                return;
            }

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

            // Step 2: Read gladiators.txt and find all units matching the CREATECLASS entries
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\\n\\s*\\n/);
            this.logger.info(`Recruits command: Loaded and split gladiators.txt into ${gladiatorChunks.length} chunks. Found ${matchingCreateClasses.length} CREATECLASS entries to match against: ${matchingCreateClasses.join(', ')}`);

            let matchingGladiators = [];
            let statSetData = new Map(); // Map stat set number to gladiator info

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
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
                    const baseClass = applyClassVariantPatterns(gladiatorData.class);

                    // Check if this gladiator's base class matches any of our CREATECLASS entries
                    const matchesCreateClass = matchingCreateClasses.some(createClass => 
                        baseClass.toLowerCase() === createClass.toLowerCase()
                    );

                    if (matchesCreateClass) {
                        matchingGladiators.push(gladiatorData);
                        
                        // Store stat set data for filtering
                        if (!statSetData.has(gladiatorData.statSet)) {
                            statSetData.set(gladiatorData.statSet, []);
                        }
                        statSetData.get(gladiatorData.statSet).push(gladiatorData);
                    }
                }
            }

            if (matchingGladiators.length === 0) {
                this.logger.info(`Recruits command: No gladiators found for derived classes: ${matchingCreateClasses.join(', ')} in mod '${modName}'.`);
                message.channel.send({ content: `No gladiators found for the classes derived from '${className}' in '${modName}'. The derived classes were: ${matchingCreateClasses.join(', ')}.` });
                return;
            }

            // Filter by top 5 stat sets if requested
            let targetGladiators = matchingGladiators;
            let filterDescription = '';

            if (useStatSetFilter) {
                // Read and parse statsets.txt
                const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
                this.logger.info('Recruits command: Loaded statsets.txt for statset5 filter.');
                const statsetChunks = statsetsContent.split(/\n\s*\n/);
                
                // Calculate average stats at level 30 for each stat set
                const statSetAverages = new Map();
                
                for (const chunk of statsetChunks) {
                    const lines = chunk.trim().split(/\r?\n/);
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

                if (relevantStatSets.length === 0) {
                    this.logger.info(`Recruits command: No relevant stat set data found for class '${className}' in mod '${modName}' after filtering.`);
                    message.channel.send({ content: `No stat set data found for class '${className}' in '${modName}'.` });
                    return;
                }

                // Get gladiators from top stat set only
                targetGladiators = relevantStatSets.flatMap(statSetInfo => statSetInfo.gladiators);
                this.logger.info(`Recruits command: Filtered gladiators by top stat set. ${targetGladiators.length} gladiators remain.`);
                
                const topStatSet = relevantStatSets[0];
                const stats = topStatSet.stats;
                filterDescription = `\n*Showing only gladiators with the top stat set by level 30 average stats*\n`;
                filterDescription += `**Top Stat Set:** ${topStatSet.statSet} (Avg: ${topStatSet.average.toFixed(1)}) - CON:${stats.con} PWR:${stats.pwr} ACC:${stats.acc} DEF:${stats.def} INI:${stats.ini}\n\n`;
            }            // Load lookup text for arena names
            let lookupTextMap = {};
            if (fs.existsSync(filePaths.lookupFilePath)) {
                const { idToText } = helpers.loadLookupText(filePaths.lookupFilePath);
                lookupTextMap = idToText;
            }

            // Read all league files and find where these gladiators can be recruited
            const leagueFiles = fs.readdirSync(filePaths.leaguesPath).filter(file => file.endsWith('.tok'));
            this.logger.info(`Recruits command: Found ${leagueFiles.length} league files to process.`);
            const recruitmentData = new Map(); // Map gladiator name to arenas

            for (const file of leagueFiles) {
                const filePath = path.join(filePaths.leaguesPath, file);
                const leagueContent = fs.readFileSync(filePath, 'utf8');
                
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
            }            // Create embed response
            const embed = new EmbedBuilder()
                .setTitle(`🏛️ Recruitment Locations for ${className}`)
                .setDescription(`**Mod:** ${modName}\n**Matching Classes:** ${matchingCreateClasses.join(', ')}${filterDescription}`)
                .setColor(0x00AE86)
                .setTimestamp();

            if (recruitmentData.size === 0) {
                embed.addFields({
                    name: 'No Recruitment Data Found',
                    value: `No recruitment information found for class '${className}' in any league files.`
                });
                this.logger.info(`Recruits command: No recruitment data found in league files for class '${className}'.`);
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
                this.logger.info(`Recruits command: Found ${totalGladiators} gladiators in ${totalArenas} arenas for class '${className}'.`);
                
                embed.addFields({
                    name: '📊 Summary',
                    value: `Found **${totalGladiators}** ${className} gladiators available across **${totalArenas}** arenas.`,
                    inline: false
                });
            }

            await message.channel.send({ embeds: [embed] });
            this.logger.info(`Recruits command: Successfully sent recruitment embed for class '${className}' in mod '${modName}'.`);

        } catch (error) {
            this.logger.error(`Error in recruits command: ${error.message}\\nStack: ${error.stack}`);
            // console.error('Error finding recruits:', error); // Replaced by logger
            message.channel.send({ content: 'An error occurred while finding recruitment information.' });
        }
    }
};