const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('prizes')
        .setDescription('Shows prize information for a specified encounter or league')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('encounter_name')
                .setDescription('The encounter or league name to look up')
                .setRequired(true)
                .setAutocomplete(true)),
    name: 'prizes',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const fs = require('fs');
        const path = require('path');
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();

        if (focusedOption.name === 'mod_name') {
            const moddersConfigPath = path.join(__dirname, '../modders.json');
            const choices = ['Vanilla'];
            try {
                const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
                for (const modder in moddersConfig) {
                    choices.push(moddersConfig[modder].replace(/\s+/g, '_'));
                }
            } catch {}
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'encounter_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = path.basename(rawMod.replace(/[^\w\s_-]/g, '').trim().replace(/\s+/g, '_')) || 'Vanilla';
            const leaguesPath = path.join(__dirname, '../../../uploads', modName, 'data', 'towns', 'leagues');
            const lookupPath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'lookuptext_eng.txt');
            const names = [];
            try {
                // Build id -> name map from lookup
                const idToName = {};
                const lookupContent = fs.readFileSync(lookupPath, 'utf8');
                for (const line of lookupContent.split(/\r?\n/)) {
                    if (!line.includes('^')) continue;
                    const parts = line.split('^');
                    idToName[parts[0].trim()] = parts[parts.length - 1].trim();
                }
                // Scan league files for LEAGUE/ENCOUNTER entry IDs
                const seen = new Set();
                const leagueFiles = fs.readdirSync(leaguesPath).filter(f => f.endsWith('.tok'));
                for (const file of leagueFiles) {
                    const content = fs.readFileSync(path.join(leaguesPath, file), 'utf8');
                    for (const match of content.matchAll(/^(?:LEAGUE|ENCOUNTER)\s+"[^"]+",\s*(\d+)/gm)) {
                        const displayName = idToName[match[1].trim()];
                        if (displayName && !seen.has(displayName.toLowerCase())) {
                            seen.add(displayName.toLowerCase());
                            names.push(displayName);
                        }
                    }
                }
                names.sort();
            } catch {}
            const filtered = names.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        }
    },
    async execute(interaction, extra) {
        await interaction.deferReply();

        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s''&-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                const sanitizedInput = sanitizeInput(modNameInput);
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === sanitizedInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        break;
                    }
                }
            }

            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const prizesFilePath = path.join(modPath, 'data', 'config', 'prizes.tok');
            const leaguesPath = path.join(modPath, 'data', 'towns', 'leagues');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                await interaction.editReply({ content: `That mod does not have files yet!` });
                return;
            }

            if (!fs.existsSync(prizesFilePath)) {
                await interaction.editReply({ content: `That mod is missing its prizes.tok file!` });
                return;
            }

            if (!fs.existsSync(leaguesPath)) {
                await interaction.editReply({ content: `That mod is missing its leagues folder!` });
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

            const searchName = sanitizeInput(interaction.options.getString('encounter_name'));

            // Get all entry IDs for the search name
            const entryIds = nameToEntryIds[searchName.toLowerCase()] || [];

            if (entryIds.length === 0) {
                await interaction.editReply({ content: `No encounter or league named '${searchName}' found in '${modName}'.` });
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
                await interaction.editReply({ content: `No encounter or league named '${searchName}' found in '${modName}'.` });
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
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error finding prizes:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding the prizes.' });
            else await interaction.reply({ content: 'An error occurred while finding the prizes.', ephemeral: true });
        }
    }
};
