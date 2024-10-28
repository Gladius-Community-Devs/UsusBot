module.exports = {
    name: 'remove_role',
    description: 'Removes a specified role from a specified user',
    syntax: 'remove_role [@user] [role]',
    num_args: 2,
    args_to_lower: true,
    needs_api: true,
    has_state: false,
    async execute(message, args, extra) {
        var api = extra.api;
        var respAdminID = "";
        try{
            respAdminID = await api.get("discord_server",{
                server_id:message.guild.id
            });
        }catch(err){
            this.logger.error(err.message);
        }
        if(respAdminID.discord_servers[0]){
            if(respAdminID.discord_servers[0].admin_role_id === ""){
                message.channel.send({ content: "This command requires an admin role but no main admin role has been selected for this server."});
                return;
            }
            else if(!message.member.roles.cache.has(respAdminID.discord_servers[0].admin_role_id)){
                message.channel.send({ content: "You do not have permission to use this command."});
                return;
            }
        }else{
            message.channel.send({ content: "This command requires an admin role but no main admin role has been selected for this server."});
            return;
        }
        const Discord = require('discord.js');
        var strLength = 0;
		var messageString = "";
		var role = "";
		var counter = 0;
        var member = message.mentions.members.first();
		for(let i=2;i<args.length;i++){
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
        try{
            role = message.guild.roles.cache.find(role => role.name.toLowerCase() === messageString.trim());
            member.roles.remove(role.id);
        }
        catch(err){
            this.logger.error(err.message);
            message.channel.send({ content: "Role removing failed!"});
            return;
        }
        const ListEmbed = new Discord.MessageEmbed()
        .setTitle(`Made this edit to ${member.user.username}:`)
        .setDescription("Removed role: "+role.name);
        message.channel.send({ embeds: [ListEmbed]});
    }
}