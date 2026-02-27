/**
 * Entry point for the bot. Sets up the discord client,
 * loads all the internal systems, then discovers modules and commands.
 * CURRENTLY IN THE PRODUCTION BRANCH!
 */

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

var logger = LogHandler.build_logger(__dirname + "/" + config.log_folder);

var state_manager = new StateManager(logger);

var modules = new ModuleHandler(__dirname, state_manager, logger);
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

client.on('ready', botInit);

function authClient() {
    var token;
    try {
        token = fs.readFileSync(config.token_file).toString();
        token = token.replace(/\s+/g, '');
    } catch (error) {
        logger.error(error);
    }

    client.login(token);
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await modules.handle_interaction(interaction);
});

client.on('messageCreate', (message) => {
   modules.handle_command(message);
});