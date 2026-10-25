var fs = require('fs');
var crypto = require('crypto');
var APIClient = require('./APIClient.js');
const Discord = require('discord.js');
const { REST, Routes, SlashCommandBuilder, Collection } = require('discord.js');
const InteractionAdapter = require('./interaction_adapter.js');

/**
 * @external Discord
 * @see {@link https://discord.js.org/|Discord.js Documentation}
 */

/**
 * @external Discord::Collection
 * @extends external:Discord
 * @see {@link https://discord.js.org/#/docs/collection/main/class/Collection|Collection}
 */

/**
 * @external Discord::Message
 * @extends external:Discord
 * @see {@link https://discord.js.org/#/docs/discord.js/main/class/Message|Message}
 */

/**
 * @external Logger
 * @see {@link https://github.com/winstonjs/winston#creating-your-own-logger|Winston Documentation}
 */

/**
 * @typedef {Object} Module
 * @property {ModuleConfig} config - The {@link ModuleConfig} that stores the configuration for this module
 * @property {string} location - The location of this module (relative to {@link ModuleHandler#program_path}). Ex: would be '/modules/core/' for the core module.
 * Represents an independent module for this bot. Modules each have their own set of commands and optional event handlers, and can be added and removed independently of
 * each other. Technically, the bot could run with no modules installed at all, or you could swap out the 'core' module for your own to modify even the core functionality
 * of the system.
 */

/**
 * An object containing the configuration for a {@link Module}, which defines the specifics about how the module works.
 * @typedef {Object} ModuleConfig
 * @property {string} name - The internal name for this {@link Module}. Should be all lowercase, no spaces, no special symbols by convention.
 * @property {string} display_name - The 'pretty' version of the name for this {@link Module}. This is what users will see.
 * @property {string} version - The version of the {@link Module}. Can follow whatever format is desired.
 * @property {boolean} enabled - Whether this {@link Module} is enabled. If false, the module's commands and event handlers will not be loaded.
 * @property {string} commands_directory - The name of the directory (without any slashes) inside this module's {@link Module#location} directory where commands can be found. Usually 'commands' by convention.
 * @property {string} command_prefix - The character or set of characters that indicates a {@link Command} from this {@link Module} follows. For example, if you wanted to have a command triggered by the phrase '/help', the module's command_prefix would be '/'.
 * @property {boolean} is_core - Whether this is a 'Core Module'. Core Modules are passed an instance of this {@link ModuleHandler} when their commands run, so that they may access the internals of the bot.
 * @property {(boolean|string)} event_handler - If this {@link Module} uses event handlers, this should be a string containing the name of the file in the {@link Module#location} directory that handles events. If this {@link Module} does not use event handlers, this value should be false.
 */

/**
 * Represents a command that users can run. 
 * @typedef {Object} Command
 * @property {string} name - The name of this command. This is what users will enter following the {@link ModuleConfig#command_prefix} to invoke a command's execution.
 * @property {string} description - A description of what the command does. Will be displayed in the 'help' core command, so keep it fairly short.
 * @property {string} syntax - A string defining the syntax for the command. Not used in parsing, but will be displayed to the user in the help menu or if a command is malformatted.
 * @property {number} num_args - The minimum number of arguments expected for this command. If less than this amount are provided, the command will not be run and the bot will display the {@link Command#syntax}.
 * @property {boolean} args_to_lower - All arguments passed with this command will be converted to lowercase before the command runs if this is true.
 * @property {boolean} needs_api - Whether this command makes use of the integrated RESTful API. If true, an instance of APIClient will be passed as 'extra.api' in the {@link Command#execute} function.
 * @property {function(external:Discord.Interaction, Object)} execute - The function that executes the command. This is where all of the command's logic ultimately lies. The 'extra' object has properties that vary: 'extra.api' if {@link Command#needs_api} is true, 'extra.module_handler' if this is a core module ({@link ModuleConfig#is_core} is true).
 */

