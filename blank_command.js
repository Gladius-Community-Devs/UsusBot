module.exports = {
    name: '[what word you type to activate this command]',
    description: '[what the command should do]',
    syntax: '[activation word] [any] [additional] [arguments]',
    num_args: 0,//minimum amount of arguments to accept
    args_to_lower: false,//if the arguments should be lower case
    needs_api: true,//if this command needs access to the api
    has_state: false,//if this command uses the state engine
    async execute(message, args, extra) {

    }
}

//Send a message with:
message.channel.send({ content: ""});

//Use This to send a message with more than 2000 characters(Create your string and then name it 'output'):
const messageChunks = Util.splitMessage(output, {
    maxLength: 2000,
    char:'\n'
});
messageChunks.forEach(async chunk => {
    await message.channel.send(chunk);
})



//<message>.reference.messageId - references a message if it is replied to
//Code to check if the user has admin perms.
if (!message.member.roles.cache.some(role => role.name === 'Admin')) {
    message.channel.send({ content: "You do not have permission to use this command." });
    return;
}