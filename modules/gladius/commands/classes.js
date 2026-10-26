const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const helpers = require('../functions');
const classCatalog = require('../class_catalog');
const { splitFieldValue, addFieldsSafe } = require('../../../core/js/text_utils.js');
const siteLinks = require('../site_links');

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
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();
        if (focusedOption.name === 'mod_name') {
            const choices = helpers.getAvailableMods();
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else if (focusedOption.name === 'class_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const modName = helpers.resolveModName(rawMod);
            if (!helpers.getAvailableMods().some((name) => name.toLowerCase() === modName.toLowerCase())) {
                await interaction.respond([]);
                return;
            }
            try {
                const catalog = classCatalog.getCatalog(modName);
                await interaction.respond(classCatalog.classChoices(catalog.classes, focused));
            } catch (error) {
                this.logger.error(`Failed to load class autocomplete data for ${modName}:`, error);
                await interaction.respond([]);
            }
        }
    },
    async execute(interaction, extra) {
        const sanitizeInput = (input) => {
            if (!input || typeof input !== 'string') return '';
            return input.replace(/[^\w\s''-]/g, '').trim();
        };

        let modName = 'Vanilla';

        try {
            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                modName = helpers.resolveModName(modNameInput);
            }

            const classNameInput = interaction.options.getString('class_name');

            // Sanitize modName and define paths
            modName = helpers.resolveModName(sanitizeInput(modName));
            const filePaths = helpers.getModFilePaths(modName);
            const classdefsPath = filePaths.classdefsPath;
            const lookupFilePath = filePaths.lookupFilePath;

            // Check if files exist
            if (!fs.existsSync(classdefsPath) || !fs.existsSync(lookupFilePath)) {
                await interaction.reply({ content: `Required files are missing for mod '${modName}'.` });
                return;
            }

            // Load and parse files
            const lookupContent = helpers.readTextFile(lookupFilePath);
            const classdefsContent = helpers.readTextFile(classdefsPath);

            // Parse lookup text with more robust error handling
            const entryIdToText = {};
            if (lookupContent && typeof lookupContent === 'string') {
                try {
                    const lines = lookupContent.split(/\r?\n/).filter(line => line && line.trim());
                    
                    for (const line of lines) {
                        // Skip invalid lines
                        if (!line || !line.includes('^') || line.trim().startsWith('//')) continue;
                        
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
                    this.logger.error(`Error parsing class lookup text for ${modName}:`, parseError);
                }
            } else {
                this.logger.error(`Invalid lookup content format for ${modName}.`);
            }

            // Split records at CREATECLASS: blank lines are cosmetic inside a
            // class block, so they cannot be used as separators.
            const classes = [];
            for (const chunk of helpers.splitClassRecords(classdefsContent)) {
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
                        rawDisplayName: displayName,
                        description
                    });
                }
            }

            // Shared display names need the CREATECLASS code to tell the pages
            // apart (Hero x8, Samnite x6, ...).
            const sharedNames = new Set(
                [...classes.reduce((counts, cls) => counts.set(cls.rawDisplayName, (counts.get(cls.rawDisplayName) || 0) + 1), new Map())]
                    .filter(([, count]) => count > 1)
                    .map(([name]) => name)
            );
            for (const cls of classes) {
                cls.displayName = helpers.labelClass(cls.rawDisplayName, cls.className, sharedNames);
            }

            // Sort classes alphabetically
            classes.sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Resolve the typed class through the catalog: a code or a
            // "Display (Code)" label selects one class, a shared display name
            // selects the whole family.
            const catalog = classCatalog.getCatalog(modName);
            const resolvedClass = classNameInput ? classCatalog.resolveClassInput(classNameInput, catalog) : null;
            let filteredClasses = classes;

            if (classNameInput) {
                if (!resolvedClass) {
                    await interaction.reply({ content: `No classes found matching '${classNameInput}' in '${modName}'.` });
                    return;
                }
                const codes = new Set(resolvedClass.codes.map((code) => code.toLowerCase()));
                filteredClasses = classes.filter((cls) => codes.has(cls.className.toLowerCase()));
            }

            if (filteredClasses.length === 0) {
                await interaction.reply({ content: `No classes found matching '${classNameInput}' in '${modName}'.` });
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
            this.logger.error('Error in classes command:', error);
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

    // Add description if available, split across fields when it is long enough
    // to break the 1024-character field limit.
    if (classData.description) {
        addFieldsSafe(embed, splitFieldValue(classData.description, { label: 'Description' }));
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

    embed.addFields({
        name: '🔗 Web',
        value: `[Open this class on the site](${siteLinks.classUrl(modName, classData.className)})`,
        inline: false
    });

    return embed;
}

// Export the createClassEmbed function for reuse
module.exports.createClassEmbed = createClassEmbed;

// New helper to re-read and filter class definitions





