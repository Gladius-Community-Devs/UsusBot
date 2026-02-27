const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('classes')
        .setDescription('Shows information about gladiator classes')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('class_name')
                .setDescription('Class name to filter by (optional, shows all if omitted)')
                .setAutocomplete(true)),
    name: 'classes',
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
        } else if (focusedOption.name === 'class_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = path.basename(rawMod.replace(/[^\w\s_-]/g, '').trim().replace(/\s+/g, '_')) || 'Vanilla';
            const classdefsPath = path.join(__dirname, '../../../uploads', modName, 'data', 'config', 'classdefs.tok');
            const classes = [];
            try {
                const content = fs.readFileSync(classdefsPath, 'utf8');
                for (const match of content.matchAll(/^CREATECLASS:\s*(\S+)/gm)) {
                    const name = match[1].trim();
                    if (!name.startsWith('//')) classes.push(name);
                }
            } catch {}
            const filtered = classes.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        }
    },
    async execute(interaction, extra) {
        const sanitizeInput = (input) => {
            if (!input || typeof input !== 'string') return '';
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let searchTerm = '';

        try {
            // Load modders.json and handle mod name
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

            const classNameInput = interaction.options.getString('class_name');
            if (classNameInput) {
                searchTerm = sanitizeInput(classNameInput).toLowerCase();
            }

            // Sanitize modName and define paths
            modName = path.basename(sanitizeInput(modName));
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const classdefsPath = path.join(modPath, 'data', 'config', 'classdefs.tok');
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');

            // Check if files exist
            if (!fs.existsSync(classdefsPath) || !fs.existsSync(lookupFilePath)) {
                await interaction.reply({ content: `Required files are missing for mod '${modName}'.` });
                return;
            }

            // Load and parse files
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const classdefsContent = fs.readFileSync(classdefsPath, 'utf8');

            // Parse lookup text with more robust error handling
            const entryIdToText = {};
            if (lookupContent && typeof lookupContent === 'string') {
                try {
                    const lines = lookupContent.split(/\r?\n/).filter(line => line && line.trim());
                    
                    for (const line of lines) {
                        // Skip invalid lines
                        if (!line || !line.includes('^')) continue;
                        
                        const parts = line.split('^');
                        if (parts.length >= 2) {
                            const id = parts[0].trim();
                            const text = parts[parts.length - 1].trim();
                            if (id && text) {
                                entryIdToText[id] = text;
                            }
                        }
                    }
                } catch (parseError) {
                    console.error('Error parsing lookup text:', parseError);
                }
            } else {
                console.error('Invalid lookup content format');
            }

            // Parse class definitions - update the splitting logic
            const classes = [];
            // Split on CREATECLASS: to ensure we get complete class definitions
            const classChunks = classdefsContent.split(/\nCREATECLASS:/);
            
            // Process each chunk, skipping the first empty chunk if it exists
            for (let i = 0; i < classChunks.length; i++) {
                let chunk = classChunks[i].trim();
                if (!chunk) continue;
                
                // Add back the CREATECLASS: prefix except for first chunk if it already has it
                if (!chunk.startsWith('CREATECLASS:')) {
                    chunk = 'CREATECLASS:' + chunk;
                }

                const classData = parseClassChunk(chunk);
                if (classData && classData.className && !classData.className.startsWith('//')) {
                    // Get display name and description
                    const displayName = classData.DISPLAYNAMEID ? 
                        entryIdToText[classData.DISPLAYNAMEID] || classData.className : 
                        classData.className;
                    
                    // Skip entries that look like comments
                    if (displayName.startsWith('//')) continue;
                    
                    const description = classData.DESCRIPTIONID ? 
                        entryIdToText[classData.DESCRIPTIONID] || '' : 
                        '';

                    classes.push({
                        ...classData,
                        displayName,
                        description
                    });
                }
            }

            // Sort classes alphabetically
            classes.sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Filter classes if search term provided
            const filteredClasses = searchTerm ? 
                classes.filter(c => c.displayName.toLowerCase().includes(searchTerm)) : 
                classes;

            if (filteredClasses.length === 0) {
                await interaction.reply({ content: `No classes found${searchTerm ? ` matching '${searchTerm}'` : ''} in '${modName}'.` });
                return;
            }

            // Create initial embed
            const currentPage = 0;
            const embed = createClassEmbed(filteredClasses[currentPage], currentPage, filteredClasses.length, modName);

            // Create navigation buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`class-prev|${modName}|${currentPage}`)
                        .setLabel('◀️ Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`class-next|${modName}|${currentPage}`)
                        .setLabel('Next ▶️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === filteredClasses.length - 1),
                    new ButtonBuilder()
                        .setCustomId(`class-skills|${modName}|${encodeURIComponent(filteredClasses[currentPage].className)}`)
                        .setLabel('📚 Learnable Skills')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send the message
            await interaction.reply({ embeds: [embed], components: [row] });

        } catch (error) {
            console.error('Error in classes command:', error);
            await interaction.reply({ content: 'An error occurred while fetching class information.' });
        }
    }
};

// Helper function to parse class chunks
function parseClassChunk(chunk) {
    if (!chunk || typeof chunk !== 'string') return null;

    const lines = chunk.trim().split(/\r?\n/);
    const classData = {
        className: '',
        skillUseName: '',
        DISPLAYNAMEID: null,
        DESCRIPTIONID: null,
        attributes: [],
        weapons: [],
        armors: [],
        helmets: [],
        shields: [],
        accessories: []
    };

    for (const line of lines) {
        if (!line || typeof line !== 'string') continue;
        
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('//')) continue;

        if (trimmedLine.startsWith('CREATECLASS:')) {
            classData.className = trimmedLine.split(':')[1]?.trim() || '';
        } else if (trimmedLine.startsWith('SKILLUSENAME:')) {
            // Extract the skill use name and remove any surrounding quotes.
            classData.skillUseName = trimmedLine.split(':')[1]?.trim().replace(/"/g, '') || '';
        }else if (trimmedLine.startsWith('DISPLAYNAMEID:')) {
            classData.DISPLAYNAMEID = trimmedLine.split(':')[1]?.trim() || null;
        } else if (trimmedLine.startsWith('DESCRIPTIONID:')) {
            classData.DESCRIPTIONID = trimmedLine.split(':')[1]?.trim() || null;
        } else if (trimmedLine.startsWith('ATTRIBUTE:')) {
            const attribute = trimmedLine.split(':')[1]?.trim()?.replace(/"/g, '');
            if (attribute) classData.attributes.push(attribute);
        } else if (trimmedLine.startsWith('ITEMCAT:')) {
            try {
                const parts = trimmedLine.split(',').map(s => s.trim());
                if (parts.length >= 3) {
                    const [category, type, style] = [parts[0].split(' ')[1], parts[1], parts[2]];
                    const cleanType = type.replace(/"/g, '');
                    const cleanStyle = style.replace(/"/g, '');
                    
                    switch (category.toLowerCase()) {
                        case 'weapon':
                            classData.weapons.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'armor':
                            classData.armors.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'helmet':
                            classData.helmets.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'shield':
                            classData.shields.push(`${cleanType} (${cleanStyle})`);
                            break;
                        case 'accessory':
                            classData.accessories.push(`${cleanType} (${cleanStyle})`);
                            break;
                    }
                }
            } catch (error) {
                // Skip malformed ITEMCAT lines
                continue;
            }
        }
    }

    return classData.className ? classData : null;  // Only return if we have a valid class name
}

// Export the parseClassChunk function for reuse
module.exports.parseClassChunk = parseClassChunk;

// Helper function to create an embed for a class
function createClassEmbed(classData, currentPage, totalPages, modName) {
    const embed = new EmbedBuilder()
        .setTitle(classData.displayName)
        .setDescription(`Class in ${modName} (${currentPage + 1}/${totalPages})`)
        .setColor(0x00FF00);

    // Add description if available
    if (classData.description) {
        embed.addFields({ name: 'Description', value: classData.description });
    }

    // Add attributes
    if (classData.attributes.length > 0) {
        embed.addFields({ 
            name: 'Attributes', 
            value: classData.attributes.join(', ') 
        });
    }

    // Add equipment categories
    const categories = [
        { name: 'Weapons', items: classData.weapons },
        { name: 'Armor', items: classData.armors },
        { name: 'Helmets', items: classData.helmets },
        { name: 'Shields', items: classData.shields },
        { name: 'Accessories', items: classData.accessories }
    ];

    for (const category of categories) {
        if (category.items.length > 0) {
            embed.addFields({ 
                name: category.name, 
                value: category.items.join('\n'),
                inline: true 
            });
        }
    }

    return embed;
}

// Export the createClassEmbed function for reuse
module.exports.createClassEmbed = createClassEmbed;

// New helper to re-read and filter class definitions
