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
var LogHandler = require('./core/js/log_handler.js');
var ErrorReporter = require('./core/js/error_reporter.js');
var APIClient = require('./core/js/APIClient.js');

var logger = LogHandler.build_logger(__dirname + "/" + config.log_folder);

// One sink for operational failures: a structured log record plus deduplicated
// Discord alerts, so nothing fails silently outside the console again.
var reporter = new ErrorReporter({ logger });
APIClient.configure({ reporter });

var modules = new ModuleHandler(__dirname, logger, reporter);
modules.discover_modules(__dirname + "/" + config.modules_folder);
modules.discover_commands();

var event_registry = new EventRegistry(client, logger);
event_registry.discover_event_handlers(modules);

logger.info("Event Registration Complete!");

authClient();

// Discord renders a bot's presence as an app card: the bot's own name plus the
// APP badge on one line, and the activity's `name` verbatim below it. The
// "Watching"/"Playing" verb used to be added by the client and no longer is, so
// it has to be part of the name in ususbot.json. The type still decides the
// member-list entry, hence the lookup instead of the old hardcoded Watching.
function activity_type(value) {
    var wanted = String(value || '').toUpperCase();
    var key = Object.keys(ActivityType).find(function (name) {
        return name.toUpperCase() === wanted;
    });
    return key ? ActivityType[key] : ActivityType.Watching;
}

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
    client.user.setActivity(config.bot_activity.name, { type: activity_type(config.bot_activity.type) });
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
    if (message.author.bot) return;

    // The bot is guild-scoped, so a DM can only be someone looking for where it
    // lives: answer with the invite instead of crashing on the missing guild.
    if (!message.inGuild()) {
        const invite = config.guild_invite || 'https://discord.gg/wqMFnTWk4d';
        message.reply({ content: `I only work inside the Gladius server. Come say hi: ${invite}` }).catch(() => {});
        return;
    }

    // The retired `;command` form now just points at its slash command.
    modules.hint_legacy_prefix(message);
});

/**
 * Exit 0 on SIGINT/SIGTERM.
 *
 * systemd records a non-zero main-process exit as a failure even when it is
 * only the stop half of a restart, so every deploy fired OnFailure, paged
 * Discord twice and made the deploy webhook see a failed unit. Closing the
 * gateway first also lets discord.js tear down its connections instead of
 * being killed mid-frame.
 */
let shutting_down = false;
function shutdown(signal) {
    if (shutting_down) return;
    shutting_down = true;
    try {
        logger.info(`Received ${signal}; shutting down cleanly.`);
    } catch (error) {
        // The logger itself must never prevent a clean exit.
    }

    const finish = () => process.exit(0);
    // Backstop: hanging here would make systemd SIGKILL us and record a
    // failure again, which is the exact thing this handler exists to avoid.
    const deadline = setTimeout(finish, 5000);
    if (deadline.unref) deadline.unref();

    Promise.resolve()
        .then(() => client.destroy())
        .catch(() => {})
        .finally(() => {
            try {
                logger.end(finish);
            } catch (error) {
                finish();
            }
        });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));