/**
 * The major core system of the bot. This class handles discovering {@link Module}s, loading modules,
 * checking {@link ModuleConfig}s, discovering {@link Command}s within each module, and figuring out when to run a command.
 */
class ModuleHandler {

    /**
     * Constructor for {@link ModuleHandler}
     *
     * @constructor
     * @param {string} program_path - The absolute path this ModuleHandler will use as its base working directory
     * @param {Logger} logger - The Logger instance for this ModuleHandler
     * @param {ErrorReporter} reporter - The {@link ErrorReporter} used to surface failures
     */
    constructor(program_path, logger, reporter) {
        /** @type {string} The absolute path this ModuleHandler will use as its base working directory */
        this.program_path = program_path;
        /** @type {?external:Discord.Collection<Module>} A {@link external:Discord.Collection} object containing all the modules this bot found. Will be null until {@link ModuleHandler#discover_modules} runs. */
        this.modules = null;
        /** @type {?external:Discord.Collection<Module>} A {@link external:Discord.Collection} object containing all the modules this bot found but were disabled (by their config). Will be null until {@link ModuleHandler#discover_modules} runs. */
        this.disabled_modules = null;
        /** @type {external:Logger} The {@link external:Logger} object for this {@link ModuleHandler}. Will also be passed to commands when they run. */
        this.logger = logger;
        /** @type {ErrorReporter} Surfaces failures to the log file and to Discord. */
        this.reporter = reporter;
    }

    /**
     * As the name says, discovers {@link Module}s.
     *
     * Takes the path of the folder containing modules as a parameter. Checks each directory within the
     * given folder to see if it is a valid module. If the directory contains a bot_module.json file, this function will create the module
     * and register it with this {@link ModuleHandler} (by adding it to {@link ModuleHandler#modules}). Note that if a module's config has the module globally disabled,
     * it will be added to {@link ModuleHandler#disabled_modules} instead. Globally disabled modules will not have their commands or event handlers loaded.
     *
     * @param {string} modules_folder The location of the folder containing the modules for this bot. This will be appended to {@link ModuleHandler#program_path}.
     * @returns {} Nothing is returned.
     */
    discover_modules(modules_folder) {
        this.modules = new Discord.Collection();
        this.disabled_modules = new Discord.Collection();

        this.logger.info("Discovering Modules in: " + modules_folder + " ...");
        var module_folders = fs.readdirSync(modules_folder, { withFileTypes: true });
        for (var folder of module_folders) { //Iterate all folders in modules directory
            if (folder.isDirectory() && fs.existsSync(modules_folder + "/" + folder.name + "/bot_module.json")) {
                var module_config = JSON.parse(fs.readFileSync(modules_folder + "/" + folder.name + "/bot_module.json")); //Load module config if found
                var the_module = {
                    config: module_config,
                    location: modules_folder + "/" + folder.name + "/"
                };

                if (the_module.config.enabled) {
                    this.modules.set(the_module.config.name, the_module); //Add module to this ModuleHandler
                } else {
                    this.disabled_modules.set(the_module.config.name, the_module);
                }
            }
        }
    }

