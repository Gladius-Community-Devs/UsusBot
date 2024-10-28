var fs = require('fs');
var APIClient = require('./APIClient.js');
var Discord = require('discord.js');

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
 * @property {boolean} has_state - Whether this command makes use of the {@link StateManager}. If true, the {@link ModuleHandler} will automatically build a state and pass it via 'extra.state' in the {@link Command#execute} function.
 * @property {function(external:Discord.Message, string[], Object)} execute - The function that executes the command. This is where all of the command's logic ultimately lies. The array of arguments includes the name of the command itself as the first argument. The 'extra' object has properties that vary: 'extra.api' if {@link Command#needs_api} is true, 'extra.state' if {@link Command#has_state} is true, 'extra.module_handler' if this is a core module ({@link ModuleConfig#is_core} is true).
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
     * @param {StateManager} state_manager - The instance of StateManager for this ModuleHandler
     * @param {Logger} logger - The Logger instance for this ModuleHandler
     */
    constructor(program_path, state_manager, logger) {
        /** @type {string} The absolute path this ModuleHandler will use as its base working directory */
        this.program_path = program_path;
        /** @type {?external:Discord.Collection<Module>} A {@link external:Discord.Collection} object containing all the modules this bot found. Will be null until {@link ModuleHandler#discover_modules} runs. */
        this.modules = null;
        /** @type {?external:Discord.Collection<Module>} A {@link external:Discord.Collection} object containing all the modules this bot found but were disabled (by their config). Will be null until {@link ModuleHandler#discover_modules} runs. */
        this.disabled_modules = null;
        /** @type {StateManager} The {@link StateManager} instance for this {@link ModuleHandler}. Will be passed to commands when they run with the proper states loaded. */
        this.state_manager = state_manager;
        /** @type {external:Logger} The {@link external:Logger} object for this {@link ModuleHandler}. Will also be passed to commands when they run. */
        this.logger = logger;
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
        for(var folder of module_folders) { //Iterate all folders in modules directory
            if(folder.isDirectory() && fs.existsSync(modules_folder + "/" + folder.name + "/bot_module.json")) {
                var module_config = JSON.parse(fs.readFileSync(modules_folder + "/" + folder.name + "/bot_module.json")); //Load module config if found
                var the_module = {
                    config: module_config,
                    location: modules_folder + "/" + folder.name + "/"
                };

                if(the_module.config.enabled) {
                    this.modules.set(the_module.config.name, the_module); //Add module to this ModuleHandler
                } else {
                    this.disabled_modules.set(the_module.config.name, the_module);
                }
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

        for(var current_module_name of Array.from(this.modules.keys())) {
            var current_module = this.modules.get(current_module_name);
            current_module.commands = new Discord.Collection();

            var commands_dir = current_module.location + current_module.config.commands_directory + "/";

            this.logger.info("Discovering Commands in: " + commands_dir + " ...");
            var command_files = fs.readdirSync(commands_dir).filter(file => file.endsWith('.js'));

            for (var file of command_files) {
                var command = require(commands_dir + file);
                command.logger = this.logger;
                current_module.commands.set(command.name, command);
            }
        }

        if(this.modules.size > 0) {
            this.logger.info("Discovered " + this.modules.size + " active module(s) and " + this.disabled_modules.size + " inactive module(s):");
            for(var current_module_name of Array.from(this.modules.keys())) {
                this.logger.info("  + " + this.modules.get(current_module_name).config.display_name + " (" + this.modules.get(current_module_name).commands.size + " commands)");
            }

            for(var current_module_name of Array.from(this.disabled_modules.keys())) {
                this.logger.info("  - " + this.disabled_modules.get(current_module_name).config.display_name);
            }
        } else {
            this.logger.warn("No active modules found! Please enable at least one module for this bot to have any purpose!");
            this.logger.info("Discovered " + this.disabled_modules.size + " inactive modules:");
            for(var current_module_name of Array.from(this.disabled_modules.keys())) {
                this.logger.info("  - " + this.disabled_modules.get(current_module_name).config.display_name);
            }
        }
    }

    /**
     * This function is in charge of handling {@link Command} execution (discovering what command was called, and from which module, then executing the command)
     *
     * It will loop through all the {@link MessageHandler#modules} and check the registered {@link ModuleConfig#command_prefix}. If the registered prefix for the module
     * matches the beginning of the message, that module will be checked to see if it has a command with the {@link Command#name} of the command that was run. If a
     * command is found, this function will check the number of arguments provided to the command to see if it has at least that command's {@link Command#num_args}.
     * If so, its {@link Command#execute} function will be run.
     *
     * If the module that the command belongs to is registered as a core module, this ModuleHandler will be passed as a parameter to the execute()
     * function in 'extra.module_handler'. This allows core modules to access the internals of UsusBot.
     *
     * Additionally, if the message is of the format "//[module]:[command]", this function will ONLY check the provided {@link Module} for the {@link Command}
     * to run. This is helpful for commands from different modules that use the same name, because normally the bot would just pick the command from
     * the first module it finds to run.
     *
     * One more thing: every command will be passed an instance of APIClient() if {@link Command#needs_api} is true, which allows the commands an easy way to get
     * access to the API. For more information on how to structure a command file, look at one of the existing commands (I reccommend ping, since it's simple).
     * 
     * @param {external:Discord.Message} message - The {@link external:Discord.Message} passed to us by the discord.js event handler
     */
    async handle_command(message) {
        this.logger.info("Got command: " + message.content);
        var api = new APIClient();
        if(message.author.bot) return; //Ignore messages from bots

        var command_args = message.content.split(" ");

        var current_module;
        var current_command;

        //This block is for when the user runs the command in the form '//module:command'
        if(command_args[0].startsWith("//") && command_args[0].includes(":")) {
            var spec_module = command_args[0].substring(2, command_args[0].indexOf(":"));
            var spec_command = command_args[0].substring(command_args[0].indexOf(":") + 1);
            if(this.modules.has(spec_module)) { //Specified module exists
                current_module = this.modules.get(spec_module);
                var respModule = await api.get('module', {
                    name: current_module.config.name
                });

                if(respModule.modules.length == 0) { //Module exists in UsusBot, but not in database
                    message.channel.send("Sorry, the database does not contain a record of the module: " + spec_module);
                    return;
                }

                var respEnabled = await api.get('enabled_module', {
                    server_id: message.channel.guild.id,
                    module_id: parseInt(respModule.modules[0].module_id)
                });

                if(respEnabled.enabled_modules.length == 0) { //The module is not enabled for the server this message came from
                    message.channel.send("That module is disabled on this server!");
                    return;
                }

                if(current_module.commands.has(spec_command)) { //Command exists in this module
                    current_command = current_module.commands.get(spec_command);
                } else { //Command specified does not exist in the specified module
                    message.channel.send("The module '" + spec_module + "' has no command '" + spec_command + "'.");
                    return;
                }
            } else { //Specified module does not exist
                message.channel.send("Sorry, I couldn't find the module: " + spec_module);
                return;
            }
        } else { //This section runs when user uses form '/[command]' (the module will be found automatically)
            var found_command = false;
            var matched_prefix = false;

            for(var current_module_name of Array.from(this.modules.keys())) { //Iterate all modules
                current_module = this.modules.get(current_module_name);

                if(message.content.startsWith(current_module.config.command_prefix)) { //This module's command prefix matches the one used
                    matched_prefix = true;
                    var command_name = command_args[0].substring(current_module.config.command_prefix.length);

                    if(current_module.commands.has(command_name)) { //The current module has a command with the specified name
                        var respModule = await api.get('module', {
                            name: current_module.config.name
                        });

                        if(respModule.modules.length == 0) { //Module exists in UsusBot, but not in database
                            continue;
                        }

                        var respEnabled = await api.get('enabled_module', {
                            server_id: message.channel.guild.id,
                            module_id: parseInt(respModule.modules[0].module_id)
                        });

                        if(respEnabled.enabled_modules.length == 0) { //Module is not enabled on this server
                            continue;
                        }

                        found_command = true;
                        command_args[0] = command_name;
                        current_command = current_module.commands.get(command_args[0]);
                        break;
                    }
                }
            }

            if(matched_prefix && !found_command) {
                message.channel.send("Sorry, I couldn't find that command! Try ,commands or ,help for a list of all commands!");
                return;
            } else if(!matched_prefix) {
                return;
            }
        }

        if(command_args.length - 1 >= current_command.num_args) { //Command contains at least the required number of arguments
            if(current_command.args_to_lower) { //If set in command, make all arguments lowercase
                for(var i=0; i < command_args.length; i++) {
                    command_args[i] = command_args[i].toLowerCase();
                }
            }
            
            var extra = {}; //This will contain all of the extra variables that a command may need, based on its configuration

            if(current_module.config.is_core) { //If this module is a core module, it gains access to this ModuleHandler
                extra.module_handler = this;
            }

            if(current_command.has_state) { //If command uses state system, must grab the state
                var state = await this.state_manager.get_state(message.author.id, current_module.config.name + ":" + current_command.name);
                extra.state = state;
            }

            if(current_command.needs_api) { //If command needs to access the API, we pass it here
                extra.api = api;
            }

            await current_command.execute(message, command_args, extra); //NOTE: ALL command execute functions MUST be async!

            if(current_command.has_state) { //If this command used the state system, we must save any changes to the state
                this.state_manager.save_state(extra.state);
            }
        } else { //Not enough arguments provided
            this.invalid_syntax(current_module, command_args[0], message);
        }
    }

    /**
     * This function is called when a {@link Command} is run, but less than {@link Command#num_args} arguments are provided.
     *
     * @param {Module} current_module The {@link Module} this command belongs to
     * @param {string} command The {@link Command#name} of the command that was matched to the message
     * @param {external:Discord.Message} message The message the user sent containing this command
     */
    invalid_syntax(current_module, command, message) {
        var prefix = current_module.config.command_prefix;
        message.channel.send("Not enough arguments! Syntax: `" + prefix + current_module.commands.get(command).syntax + "`");
    }
}

module.exports = ModuleHandler;