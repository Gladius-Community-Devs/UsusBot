'use strict';

/**
 * Helpers for staying inside Discord's message and embed limits without
 * throwing away content.
 *
 * Discord rejects a message (or an entire command) when a single field value
 * passes 1024 characters, a description passes 4096, an embed carries more
 * than 25 fields, or the embeds in one message total more than 6000
 * characters. The previous code assumed none of that: a long skill definition
 * or a busy search result produced "an error occurred" instead of an answer.
 *
 * The rule here is to split rather than truncate: an oversized field becomes
 * numbered fields, an oversized description spills into continuation fields,
 * and a long list of embeds is sent as several messages.
 */

/** @see https://discord.com/developers/docs/resources/message */
const LIMITS = Object.freeze({
    message: 2000,
    title: 256,
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    fields: 25,
    embedsPerMessage: 10,
    embedsTotal: 5800, // 6000 is the hard cap; leave room for the content string
});

/**
 * Safe length for a code-fenced value: the fences and newlines consume 8 chars.
 * @param {number} max - The field limit.
 * @returns {number} The usable length inside the fence.
 */
function fencedBudget(max) {
    return Math.max(1, max - 8);
}

/**
 * Cut text to `max` characters, appending an ellipsis when it had to shorten.
 * Used only for values that cannot be split further.
 * @param {*} text - The text to clip.
 * @param {number} max - Maximum length.
 * @returns {string} The clipped text.
 */
