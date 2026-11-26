const fs = require('fs');
const { SlashCommandBuilder } = require('discord.js');
const helpers = require('../functions');
const classCatalog = require('../class_catalog');

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

            // One cached catalog per mod: class records, display labels and
            // descriptions all come from the same parse the autocomplete uses.
            const catalog = classCatalog.getCatalog(modName);
            const classes = catalog.classes.map((cls) => ({
                ...cls,
                className: cls.code,
                displayName: cls.label
            }));

            // Resolve the typed class through the catalog: a code or a
            // "Display (Code)" label selects one class, a shared display name
            // selects the whole family.
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

            // Both the first page and the prev/next handler render through the
            // same helpers, so a class page cannot differ between entry points.
            const currentPage = 0;
            const embed = helpers.createClassEmbed(filteredClasses[currentPage], currentPage, filteredClasses.length, modName);
            const row = helpers.createClassComponents(filteredClasses[currentPage], currentPage, filteredClasses.length, modName);

            await interaction.reply({ embeds: [embed], components: [row] });

        } catch (error) {
            this.logger.error('Error in classes command:', error);
            await interaction.reply({ content: 'An error occurred while fetching class information.' });
        }
    }
};