    /**
     * Registers slash commands with Discord for the specified guilds.
     * @param {string} token - The bot token.
     * @param {string} clientId - The bot's client ID.
     * @param {string[]} guildIds - Array of guild IDs to register commands in.
     */
    async register_slash_commands(token, clientId, guildIds) {
        const commands = [];
        this.logger.info("Gathering slash commands for registration...");

        for (const [moduleName, module] of this.modules) {
            for (const [commandName, command] of module.commands) {
                if (command.data) {
                    commands.push(command.data.toJSON());
                } else {
                    // Skip intentionally-hidden commands (h- prefix) from slash registration.
                    // These commands typically require message attachments and must remain prefix-only.
                    if (command.name && command.name.startsWith('h-')) {
                        this.logger.info(`Skipping slash registration for hidden command: ${command.name}`);
                        continue;
                    }

                    // Auto-generate basic slash command for legacy commands.
                    const description = (command.description || 'No description provided.').substring(0, 100);
                    const argDesc = (command.syntax || 'Arguments for the command').substring(0, 100);
                    const legacyBuilder = new SlashCommandBuilder()
                        .setName(command.name)
                        .setDescription(description);
                    
                    const isRequired = !!(command.num_args && command.num_args > 0);
                    legacyBuilder.addStringOption(option => 
                        option.setName('args')
                            .setDescription(argDesc)
                            .setRequired(isRequired));

                    commands.push(legacyBuilder.toJSON());
                }
            }
        }

        const rest = new REST({ version: '10' }).setToken(token);

        for (const guildId of guildIds) {
            try {
                this.logger.info(`Started refreshing ${commands.length} application (/) commands for guild ${guildId}.`);

                const data = await rest.put(
                    Routes.applicationGuildCommands(clientId, guildId),
                    { body: commands },
                );

                this.logger.info(`Successfully reloaded ${data.length} application (/) commands for guild ${guildId}.`);
            } catch (error) {
                this.logger.error(`Failed to reload application (/) commands for guild ${guildId}: ${error}`);
            }
        }
    }

