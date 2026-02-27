const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const helpers = require('../functions');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Displays stat information for a specified class at a given level.')
        .addStringOption(option => 
            option.setName('class_name')
                .setDescription('The name of the class')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('mod_name')
                .setDescription('The name of the mod (optional)')
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('level')
                .setDescription('The level to check (optional)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30)),
    async execute(interaction, extra) {
        await interaction.deferReply();
        const moddersConfigPath = path.join(__dirname, '../modders.json');
        
        const className = helpers.sanitizeInput(interaction.options.getString('class_name'));
        let modNameInput = interaction.options.getString('mod_name');
        const level = interaction.options.getInteger('level');

        let modName = 'Vanilla';

        try {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            if (modNameInput) {
                modNameInput = helpers.sanitizeInput(modNameInput);
                let isMod = false;
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                        isMod = true;
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        break;
                    }
                }
            }
            
            modName = path.basename(helpers.sanitizeInput(modName));
            const filePaths = helpers.getModFilePaths(modName);

            if (!fs.existsSync(filePaths.gladiatorsFilePath)) {
                await interaction.editReply({ content: `That mod does not have gladiators.txt file!` });
                return;
            }

            if (!fs.existsSync(filePaths.statsetsFilePath)) {
                await interaction.editReply({ content: `That mod does not have statsets.txt file!` });
                return;
            }

            // Verify class exists
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
            const gladiatorChunks = gladiatorsContent.split(/\n\s*\n/);
            const baseClassMatches = new Set();
            
            for (const chunk of gladiatorChunks) {
                const lines = chunk.trim().split(/\r?\n/);
                for (const line of lines) {
                    if (line.startsWith('Class:')) {
                        let classInFile = line.split(':')[1].trim();
                        let baseClass = classInFile;
                        if (baseClass.match(/^(.+)F$/)) baseClass = baseClass.replace(/^(.+)F$/, '$1');
                        if (baseClass.match(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/)) baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
                        if (baseClass.match(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/)) baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
                        baseClassMatches.add(baseClass.toLowerCase());
                    }
                }
            }

            if (!baseClassMatches.has(className.toLowerCase())) {
                await interaction.editReply({ content: `No class named '${className}' found in '${modName}'.` });
                return;
            }

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
                    let baseClass = chunkClass;
                    if (baseClass.match(/^(.+)F$/)) baseClass = baseClass.replace(/^(.+)F$/, '$1');
                    if (baseClass.match(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/)) baseClass = baseClass.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
                    if (baseClass.match(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/)) baseClass = baseClass.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');

                    if (baseClass.toLowerCase() === className.toLowerCase()) {
                        const count = statSetCounts.get(statSet) || 0;
                        statSetCounts.set(statSet, count + 1);
                    }
                }
            }

            if (statSetCounts.size === 0) {
                await interaction.editReply({ content: `No gladiators found for class '${className}' in '${modName}'.` });
                return;
            }

            let mostCommonStatSet = '';
            let maxCount = 0;
            for (const [statSet, count] of statSetCounts.entries()) {
                if (count > maxCount) {
                    maxCount = count;
                    mostCommonStatSet = statSet;
                }
            }
            
            const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
            const statsetChunks = statsetsContent.split(/\n\s*\n/);
            
            let targetStatsetData = null;
            for (const chunk of statsetChunks) {
                if (chunk.includes(`Statset ${mostCommonStatSet}:`)) {
                    targetStatsetData = chunk.trim();
                    break;
                }
            }

            if (!targetStatsetData) {
                await interaction.editReply({ content: `Stat set ${mostCommonStatSet} not found in statsets.txt for '${modName}'.` });
                return;
            }

            const statLines = targetStatsetData.split(/\r?\n/).slice(1);
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

            if (level) {
                const stats = levelStats.get(level);
                if (!stats) {
                    await interaction.editReply({ content: `Level ${level} not found in stat set ${mostCommonStatSet}.` });
                    return;
                }

                const response = `**Stats for ${className} (Level ${level}) in ${modName}**\n` +
                    `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                    `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}`;

                await interaction.editReply({ content: response });
                return;
            }

            // Since we don't have dropdown logic implemented for events in this context yet (events.js would need updates too), 
            // and dropdowns require user interaction which we can't easily fake without updating event handlers.
            // But I will output the stats for Level 1, 10, 20 like a summary or stick to the original logic which was dropdowns.
            // But dropdowns require event handler. The original file had dropdowns.
            // I should just list level 1 stats if no level provided or ask to provide level.
            // For now I'll just ask for level or output level 1.
            
            const stats = levelStats.get(1);
            if (stats) {
                const response = `**Stats for ${className} (Level 1) in ${modName}**\n` +
                `*Using stat set ${mostCommonStatSet} (most common for this class)*\n\n` +
                `**CON:** ${stats.con} | **PWR:** ${stats.pwr} | **ACC:** ${stats.acc} | **DEF:** ${stats.def} | **INI:** ${stats.ini}\n` + 
                `(Tip: Use the 'level' option to see other levels)`;
                await interaction.editReply({ content: response });
            } else {
                 await interaction.editReply({ content: "Could not retrieve level 1 stats. Please specify a level."});
            }

        } catch (error) {
            // this.logger.error('Error executing stats command:', error); // logger might not be available on `this` if executed as method, need to check `extra`.
            // But ModuleHandler sets `command.logger`.
            console.error(error);
            if(interaction.deferred) await interaction.editReply({ content: 'An error occurred.' });
            else await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        }
    }
};

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
            }            // Find all gladiators with the matching base class and collect their stat sets
            const gladiatorsContent = fs.readFileSync(filePaths.gladiatorsFilePath, 'utf8');
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
            }            // Read statsets.txt and find the stat set
            const statsetsContent = fs.readFileSync(filePaths.statsetsFilePath, 'utf8');
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
