module.exports = {
    name: 'get_unix',
    description: 'Returns given time in unix time. Time should be in YYYY-MM-DD HH:MM:SS time stamp',
    syntax: 'get_unix ["date time string"]',
    num_args: 0,//minimum amount of arguments to accept
    args_to_lower: false,//if the arguments should be lower case
    needs_api: true,//if this command needs access to the api
    has_state: false,//if this command uses the state engine
    async execute(message, args, extra) {
        if(!args[1] || !args[2]){
            message.channel.send({ content: "Please enter a datetime stamp for this command!\nYYYY-MM-DD HH:MM:SS time stamp"});
            return
        }
        var dateTime = args[1] + " " + args[2];
        var unixTimeStamp = Math.floor(new Date(dateTime).getTime()/1000);
        message.channel.send({ content: "Here is the unix timestamp: " + unixTimeStamp.toString() + "\nHere is a countdown timer: ```<t:" + unixTimeStamp.toString() + ":R>```" });
    }
}