const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    needs_api: false,
    has_state: false,
    data: new SlashCommandBuilder()
        .setName('crashreport')
        .setDescription('Returns the last error in the logs'),
    async execute(interaction, extra) {
        const fs = require('fs');
        const path = require('path');

        if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
            await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            return;
        }
        try {
            await interaction.deferReply();
            const logsDir = path.join(__dirname, '../../../logs');
            const files = fs.readdirSync(logsDir)
                .filter(file => file.endsWith('.log'))
                .map(file => ({ file, time: fs.statSync(path.join(logsDir, file)).mtime }))
                .sort((a, b) => b.time - a.time);

            if (files.length < 2) {
                await interaction.editReply({ content: 'Not enough log files to tail the second most recent one.' });
                return;
            }

            const secondLatestLogFile = path.join(logsDir, files[1].file);
            const logContent = fs.readFileSync(secondLatestLogFile, 'utf8');

            const filteredLines = logContent.split('\n').filter(line => !line.startsWith('{"level'));
            const output = filteredLines.join('\n');

            if (output.length === 0) {
                await interaction.editReply({ content: 'No relevant lines found in the log file.' });
            } else if (output.length > 2000) {
                await interaction.editReply({ content: 'The log output is too long to send in a single message. Please check the file directly.', files: [secondLatestLogFile] });
            } else {
                await interaction.editReply({ content: `\`\`\`${output}\`\`\``, files: [secondLatestLogFile] });
            }
        } catch (error) {
            this.logger.error('Error reading log file:', error);
            if(interaction.deferred) await interaction.editReply({ content: 'An error occurred while trying to read the log file.' });
            else await interaction.reply({ content: 'An error occurred while trying to read the log file.', ephemeral: true });
        }
    }
};