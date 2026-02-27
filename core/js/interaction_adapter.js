/**
 * Adapts a Discord.js ChatInputCommandInteraction to a message-like interface,
 * so existing command execute(message, args, extra) functions can work with
 * slash commands with minimal changes to command files.
 *
 * Key mappings:
 *   message.author          → interaction.user
 *   message.member          → interaction.member
 *   message.guild           → interaction.guild
 *   message.channel.id      → interaction.channelId
 *   message.channel.send()  → interaction.reply() / interaction.followUp()
 *   message.reply()         → interaction.reply() / interaction.followUp()
 *   message.delete()        → no-op (slash interactions cannot be deleted)
 *   message.mentions.users.first()   → first USER option user
 *   message.mentions.members.first() → first USER option member
 */
class InteractionAdapter {

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     * @param {import('winston').Logger} logger
     */
    constructor(interaction, logger) {
        this._interaction = interaction;
        this._logger = logger;
        this._replied = false;

        /** @type {import('discord.js').User} message.author equivalent */
        this.author = interaction.user;

        /** @type {import('discord.js').GuildMember} message.member equivalent */
        this.member = interaction.member;

        /** @type {import('discord.js').Guild} message.guild equivalent */
        this.guild = interaction.guild;
        
        this.content = interaction.commandName; // Rough approximation

        // ── message.channel proxy ───────────────────────────────────────────
        const self = this;
        this.channel = {
            id: interaction.channelId,
            guild: interaction.guild,
            /** message.channel.send() proxy */
            send: async (payload) => self.reply(payload),
        };

        // ── message.attachments stub ────────────────────────────────────────
        // Slash commands cannot carry file attachments in the legacy sense.
        // Commands that require message.attachments must be migrated to use
        // an ATTACHMENT option type (addAttachmentOption) and interaction.options.getAttachment().
        this.attachments = {
            size: 0,
            first: () => null,
        };

        // ── message.mentions proxy ──────────────────────────────────────────
        // Attempt to grab the first mentioned user from options if any
        const users = [];
        const members = [];
        
        if (interaction.options && interaction.options.data) {
             for(const opt of interaction.options.data) {
                 if (opt.user) users.push(opt.user);
                 if (opt.member) members.push(opt.member);
             }
        }
        
        this.mentions = {
            users: {
                get size() { return users.length; },
                first: () => users[0] || null,
                has: (id) => users.some(u => u.id === id),
            },
            members: {
                get size() { return members.length; },
                first: () => members[0] || null,
                has: (id) => members.some(m => m.id === id),
            },
        };
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    /**
     * Sends a response via the interaction. Uses reply() if the interaction has
     * not yet been replied to; otherwise uses followUp() so that multiple sends
     * from a single command all reach the user.
     * @param {string|Object} payload
     */
    async _respond(payload) {
         // Handle simple string payloads which discord.js message.reply supports but send/reply options format is usually object
        if (typeof payload === 'string') {
            payload = { content: payload };
        }
        
        try {
            if (this._interaction.replied || this._replied) {
                // Already sent a real reply — send additional messages as follow-ups
                return await this._interaction.followUp(payload);
            } else if (this._interaction.deferred) {
                // Deferred but not yet replied — editReply replaces the "thinking…" indicator
                this._replied = true;
                return await this._interaction.editReply(payload);
            } else {
                this._replied = true;
                return await this._interaction.reply(payload);
            }
        } catch (err) {
            if (this._logger) {
                this._logger.error(`[InteractionAdapter] _respond error: ${err.message}`);
            }
            // Best-effort fallback
            try {
                return await this._interaction.followUp(payload);
            } catch (_) { /* silently ignore */ }
        }
    }

    // ── Public message-like API ─────────────────────────────────────────────

    /**
     * message.reply() equivalent.
     * @param {string|Object} payload
     */
    async reply(payload) {
        return this._respond(payload);
    }

    /**
     * message.delete() equivalent – no-op for slash commands.
     * Slash command interactions cannot be deleted via this method.
     */
    async delete() {
        // No-op: slash command interactions are not deletable the same way.
    }

    /**
     * Defer the reply for long-running commands. Keeps the interaction alive.
     * @param {Object} [options]
     */
    async deferReply(options = {}) {
        return this._interaction.deferReply(options);
    }
}

module.exports = InteractionAdapter;
