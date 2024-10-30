module.exports = {
    name: 'hello',
    description: 'Say hi to Usus! Used to test if the bot is working.',
    syntax: 'ping [arbitrary argument for testing]',
    num_args: 0,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    execute(message, args, extra) {
      message.channel.send({ content: "Hello there! Ready to participate in the games?"});
    }
};
