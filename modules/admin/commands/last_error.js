module.exports = {
    name: 'crashreport',
    description: 'Returns the last error in the logs',
    syntax: 'crashreport',
    num_args: 0,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        //const log_wipe = spawn("find ~/ModBot/logs -mtime +1 -exec rm {} \;");
    }
};