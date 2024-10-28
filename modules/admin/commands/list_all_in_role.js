module.exports = {
    name: 'list_role',
    description: 'Used to display all users who have the identified role',
    syntax: 'list_role [role]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        const Discord = require('discord.js');
        role = message.guild.roles.cache.find(role => role.name.toLowerCase().trim() === args[1]);
		if(args[1] == "everyone") return message.reply("I don't like listing everyone, sorry!");
		var strLength = 0;
		var messageString = "";
		var role = "";
		var counter = 0;
		for(let i=1;i<args.length;i++){
			//Manages current string length of arguments combined
			strLength += args[i].length;
			messageString += args[i];
			//Check to see if a role exists using that begins with the collective messageString
			role = message.guild.roles.cache.find(role => role.name.toLowerCase().includes(messageString));
			if(!role){
				//If role not found then return to string from previous iteration
				messageString = messageString.substring(0, strLength - args[i].length - 1);
				break;
			}
			//Add space
			messageString += " ";
			strLength ++;
		counter++;
		}
		role = message.guild.roles.cache.find(role => role.name.toLowerCase() === messageString.trim());
		if (!role) return message.reply("There is not such a role!");
		for(let j = counter; j>=0; j--){
			args.shift();
		}
		const ListEmbed = new Discord.MessageEmbed()
		.setTitle('Users with the '+role.name+' role:')
		.setDescription(message.guild.roles.cache.get(role.id).members.map(m=>m.user.username)+"\n");
		message.channel.send({embeds: [ListEmbed]}); 
    }
};
