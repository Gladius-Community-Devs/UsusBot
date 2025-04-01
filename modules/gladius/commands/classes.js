const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'classes',
    description: 'Shows information about classes.',
    syntax: 'classes [mod (optional)] [class name (optional)]',
    num_args: 0,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args = [], extra) {  // Add default empty array for args
        const sanitizeInput = (input) => {
            if (!input || typeof input !== 'string') return '';  // Add input validation
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1;
        let searchTerm = '';

        try {
            // Load modders.json and handle mod name
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            if (args && args.length > 1) {  // Check if args exists and has elements
                let modNameInput = sanitizeInput(args[1]);
                if (modNameInput) {  // Only process if we have valid input
                    for (const modder in moddersConfig) {
                        const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                        if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                            modName = moddersConfig[modder].replace(/\s+/g, '_');
                            index = 2;
                            break;
                        }
                    }
                }
            }

            // Get search term if provided, with validation
            if (args && args.length > index) {
                searchTerm = args.slice(index)
                    .filter(arg => arg && typeof arg === 'string')  // Filter out invalid args
                    .join(' ')
                    .toLowerCase();
            }

            // Sanitize modName and define paths
            modName = path.basename(sanitizeInput(modName));
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const classdefsPath = path.join(modPath, 'data', 'config', 'classdefs.tok');
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');

            // Check if files exist
            if (!fs.existsSync(classdefsPath) || !fs.existsSync(lookupFilePath)) {
                message.channel.send({ content: `Required files are missing for mod '${modName}'.` });
                return;
            }

            // Load and parse files
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const classdefsContent = fs.readFileSync(classdefsPath, 'utf8');

            // Parse lookup text
            const entryIdToText = {};
            for (const line of lookupContent.split(/\r?\n/)) {
                if (!line.trim()) continue;
                const [id, ...textParts] = line.split('^');
                entryIdToText[id.trim()] = textParts[textParts.length - 1].trim();
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
                if (classData && classData.className) {  // Verify we have valid class data
                    // Get display name and description from lookup text
                    const displayName = classData.DISPLAYNAMEID ? 
                        entryIdToText[classData.DISPLAYNAMEID] || classData.className : 
                        classData.className;
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
                message.channel.send({ content: `No classes found${searchTerm ? ` matching '${searchTerm}'` : ''} in '${modName}'.` });
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
            message.channel.send({ embeds: [embed], components: [row] });

        } catch (error) {
            this.logger.error('Error in classes command:', error);
            message.channel.send({ content: 'An error occurred while fetching class information.' });
        }
    }
};

// Helper function to parse class chunks
function parseClassChunk(chunk) {
    if (!chunk || typeof chunk !== 'string') return null;

    const lines = chunk.trim().split(/\r?\n/);
    const classData = {
        className: '',
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
        } else if (trimmedLine.startsWith('DISPLAYNAMEID:')) {
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