    /**
     * Handles incoming interactions (slash commands).
     * @param {external:Discord.Interaction} interaction - The interaction to handle.
     */
    async handle_autocomplete(interaction) {
        const commandName = interaction.commandName;
        let command;
        for (const [, mod] of this.modules) {
            if (mod.commands && mod.commands.has(commandName)) {
                command = mod.commands.get(commandName);
                break;
            }
        }
        if (!command || !command.autocomplete) {
            try { await interaction.respond([]); } catch {}
            return;
        }
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            this.logger.error(`Autocomplete error for ${commandName}: ${error}`);
            try { await interaction.respond([]); } catch {}
        }
    }

    async handle_interaction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const commandName = interaction.commandName;
        let command;
        let moduleConfig;

        // Find the command and its module
        for (const [name, mod] of this.modules) {
            if (mod.commands.has(commandName)) {
                command = mod.commands.get(commandName);
                moduleConfig = mod.config;
                break;
            }
        }

        if (!command) {
            this.logger.error(`No command matching ${commandName} was found.`);
            return;
        }

        // One id per invocation so every API call made for this command, and
        // any failure it produces, can be grouped in the log.
        const correlationId = crypto.randomUUID();

        try {
            if (!moduleConfig.enabled) {
                 await interaction.reply({ content: 'This module is disabled.', ephemeral: true });
                 return;
            }

            var extra = {};
            if (moduleConfig.is_core) {
                extra.module_handler = this;
            }

            if (command.needs_api) {
                 extra.api = new APIClient({ correlationId });
            }

            // If command.data is present, it's a native slash command
            // However, we must distinguish between "migrated" commands and commands that are still legacy but we auto-generated data for.
            // But wait, the loop above (Lines 163-176) generates .data via `legacyBuilder` but does NOT modify `command.data` on the command object itself in memory if I understand correctly.
            // `register_slash_commands` builds a `commands` array. It does not attach `.data` to the command object in `this.modules`.
            // So `command.data` will be undefined for legacy commands.
            
            if (command.data) {
                await command.execute(interaction, extra);
            } else {
                // Legacy: Use Adapter
                const adapter = new InteractionAdapter(interaction, this.logger);
                
                let legacyArgs = [commandName];
                const argsOption = interaction.options.getString('args');
                if (argsOption) {
                    // Split by space, similar to original message.content.split(" ")
                    const splitArgs = argsOption.split(/\s+/);
                    legacyArgs = legacyArgs.concat(splitArgs);
                } else if (interaction.options.data.length > 0) {
                     // Fallback: If we have options but not 'args', maybe try to map them?
                     // But our legacy builder only adds 'args'.
                }

                if (command.args_to_lower) {
                    legacyArgs = legacyArgs.map(arg => arg.toLowerCase());
                }

                await command.execute(adapter, legacyArgs, extra);
            }

        } catch (error) {
            // The API client already reported its own failures; anything else
            // (a command bug, a rejected reply) is reported here with the
            // context needed to find it again.
            if (!error || error.reported !== true) {
                if (this.reporter) {
                    this.reporter.report(error, {
                        command: commandName,
                        user: interaction.user?.id,
                        guild: interaction.guildId,
                        correlationId,
                    });
                } else {
                    this.logger.error(`Error executing ${commandName} via interaction`);
                    this.logger.error(error);
                }
            } else {
                this.logger.error({ message: `Command ${commandName} failed`, command: commandName, correlationId });
            }
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    }

    /**
     * Discovers {@link Command}s within each module.
     *
     * For each {@link Module} in {@link ModuleHandler#modules}, this function will check the module's {@link ModuleConfig#commands_directory} for the directory containing
     * command files. This directory should contain one .js file for each command to be added. The command files should each export a single object
     * following the format of {@link Command}.
     * 
     * @returns {} Nothing is returned.
     */
    discover_commands() {

        for (var current_module_name of Array.from(this.modules.keys())) {
            var current_module = this.modules.get(current_module_name);
            current_module.commands = new Discord.Collection();

            var commands_dir = current_module.location + current_module.config.commands_directory + "/";

            this.logger.info("Discovering Commands in: " + commands_dir + " ...");
            var command_files = fs.readdirSync(commands_dir).filter(file => file.endsWith('.js'));

            for (var file of command_files) {
                var command = require(commands_dir + file);
                command.logger = this.logger;
                
                // Support both legacy "name" and new "data.name"
                const commandName = command.data ? command.data.name : command.name;
                
                if (commandName) {
                    current_module.commands.set(commandName, command);
                } else {
                    this.logger.warn(`Command in file ${file} has no name property. Skipping.`);
                }
            }
        }

        if (this.modules.size > 0) {
            this.logger.info("Discovered " + this.modules.size + " active module(s) and " + this.disabled_modules.size + " inactive module(s):");
            for (var current_module_name of Array.from(this.modules.keys())) {
                this.logger.info("  + " + this.modules.get(current_module_name).config.display_name + " (" + this.modules.get(current_module_name).commands.size + " commands)");
            }

            for (var current_module_name of Array.from(this.disabled_modules.keys())) {
                this.logger.info("  - " + this.disabled_modules.get(current_module_name).config.display_name);
            }
        } else {
            this.logger.warn("No active modules found! Please enable at least one module for this bot to have any purpose!");
            this.logger.info("Discovered " + this.disabled_modules.size + " inactive modules:");
            for (var current_module_name of Array.from(this.disabled_modules.keys())) {
                this.logger.info("  - " + this.disabled_modules.get(current_module_name).config.display_name);
            }
        }
    }

    /**
     * Answers the retired `;command` form with a pointer to the slash command it
     * became.
     *
     * Message-based execution is gone: every command is a slash command now, and
     * the old path only re-derived what the slash router already knows while
     * adding two API round trips per command, a token read per message and a
     * crash on every DM. Keeping the hint means muscle memory (";skill") gets an
     * answer instead of silence, without reviving any of that machinery.
     *
     * @param {external:Discord.Message} message - A guild message the bot can see.
     * @returns {Promise<void>|undefined} Resolves once a hint is sent, if any.
     */
    hint_legacy_prefix(message) {
        const content = (message.content || '').trim();

        for (const mod of this.modules.values()) {
            const prefix = mod.config.command_prefix;
            if (!prefix || !content.startsWith(prefix)) continue;

            const commandName = content.slice(prefix.length).split(/\s+/)[0];
            if (!commandName || !mod.commands.has(commandName)) continue;

            const command = mod.commands.get(commandName);
            const slashName = command.data ? command.data.name : command.name;
            if (!slashName) continue;

            const hint = `\`${prefix}${commandName}\` is now \`/${slashName}\`. Slash commands are the only supported form.`;
            return message.channel.send({ content: hint }).catch(() => {});
        }
    }
}

module.exports = ModuleHandler;