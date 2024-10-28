var fs = require('fs');

class MessageHelper {
    constructor(message, path) {
        this.message = message;
        this.path = path;
    }

    split_embed(embed_in, desc_in) {
        var config = JSON.parse(fs.readFileSync(this.path + '/modbot.json'));

        var descriptions = [];
        var text = desc_in;
        var lines = text.split("\n");
        var current_desc = "";
        for(var line of lines) {
            if(current_desc.length + line.length + 1 <= config.max_embed_desc_length) {
                current_desc += line + "\n";
            } else if(current_desc.length <= 0) {
                descriptions.push(current_desc);
                current_desc = "";
            }
        }

        if(current_desc.length > 0) {
            descriptions.push(current_desc);
        }

        var embeds = [];
        for(var description of descriptions) {
            var new_embed = JSON.parse(JSON.stringify(embed_in));
            new_embed.setDescription(description);
            embeds.push(new_embed);
        }

        return embeds;
    }
}

module.exports = MessageHelper;