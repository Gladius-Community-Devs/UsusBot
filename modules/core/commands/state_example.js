module.exports = {
  name: 'state_example',
  description: 'An example command using the saved state system',
  syntax: 'state_example [parameter]', //Brackets mean the parameter is optional. In the case of this example, the arguments required will vary
  num_args: 0,
  args_to_lower: false, //Disabled to preserve capitalization of user input. This is not required.
  needs_api: false, //Disabled because this command doesn't call the API
  has_state: true, //This is what tells the system that we want to use the state system
  async execute(message, args, extra) {
    if (!message.member.roles.cache.some(role => role.name === 'Admin')) {
      message.channel.send({ content: "You do not have permission to use this command." });
      return;
  }
    if(!extra.hasOwnProperty("state")) return;
    var state = extra.state;

    if(!state.data.has("name")) {
      if(args.length == 2) {
        state.add_data("name", "STRING", args[1]);
        message.channel.send({ content: "Okay, " + state.data.get("name").data + ". I'll remember your name until this state times out!"});
      } else{
        message.channel.send({ content: "Hi there! My name is UsusBot! What's yours? (run /state_example <your_name>)"});
      }
    } else {
      message.channel.send({ content: "Hello again, " + state.data.get("name").data.toString()});
    }
  }
};