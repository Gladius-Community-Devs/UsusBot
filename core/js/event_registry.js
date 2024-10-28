/**
 * This class is in charge of discovering event handlers for each module and registering these handlers at the appropriate time.
 * In order to set up your module's event handlers properly, you should set your config's "event_handler" parameter to the relative
 * location of the javascript file containing your event handlers.
 *
 * Your javascript file should only have one function in its module.exports. This function should take a single parameter, which is
 * an instance of this class. In this function, you should make one call to EventRegistry::register for each of your event handler
 * functions.
 */
class EventRegistry {
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
    }

    /**
     * Automatically checks each module's config for the "event_handler" parameter. This value can be either a string giving a
     * file location relative to the config file, or it can be false if the module does not have an event handler. If the
     * event handler is found, we will call whatever function is inside it's module.export, passing this as a parameter.
     *
     * The function that is called is where all of your calls to EventRegistry::register should be, so that the event handlers
     * will be properly registered.
     */
    discover_event_handlers(mod_handler) {
        for(var current_module_name of Array.from(mod_handler.modules.keys())) {
            var current_module = mod_handler.modules.get(current_module_name);
            if(current_module.config.event_handler) {
                this.logger.info("Registering Event Handlers for module: " + current_module_name);
                var handler_init = require(current_module.location + current_module.config.event_handler);
                handler_init(this);
            }
        }
    }

    /**
     * Simple utility function that registers an event handler function to the given event.
     */
    register(eventName, handler) {
        this.client.on(eventName, handler);
    }
}

module.exports = EventRegistry;
