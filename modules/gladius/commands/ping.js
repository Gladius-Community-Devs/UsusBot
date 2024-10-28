module.exports = {
    name: 'ping',
    description: 'Sends a message back. Used to test if the bot is working.',
    syntax: 'ping [arbitrary argument for testing]',
    num_args: 0,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    execute(message, args, extra) {
      message.channel.send({ content: "Gladius Pong!"});
    }
};
