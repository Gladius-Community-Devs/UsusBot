'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_MAX_NOTIFY_PER_HOUR = 12;
const NOTIFY_BIN = '/usr/local/bin/dsh-notify';

/**
 * Single sink for operational failures: everything that goes wrong out of
 * sight (API calls, background work) is logged in a structured form and,
 * when it is new or severe enough, pushed to Discord.
 *
 * Why a reporter instead of plain logging: a Discord-mediated failure is
 * invisible unless someone reads the log file, and a raw `console.error`
 * never reaches the log at all. Every failure now produces one structured
 * log record plus at most a trickle of Discord messages, regardless of how
 * many times it repeats.
 *
 * The sink is injected, so the same class works for another bot: pass
 * `notify` as a function that posts to a channel, or `false` for log-only.
 */
class ErrorReporter {
    /**
     * @param {Object} options
     * @param {import('winston').Logger} options.logger - Logger used for the canonical record.
     * @param {(boolean|Function)} [options.notify=true] - `true` for {@link dsh-notify},
     *   `false` to disable Discord alerts, or `(subject, body) => Promise|void`.
     * @param {number} [options.cooldownMs] - Per-signature suppression window.
     * @param {number} [options.maxNotifyPerHour] - Hard cap across all signatures.
     */
    constructor({ logger, notify = true, cooldownMs = DEFAULT_COOLDOWN_MS, maxNotifyPerHour = DEFAULT_MAX_NOTIFY_PER_HOUR } = {}) {
        this.logger = logger;
        this.notify = notify;
        this.cooldownMs = cooldownMs;
        this.maxNotifyPerHour = maxNotifyPerHour;
        /** @type {Map<string, number>} signature -> last notification timestamp */
        this.recent = new Map();
        /** @type {number[]} timestamps of notifications sent in the last hour */
        this.sent = [];
    }

    /**
     * Record a failure. Always logs; may also alert Discord. Never throws.
     *
     * @param {*} error - The failure (usually an Error or ApiError).
     * @param {Object} [context] - Who/where it happened.
     * @param {string} [context.command] - Command being executed.
     * @param {string} [context.user] - Discord user id.
     * @param {string} [context.guild] - Discord guild id.
     * @param {string} [context.correlationId] - Ties related calls together.
     * @param {Object} [context.extra] - Any additional structured fields.
     * @returns {void}
     */
    report(error, context = {}) {
        const fields = this._describe(error, context);
        try {
            this.logger.log({ level: 'error', ...fields });
        } catch (_) {
            // A logger failure must not become a second failure.
        }

        if (error && typeof error === 'object' && error.reported === false) {
            error.reported = true;
        }

        this._alert(fields);
    }

    /**
     * Record something noteworthy that does not warrant a Discord alert.
     * @param {string} message - Human-readable description.
     * @param {Object} [context] - Additional structured fields.
     * @returns {void}
     */
    warn(message, context = {}) {
        try {
            this.logger.log({ level: 'warn', message, ...context });
        } catch (_) {
            /* ignore */
        }
    }

    /**
     * Flatten an error plus its context into the structured log record and the
     * alert text. Kept separate so both stay consistent.
     * @param {*} error - The failure.
     * @param {Object} context - Call-site context.
     * @returns {Object} fields
     */
    _describe(error, context) {
        const isObject = error && typeof error === 'object';
        const message = isObject ? (error.message || String(error)) : String(error);
        return {
            message,
            error_name: isObject ? (error.name || 'Error') : 'Error',
            status: isObject ? (error.status ?? null) : null,
            resource: isObject ? (error.resource ?? null) : null,
            api_code: isObject ? (error.code ?? null) : null,
            duration_ms: isObject ? (error.durationMs ?? null) : null,
            response_body: isObject ? (error.body ?? null) : null,
            command: context.command ?? null,
            user: context.user ?? null,
            guild: context.guild ?? null,
            correlation_id: context.correlationId ?? (isObject ? (error.correlationId ?? null) : null),
            signature: typeof error?.signature === 'string' ? error.signature : `${error?.name || 'Error'}:${message.slice(0, 80)}`,
            stack: isObject ? error.stack : undefined,
            ...(context.extra || {}),
        };
    }

    /**
     * Decide whether this failure is worth a Discord message, then send it.
     * @param {Object} fields - The record built by {@link _describe}.
     * @returns {void}
     */
    _alert(fields) {
        if (this.notify === false || this.notify === null) return;

        const signature = fields.signature;
        const now = Date.now();
        const last = this.recent.get(signature);
        if (last !== undefined && now - last < this.cooldownMs) return;

        this.sent = this.sent.filter((stamp) => now - stamp < 60 * 60 * 1000);
        if (this.sent.length >= this.maxNotifyPerHour) {
            try {
                this.logger.log({
                    level: 'warn',
                    message: 'Discord alert suppressed: hourly cap reached',
                    suppressed_signature: signature,
                });
            } catch (_) { /* ignore */ }
            return;
        }

        this.recent.set(signature, now);
        this.sent.push(now);

        const subject = `ususbot ${fields.status ? `api ${fields.status}` : fields.error_name}`
            + (fields.command ? ` /${fields.command}` : '');
        const lines = [fields.message];
        if (fields.resource) lines.push(`resource: ${fields.resource}`);
        if (fields.command) lines.push(`command: /${fields.command}`);
        if (fields.user) lines.push(`user: ${fields.user}`);
        if (fields.guild) lines.push(`guild: ${fields.guild}`);
        if (fields.correlation_id) lines.push(`correlation: ${fields.correlation_id}`);
        if (fields.response_body) lines.push(`response: ${fields.response_body}`);
        this._send(subject, lines.join('\n'));
    }

    /**
     * Deliver the alert through whichever sink was configured. Best-effort:
     * a notification failure is logged and dropped, never rethrown.
     * @param {string} subject - Short title.
     * @param {string} body - Detail text.
     * @returns {void}
     */
    _send(subject, body) {
        if (typeof this.notify === 'function') {
            try {
                Promise.resolve(this.notify(subject, body)).catch((error) => {
                    try {
                        this.logger.log({ level: 'warn', message: `alert sink failed: ${error?.message || error}` });
                    } catch (_) { /* ignore */ }
                });
            } catch (error) {
                /* a throwing sink is a bug, not a crash */
            }
            return;
        }

        if (process.platform === 'win32' || !fs.existsSync(NOTIFY_BIN)) return;
        try {
            const child = spawn(NOTIFY_BIN, ['error', subject, body], { stdio: 'ignore' });
            child.on('error', () => { /* best-effort */ });
        } catch (_) {
            /* best-effort */
        }
    }
}

module.exports = ErrorReporter;
