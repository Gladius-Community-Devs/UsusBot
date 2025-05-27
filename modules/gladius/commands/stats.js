const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    name: 'stats',
    description: 'Displays stat information for a specified class at a given level.',
    syntax: 'stats [mod (optional)] [class name] [level (optional)]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the class name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

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
            modName = path.basename(helpers.sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const gladiatorsFilePath = path.join(modPath, 'data', 'units', 'gladiators.txt');
            const statsetsFilePath = path.join(modPath, 'data', 'units', 'statsets.txt');

            // Check if files exist
            if (!fs.existsSync(gladiatorsFilePath)) {
                message.channel.send({ content: `That mod does not have gladiators.txt file!` });
                return;
            }

            if (!fs.existsSync(statsetsFilePath)) {
                message.channel.send({ content: `That mod does not have statsets.txt file!` });
                return;
            }

            // Parse remaining arguments for class name and level
            let className = '';
            let level = null;
            let foundMatchingClass = false;

            // Try all possible splits between class name and level
            for (let splitIndex = index; splitIndex <= args.length; splitIndex++) {
                let potentialClassName = args.slice(index, splitIndex).join(' ').trim();
                let potentialLevel = args.slice(splitIndex, args.length).join(' ').trim();

                if (!potentialClassName) continue; // Class name is required

                // Sanitize inputs
                potentialClassName = helpers.sanitizeInput(potentialClassName);
                if (potentialLevel) {
                    potentialLevel = parseInt(potentialLevel);
                    if (isNaN(potentialLevel) || potentialLevel < 1 || potentialLevel > 30) {
                        continue; // Invalid level, try next split
                    }
                }

                // Check if this class exists in gladiators.txt
                const gladiatorsContent = fs.readFileSync(gladiatorsFilePath, 'utf8');
                const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);

                // Apply class variant regex patterns
                const baseClassMatches = new Set();
                
                for (const chunk of gladiatorChunks) {
                    const lines = chunk.trim().split(/\r?\n/);
                    for (const line of lines) {
                        if (line.startsWith('Class:')) {
                            let classInFile = line.split(':')[1].trim();
                            
                            // Apply regex patterns to get base class
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
                            
                            baseClassMatches.add(baseClass.toLowerCase());
                        }
                    }
                }

                if (baseClassMatches.has(potentialClassName.toLowerCase())) {
                    className = potentialClassName;
                    level = potentialLevel;
                    foundMatchingClass = true;
                    break;
                }
            }

            if (!foundMatchingClass) {
                message.channel.send({ content: `No class named '${args.slice(index).join(' ')}' found in '${modName}'.` });
                return;
            }

            // Find all gladiators with the matching base class and collect their stat sets
            const gladiatorsContent = fs.readFileSync(gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);
            const statSetCounts = new Map();

            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                let chunkClass = '';
                let statSet = '';
                
                for (const line of lines) {
                    if (line.startsWith('Class:')) {
                        chunkClass = line.split(':')[1].trim();
                    } else if (line.startsWith('Stat set:')) {
                        statSet = line.split(':')[1].trim();
                    }
                }

                if (chunkClass && statSet !== '') {
                    // Apply regex patterns to get base class
                    let baseClass = chunkClass;
                    
                    // Gender variant pattern
                    if (baseClass.match(/^(.+)F$/)) {
                        baseClass = baseClass.replace(/^(.+)F$/, '$1');
                    }
                    
                    // Regional variant pattern
                    if (baseClass.match(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/)) {
                        baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
                    }
                    
                    // Undead variant pattern
                    if (baseClass.match(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/)) {
                        baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
                    }

                    if (baseClass.toLowerCase() === className.toLowerCase()) {
                        const count = statSetCounts.get(statSet) || 0;
                        statSetCounts.set(statSet, count + 1);
                    }
                }
            }

            if (statSetCounts.size === 0) {
                message.channel.send({ content: `No gladiators found for class '${className}' in '${modName}'.` });
                return;
            }

            // Find the most common stat set
            let mostCommonStatSet = '';
            let maxCount = 0;
            for (const [statSet, count] of statSetCounts.entries()) {
                if (count > maxCount) {
                    maxCount = count;
                    mostCommonStatSet = statSet;
                }
            }

            // Read statsets.txt and find the stat set
            const statsetsContent = fs.readFileSync(statsetsFilePath, 'utf8');
            const statsetChunks = statsetsContent.split(/\n\s*\n/);
            
            let targetStatsetData = null;
            for (const chunk of statsetChunks) {
                if (chunk.includes(`Statset ${mostCommonStatSet}:`)) {
                    targetStatsetData = chunk.trim();
                    break;
                }
            }

            if (!targetStatsetData) {
                message.channel.send({ content: `Stat set ${mostCommonStatSet} not found in statsets.txt for '${modName}'.` });
                return;
            }

            // Parse the stat set data
            const statLines = targetStatsetData.split(/\r?\n/).slice(1); // Skip the "Statset X:" line
            const levelStats = new Map();
            
            for (const line of statLines) {
                const trimmed = line.trim();
                if (trimmed.includes(':')) {
                    const parts = trimmed.split(':');
                    const levelNum = parseInt(parts[0].trim());
                    const stats = parts[1].trim().split(' ').map(s => parseInt(s.trim()));
                    if (stats.length === 5) { // CON PWR ACC DEF INI
                        levelStats.set(levelNum, {
                            con: stats[0],
                            pwr: stats[1],
                            acc: stats[2],
                            def: stats[3],
                            ini: stats[4]
                        });
                    }
                }
            }

            // If level was specified, show just that level
            if (level) {
                const stats = levelStats.get(level);
                if (!stats) {
                    message.channel.send({ content: `Level ${level} not found in stat set ${mostCommonStatSet}.` });
                    return;
                }

                const response = `**Stats for ${className} (Level ${level}) in ${modName}**\n` +
                    `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                    `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}`;

                message.channel.send({ content: response });
                return;
            }

            // If no level specified, show level selection dropdowns
            const encodedModName = encodeURIComponent(modName);
            const encodedClassName = encodeURIComponent(className);
            const encodedStatSet = encodeURIComponent(mostCommonStatSet);

            // Create level options (1-25 and 26-30)
            const levelOptions1 = [];
            const levelOptions2 = [];

            for (let i = 1; i <= 25; i++) {
                levelOptions1.push({
                    label: `Level ${i}`,
                    value: i.toString()
                });
            }

            for (let i = 26; i <= 30; i++) {
                levelOptions2.push({
                    label: `Level ${i}`,
                    value: i.toString()
                });
            }

            const selectMenu1 = new StringSelectMenuBuilder()
                .setCustomId(`level-select-1|${encodedModName}|${encodedClassName}|${encodedStatSet}`)
                .setPlaceholder('Select level (1-25)')
                .addOptions(levelOptions1);

            const selectMenu2 = new StringSelectMenuBuilder()
                .setCustomId(`level-select-2|${encodedModName}|${encodedClassName}|${encodedStatSet}`)
                .setPlaceholder('Select level (26-30)')
                .addOptions(levelOptions2);

            const row1 = new ActionRowBuilder().addComponents(selectMenu1);
            const row2 = new ActionRowBuilder().addComponents(selectMenu2);

            const response = `**Stats for ${className} in ${modName}**\n` +
                `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                `Please select a level to view the stats:`;

            await message.channel.send({ 
                content: response, 
                components: [row1, row2] 
            });

        } catch (error) {
            console.error('Error finding stats:', error);
            message.channel.send({ content: 'An error occurred while finding the stats.' });
        }
    }
};