function clip(text, max) {
    const value = String(text ?? '');
    if (value.length <= max) return value;
    return value.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * Split text into chunks of at most `maxLength`, preferring line boundaries.
 *
 * Ported from the sibling ModBot project so both bots behave identically. A
 * single line longer than the limit is hard-split rather than dropped.
 *
 * @param {*} input - Text to split.
 * @param {Object} [options]
 * @param {number} [options.maxLength=2000] - Maximum chunk length.
 * @param {string} [options.char='\n'] - Preferred split delimiter.
 * @returns {string[]} One or more chunks, never empty.
 */
function splitMessage(input, options = {}) {
    const maxLength = options.maxLength || LIMITS.message;
    const delimiter = options.char === undefined ? '\n' : options.char;
    let remaining = String(input ?? '');

    if (remaining.length <= maxLength) return [remaining];

    const chunks = [];
    while (remaining.length > maxLength) {
        let splitAt = delimiter ? remaining.lastIndexOf(delimiter, maxLength) : -1;
        if (splitAt <= 0) splitAt = maxLength;

        const chunk = remaining.slice(0, splitAt).trimEnd();
        if (chunk.length > 0) chunks.push(chunk);

        remaining = remaining.slice(splitAt);
        if (delimiter && remaining.startsWith(delimiter)) remaining = remaining.slice(delimiter.length);
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks.length > 0 ? chunks : [''];
}

/**
 * Split one embed field's value into as many fields as it needs, numbering
 * them ("Skill Definition (1/3)") so nothing is lost and the order is obvious.
 *
 * @param {*} text - The value to place in the field(s).
 * @param {Object} [options]
 * @param {number} [options.max=1024] - Per-field limit.
 * @param {string} [options.label=''] - Field name; numbered when there are several.
 * @param {boolean} [options.codeBlock=false] - Wrap each piece in ``` fences.
 * @returns {{name: string, value: string}[]} One entry per resulting field.
 */
function splitFieldValue(text, options = {}) {
    const max = options.max || LIMITS.fieldValue;
    const label = options.label || '';
    const budget = options.codeBlock ? fencedBudget(max) : max;

    const pieces = splitMessage(text, { maxLength: budget });
    const total = pieces.length;

    return pieces.map((piece, index) => {
        const name = total > 1 ? clip(`${label} (${index + 1}/${total})`, LIMITS.fieldName) : clip(label, LIMITS.fieldName);
        const body = options.codeBlock ? `\`\`\`\n${piece}\n\`\`\`` : piece;
        return { name: name || '\u200b', value: clip(body, max) };
    });
}

/**
 * Append fields while honouring Discord's per-embed field count and per-field
 * length limits, instead of letting `addFields` throw mid-render.
 *
 * Values longer than the limit are clipped here; callers that care about the
 * full text should pass {@link splitFieldValue} entries first.
 *
 * @param {import('discord.js').EmbedBuilder} embed - Embed being built.
 * @param {{name?: string, value?: string, inline?: boolean}[]} fields - Fields to append.
 * @param {Object} [options]
 * @param {number} [options.max=25] - How many fields may be appended.
 * @returns {number} How many fields were dropped for lack of room.
 */
function addFieldsSafe(embed, fields, options = {}) {
    const max = options.max || LIMITS.fields;
    let added = 0;
    let dropped = 0;

    for (const field of fields) {
        if (added >= max) {
            dropped++;
            continue;
        }
        embed.addFields({
            name: clip(field.name ?? '\u200b', LIMITS.fieldName) || '\u200b',
            value: clip(field.value ?? '\u200b', LIMITS.fieldValue) || '\u200b',
            inline: field.inline,
        });
        added++;
    }

    return dropped;
}

/**
 * Set an embed description that may exceed 4096 characters, spilling the
 * remainder into continuation fields.
 *
 * @param {import('discord.js').EmbedBuilder} embed - Embed being built.
 * @param {*} text - The description.
 * @param {Object} [options]
 * @param {string} [options.label='Continued'] - Name for the overflow field(s).
 * @returns {import('discord.js').EmbedBuilder} The same embed, for chaining.
 */
function applyDescription(embed, text, options = {}) {
    const body = String(text ?? '');
    const [first, ...rest] = splitMessage(body, { maxLength: LIMITS.description });

    embed.setDescription(first || '\u200b');
    if (rest.length > 0) {
        addFieldsSafe(embed, splitFieldValue(rest.join('\n'), { label: options.label || 'Continued' }));
    }
    return embed;
}

/**
 * Approximate the character weight Discord counts for one embed.
 * @param {import('discord.js').EmbedBuilder|Object} embed - An embed or its JSON.
 * @returns {number} Total characters counted against the per-message limit.
 */
function embedLength(embed) {
    let json = embed;
    try {
        if (embed && typeof embed.toJSON === 'function') json = embed.toJSON();
    } catch (_) {
        /* fall back to the raw object */
    }
    if (!json || typeof json !== 'object') return 0;

    let total = 0;
    if (json.title) total += String(json.title).length;
    if (json.description) total += String(json.description).length;
    if (json.footer && json.footer.text) total += String(json.footer.text).length;
    if (json.author && json.author.name) total += String(json.author.name).length;
    for (const field of json.fields || []) {
        total += String(field.name || '').length + String(field.value || '').length;
    }
    return total;
}

/**
 * Group embeds into batches that fit Discord's per-message totals, so a list
 * of results can be delivered as several messages instead of being rejected.
 *
 * @param {(import('discord.js').EmbedBuilder|Object)[]} embeds - Embeds to send.
 * @param {Object} [options]
 * @param {number} [options.totalLimit] - Character budget per message.
 * @param {number} [options.maxPerMessage] - Embed count per message.
 * @returns {Array<Array<import('discord.js').EmbedBuilder|Object>>} Batches, at least one.
 */
function batchEmbeds(embeds, options = {}) {
    const totalLimit = options.totalLimit || LIMITS.embedsTotal;
    const maxPerMessage = options.maxPerMessage || LIMITS.embedsPerMessage;

    const batches = [];
    let current = [];
    let length = 0;

    for (const embed of embeds || []) {
        const size = embedLength(embed);
        const wouldOverflow = current.length > 0 && length + size > totalLimit;
        if (current.length >= maxPerMessage || wouldOverflow) {
            batches.push(current);
            current = [];
            length = 0;
        }
        current.push(embed);
        length += size;
    }

    if (current.length > 0) batches.push(current);
    return batches.length > 0 ? batches : [[]];
}

module.exports = {
    LIMITS,
    clip,
    splitMessage,
    splitFieldValue,
    addFieldsSafe,
    applyDescription,
    embedLength,
    batchEmbeds,
};
