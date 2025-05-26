const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'prizes',
    description: 'Finds and displays prize information for a specified encounter or league.',
    syntax: 'prizes [mod (optional)] [encounter/league name]',    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        // Adjusted sanitizeInput to allow apostrophes, hyphens, and ampersands
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''&-]/g, '').trim();
        };

        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the encounter or league name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Sanitize modNameInput
            let modNameInput = sanitizeInput(args[1]);

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
            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const prizesFilePath = path.join(modPath, 'data', 'config', 'prizes.tok');
            const leaguesPath = path.join(modPath, 'data', 'towns', 'leagues');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                message.channel.send({ content: `That mod does not have files yet!` });
                return;
            }

            if (!fs.existsSync(prizesFilePath)) {
                message.channel.send({ content: `That mod is missing its prizes.tok file!` });
                return;
            }

            if (!fs.existsSync(leaguesPath)) {
                message.channel.send({ content: `That mod is missing its leagues folder!` });
                return;
            }

            // Collect all possible encounter/league names and map them to entry IDs
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of encounter/league names to entry IDs
            const nameToEntryIds = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!nameToEntryIds[name]) {
                    nameToEntryIds[name] = [];
                }
                nameToEntryIds[name].push(id);
            }

            // Get the search name from user input
            const searchName = args.slice(index).join(' ').trim();
            const sanitizedSearchName = sanitizeInput(searchName);

            // Get all entry IDs for the search name
            const entryIds = nameToEntryIds[sanitizedSearchName.toLowerCase()] || [];

            if (entryIds.length === 0) {
                message.channel.send({ content: `No encounter or league named '${searchName}' found in '${modName}'.` });
                return;
            }

            // Read all league files
            const leagueFiles = fs.readdirSync(leaguesPath).filter(file => file.endsWith('.tok'));
            let allLeagueContent = '';
            
            for (const file of leagueFiles) {
                const filePath = path.join(leaguesPath, file);
                const content = fs.readFileSync(filePath, 'utf8');
                allLeagueContent += content + '\n';
            }

            // Parse league/encounter chunks
            const chunks = allLeagueContent.split(/\n\s*\n/);

            // Function to parse a chunk into a key-value object
            const parseChunk = (chunk) => {
                const lines = chunk.trim().split(/\r?\n/);
                const data = {};
                for (const line of lines) {
                    const lineTrimmed = line.trim();
                    if (lineTrimmed.startsWith('//') || !lineTrimmed) continue;
                    
                    const match = lineTrimmed.match(/^(\w+)\s+(.+)$/);
                    if (match) {
                        const key = match[1].toUpperCase();
                        let value = match[2].trim();

                        // Remove surrounding quotes if present
                        if (value.startsWith('"') && value.endsWith('"')) {
                            value = value.substring(1, value.length - 1);
                        }

                        // Store all values as arrays
                        if (!data[key]) {
                            data[key] = [];
                        }
                        data[key].push(value);
                    }
                }
                return data;
            };

            // Find matching encounters/leagues
            let matchingItems = [];

            for (const chunk of chunks) {
                if (chunk.includes('LEAGUE') || chunk.includes('ENCOUNTER')) {
                    const data = parseChunk(chunk);
                    
                    // Check for LEAGUE
                    if (data['LEAGUE']) {
                        const leagueLine = data['LEAGUE'][0];
                        const match = leagueLine.match(/^"([^"]+)",\s*(\d+)$/);
                        if (match) {
                            const entryId = parseInt(match[2]);
                            if (entryIds.includes(entryId)) {
                                matchingItems.push({
                                    type: 'LEAGUE',
                                    name: match[1],
                                    entryId: entryId,
                                    data: data,
                                    chunk: chunk.trim()
                                });
                            }
                        }
                    }
                    
                    // Check for ENCOUNTER
                    if (data['ENCOUNTER']) {
                        const encounterLine = data['ENCOUNTER'][0];
                        const match = encounterLine.match(/^"([^"]+)",\s*(\d+)$/);
                        if (match) {
                            const entryId = parseInt(match[2]);
                            if (entryIds.includes(entryId)) {
                                matchingItems.push({
                                    type: 'ENCOUNTER',
                                    name: match[1],
                                    entryId: entryId,
                                    data: data,
                                    chunk: chunk.trim()
                                });
                            }
                        }
                    }
                }
            }

            if (matchingItems.length === 0) {
                message.channel.send({ content: `No encounter or league named '${searchName}' found in '${modName}'.` });
                return;
            }

            // Read prizes.tok file
            const prizesContent = fs.readFileSync(prizesFilePath, 'utf8');
            const prizeChunks = prizesContent.split(/\n\s*\n/);            // Parse prize chunks
            const prizeData = {};
            for (const chunk of prizeChunks) {
                if (chunk.includes('PRIZE')) {
                    const data = parseChunk(chunk);
                    if (data['PRIZE']) {
                        const prizeName = data['PRIZE'][0].replace(/"/g, '');
                        prizeData[prizeName] = data;
                    }
                }
            }

            // Function to format prize information
            const formatPrize = (prizeName) => {
                const prize = prizeData[prizeName];
                if (!prize) return `Prize "${prizeName}" not found`;

                let result = `**${prizeName}**\n`;
                
                if (prize['PRIZECASH']) {
                    const cash = prize['PRIZECASH'][0].split(' ');
                    if (cash.length >= 2) {
                        const min = parseInt(cash[0]);
                        const max = parseInt(cash[1]);
                        if (min === max) {
                            result += `💰 Cash: ${min}\n`;
                        } else {
                            result += `💰 Cash: ${min} - ${max}\n`;
                        }
                    }
                }

                if (prize['PRIZEEXP']) {
                    const exp = prize['PRIZEEXP'][0].split(' ');
                    if (exp.length >= 2) {
                        const min = parseInt(exp[0]);
                        const max = parseInt(exp[1]);
                        if (min === max) {
                            result += `⭐ Experience: ${min}\n`;
                        } else {
                            result += `⭐ Experience: ${min} - ${max}\n`;
                        }
                    }
                }

                if (prize['PRIZEITEM']) {
                    result += `🎁 Items:\n`;
                    for (const item of prize['PRIZEITEM']) {
                        const itemName = item.replace(/"/g, '').split('\t')[0];
                        result += `  • ${itemName}\n`;
                    }
                }

                if (prize['PRIZEBADGE']) {
                    result += `🏆 Badge: ${prize['PRIZEBADGE'][0]}\n`;
                }

                return result;
            };

            // Function to get tier name
            const getTierName = (tier) => {
                switch(tier) {
                    case 0: return 'Amateur';
                    case 1: return 'Semi-Pro';
                    case 2: return 'Pro';
                    default: return `Tier ${tier}`;
                }
            };

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`🏆 Prize Information`)
                .setDescription(`Prizes for **${searchName}** in **${modName}**`)
                .setColor(0x00AE86)
                .setTimestamp();            let fieldCount = 0;
            const maxFields = 25; // Discord embed limit

            for (const item of matchingItems) {
                if (fieldCount >= maxFields) break;
                
                if (item.type === 'LEAGUE') {
                    // Handle PRIZECOMPLETION and PRIZEMASTERY
                    if (item.data['PRIZECOMPLETION']) {
                        const uniquePrizes = [...new Set(item.data['PRIZECOMPLETION'].map(p => p.split(' ')[0].replace(/"/g, '')))];
                        let completionText = '';
                        for (const prizeName of uniquePrizes) {
                            const prizeInfo = formatPrize(prizeName);
                            if (prizeInfo.length + completionText.length < 1024) {
                                completionText += prizeInfo + '\n';
                            }
                        }
                        if (completionText && fieldCount < maxFields) {
                            embed.addFields({
                                name: `🎯 ${item.name} - Completion Prizes`,
                                value: completionText.trim() || 'No completion prizes found',
                                inline: false
                            });
                            fieldCount++;
                        }
                    }
                    
                    if (item.data['PRIZEMASTERY']) {
                        const uniquePrizes = [...new Set(item.data['PRIZEMASTERY'].map(p => p.split(' ')[0].replace(/"/g, '')))];
                        let masteryText = '';
                        for (const prizeName of uniquePrizes) {
                            const prizeInfo = formatPrize(prizeName + '_Mastery');
                            if (prizeInfo.length + masteryText.length < 1024) {
                                masteryText += prizeInfo + '\n';
                            }
                        }
                        if (masteryText && fieldCount < maxFields) {
                            embed.addFields({
                                name: `⭐ ${item.name} - Mastery Prizes`,
                                value: masteryText.trim() || 'No mastery prizes found',
                                inline: false
                            });
                            fieldCount++;
                        }
                    }
                } else if (item.type === 'ENCOUNTER') {
                    // Handle PRIZETIER with tier information
                    if (item.data['PRIZETIER']) {
                        // Group prizes by tier
                        const prizesByTier = {};
                        for (const prizeEntry of item.data['PRIZETIER']) {
                            const parts = prizeEntry.split(' ');
                            const prizeName = parts[0].replace(/"/g, '');
                            const tier = parseInt(parts[1]);
                            
                            if (!prizesByTier[tier]) {
                                prizesByTier[tier] = new Set();
                            }
                            prizesByTier[tier].add(prizeName);
                        }
                        
                        // Create a field for each tier
                        for (const [tier, prizeSet] of Object.entries(prizesByTier)) {
                            if (fieldCount >= maxFields) break;
                            
                            const tierNum = parseInt(tier);
                            const tierName = getTierName(tierNum);
                            let tierText = '';
                            
                            for (const prizeName of prizeSet) {
                                const prizeInfo = formatPrize(prizeName);
                                if (prizeInfo.length + tierText.length < 1024) {
                                    tierText += prizeInfo + '\n';
                                }
                            }
                            
                            if (tierText) {
                                embed.addFields({
                                    name: `🎲 ${item.name} - ${tierName} Tier`,
                                    value: tierText.trim() || `No ${tierName.toLowerCase()} tier prizes found`,
                                    inline: false
                                });
                                fieldCount++;
                            }
                        }
                    }
                }
            }

            // Send the embed
            await message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Error finding prizes:', error);
            message.channel.send({ content: 'An error occurred while finding the prizes.' });
        }
    }
};
