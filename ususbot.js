/**
 * Entry point for the bot. Sets up the discord client,
 * loads all the internal systems, then discovers modules and commands.
 */

// Must run before any third-party require(): reconciles node_modules with
// package-lock.json so a pushed dependency change actually takes effect.
require('./tools/preflight.js').run();

var fs = require('fs');
var axios = require('axios');
var shell = require('shelljs');
require('dotenv/config')

const {Client, GatewayIntentBits, ActivityType} = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });
var config = JSON.parse(fs.readFileSync('ususbot.json'));

var ModuleHandler = require('./core/js/module_handler.js');
var EventRegistry = require('./core/js/event_registry.js');
var StateManager = require('./core/js/state_manager.js');
var LogHandler = require('./core/js/log_handler.js');
var ErrorReporter = require('./core/js/error_reporter.js');
var APIClient = require('./core/js/APIClient.js');

var logger = LogHandler.build_logger(__dirname + "/" + config.log_folder);

// One sink for operational failures: a structured log record plus deduplicated
// Discord alerts, so nothing fails silently outside the console again.
var reporter = new ErrorReporter({ logger });
APIClient.configure({ reporter });

var state_manager = new StateManager(logger);

var modules = new ModuleHandler(__dirname, state_manager, logger, reporter);
modules.discover_modules(__dirname + "/" + config.modules_folder);
modules.discover_commands();

var event_registry = new EventRegistry(client, logger);
event_registry.discover_event_handlers(modules);

logger.info("Event Registration Complete!");

authClient();

async function botInit () {
    shell.exec('/home/bots/clean_usus_logs.sh');
    logger.info("Logs older than 3 days have been cleaned");
    logger.info("I am ready!");

    // Register Slash Commands
    if (config.slash_command_guilds) {
        try {
            var token = fs.readFileSync(config.token_file).toString().replace(/\s+/g, '');
            await modules.register_slash_commands(token, client.user.id, config.slash_command_guilds);
            logger.info("Slash commands registered successfully.");
        } catch (error) {
            logger.error("Failed to register slash commands: " + error);
        }
    }

    var channel = await client.channels.fetch(config.default_channel);
    
    if(fs.existsSync("updated.txt")) {
        channel.send({ content: config.startup_messages.update});
        fs.unlinkSync("updated.txt");
    } else {
        channel.send({ content: config.startup_messages.restart});
    }
    client.user.setActivity(config.bot_activity.name, { type: ActivityType.Watching });
}

client.on('ready', () => {
    botInit().catch((error) => reporter.report(error, { command: 'ready' }));
});

function authClient() {
    var token;
    try {
        token = fs.readFileSync(config.token_file).toString();
        token = token.replace(/\s+/g, '');
    } catch (error) {
        logger.error(error);
    }

    client.login(token).catch((error) => reporter.report(error, { command: 'login' }));
}

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        await modules.handle_autocomplete(interaction);
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    await modules.handle_interaction(interaction);
});

client.on('messageCreate', (message) => {
   modules.handle_command(message);
});