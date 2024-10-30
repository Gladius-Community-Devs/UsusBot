module.exports = {
    name: 'crashreport',
    description: 'Returns the last error in the logs',
    syntax: 'crashreport',
    num_args: 0,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        if (!message.member.roles.cache.some(role => role.name === 'Admin')) {
            message.channel.send({ content: "You do not have permission to use this command." });
            return;
        }
        try {
            const logsDir = path.join(__dirname, '../../logs');
            const files = fs.readdirSync(logsDir)
                .filter(file => file.endsWith('.log'))
                .map(file => ({ file, time: fs.statSync(path.join(logsDir, file)).mtime }))
                .sort((a, b) => b.time - a.time);

            if (files.length < 2) {
                message.channel.send({ content: 'Not enough log files to tail the second most recent one.' });
                return;
            }

            const secondLatestLogFile = path.join(logsDir, files[1].file);
            const logContent = fs.readFileSync(secondLatestLogFile, 'utf8');

            const filteredLines = logContent.split('\n').filter(line => !line.startsWith('level'));
            const output = filteredLines.join('\n');

            if (output.length === 0) {
                message.channel.send({ content: 'No relevant lines found in the log file.' });
            } else if (output.length > 2000) {
                message.channel.send({ content: 'The log output is too long to send in a single message. Please check the file directly.' });
            } else {
                message.channel.send({ content: `\`\`\`${output}\`\`\`` });
            }

            // Attach the log file
            await message.channel.send({ files: [secondLatestLogFile] });
        } catch (error) {
            this.logger.error('Error reading log file:', error);
            message.channel.send({ content: 'An error occurred while trying to read the log file.' });
        }
    }
};