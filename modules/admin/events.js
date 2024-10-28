var ApiClient = require("../../core/js/APIClient.js");
var api = new ApiClient();
const Discord = require('discord.js');
var logger;


function register_handlers(event_registry) {
    logger = event_registry.logger;
}

module.exports = register_handlers;
