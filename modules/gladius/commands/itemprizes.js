'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const helpers = require('../functions');
const siteLinks = require('../site_links');
const { buildPrizeIndex, tierName } = require('../prize_index');

function formatBuckets(buckets) {
    return buckets.map(({ bucket, tiers }) => {
        const labels = tiers.map(tierName).join(', ');
        return bucket === 'Tier' ? labels : `${bucket}: ${labels}`;
    }).join(' · ');
}

function formatSource(source) {
    const icon = source.type === 'League' ? '🏛️' : '⚔️';
    return `${icon} **${source.name}** (${source.type})\n${formatBuckets(source.buckets)}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('itemprizes')
        .setDescription('Finds leagues and encounters that award an item')
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod to search in (Vanilla = base game)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('item_name')
                .setDescription('Item to find prize sources for')
                .setRequired(true)
                .setAutocomplete(true)),
    name: 'itemprizes',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value.toLowerCase();

        if (focusedOption.name === 'mod_name') {
            const choices = helpers.getAvailableMods();
            const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
            return;
        }

        if (focusedOption.name === 'item_name') {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            try {
                const modName = helpers.resolveModName(rawMod);
                const index = buildPrizeIndex(modName);
                const filtered = index.itemNames
                    .filter(name => name.toLowerCase().includes(focused))
                    .slice(0, 25);
                await interaction.respond(filtered.map(name => ({ name, value: name })));
            } catch (error) {
                this.logger.error(`Failed to load itemprizes autocomplete data:`, error);
                await interaction.respond([]);
            }
        }
    },
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawMod = interaction.options.getString('mod_name') || 'Vanilla';
            const query = (interaction.options.getString('item_name') || '').trim();
            const modName = helpers.resolveModName(rawMod);
            if (!query) {
                await interaction.editReply({ content: 'Please provide an item name.' });
                return;
            }

            const index = buildPrizeIndex(modName);
            const result = index.getSources(query);
            if (!result || !result.sources.length) {
                await interaction.editReply({
                    content: `No prize sources found for '${query}' in '${modName}'. That item may not be in a league or encounter prize pool.`
                });
                return;
            }

            const itemLabel = result.item.rawName || result.item.displayName;
            const byArena = new Map();
            for (const source of result.sources) {
                const arena = source.arena || 'Unknown arena';
                if (!byArena.has(arena)) byArena.set(arena, []);
                byArena.get(arena).push(source);
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆 Item Prize Sources')
                .setDescription(`Where **${itemLabel}** can be won in **${modName}**\n\n🔗 [Open in the Prize Browser](${siteLinks.itemPrizeUrl(modName, itemLabel)})`)
                .setColor(0x00AE86)
                .setTimestamp();

            let fieldCount = 0;
            let omittedFields = 0;
            for (const [arena, sources] of byArena) {
                if (fieldCount >= 25) {
                    omittedFields++;
                    continue;
                }
                let value = sources.map(formatSource).join('\n\n');
                if (value.length > 1024) value = `${value.slice(0, 1018)}…`;
                embed.addFields({
                    name: `🏟️ ${arena}`,
                    value,
                    inline: false
                });
                fieldCount++;
            }

            if (omittedFields > 0) {
                embed.setFooter({ text: `Showing 25 of ${byArena.size} arenas. Refine the item name for a smaller result.` });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            this.logger.error('Error finding item prize sources:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding prize sources.' });
            else await interaction.reply({ content: 'An error occurred while finding prize sources.', ephemeral: true });
        }
    }
};
