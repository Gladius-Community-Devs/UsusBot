var Discord = require('discord.js');
var APIClient = require('./APIClient.js');
var moment = require('moment');

class StateManager {
    constructor(logger) {
        this.api = new APIClient();
        this.logger = logger;
    }

    parse_data(data) {
        switch(data.data_type) {
            case 'STRING':
                return data.data;
            case 'INT':
            case 'DOUBLE':
                return Number(data.data);
            case 'BOOLEAN':
                return Boolean(data.data);
        }
    }

    /**
     * Attempts to find a state with matching user_id and command_run.
     *
     * If a matching state is not found, a new one will be created and returned.
     *
     * @param String user_id - The discord ID of the user selected
     * @param String command_run - The command that this record is linked to. Of the form 'module:command_name'.
     */
    async get_state(user_id, command_run) {
        var respGet;

        try {
            var respGet = await this.api.get('command_state', {
                user_id: user_id,
                command_run: command_run,
                _filter: "expiration after \"" + moment().format('YYYY-MM-DD HH:mm:ss') + "\""
            });
        } catch (error) {
            this.logger.error(error);
        }

        if(respGet.hasOwnProperty("command_states") && respGet.command_states.length > 0) {
            this.logger.info("State Data Grabbed:", respGet);

            var the_state = respGet.command_states[0];

            the_state.state_id = parseInt(the_state.state_id);

            var respUpdate = await this.api.put('command_state', {
                state_id: respGet.command_states[0].state_id,
                expiration: moment().add(10, 'minutes').format('YYYY-MM-DD HH:mm:ss')
            });

            the_state.add_data = function(data_name, data_type, data) {
                var dataObj = {
                    data_name: data_name,
                    data_type: data_type,
                    data: data
                };

                this.data.set(data_name, dataObj);
            };

            var respData = await this.api.get('state_data', {
                state_id: the_state.state_id,
                _limit: 100
            });

            the_state.data = new Discord.Collection();

            if(respData.hasOwnProperty("state_data") && respData.state_data.length > 0) {
                for(var data of respData.state_data) {
                    var data_parsed = this.parse_data(data);
                    data.data = data_parsed;
                    data.data_id = parseInt(data.data_id);
                    the_state.data.set(data.data_name, data);
                }
            }

            return the_state;
        } else {
            var respPost = await this.api.post('command_state', {
                user_id: user_id,
                command_run: command_run,
                expiration: moment().add(10, 'minutes').format('YYYY-MM-DD HH:mm:ss')
            });

            this.logger.info({ message: "Post after state creation", post_response: respPost, some_data: "Here is some test data" });

            if(respPost.hasOwnProperty("command_state")) {
                this.logger.info("Created State: " + respPost.command_state);
                var the_state = respPost.command_state;

                the_state.state_id = parseInt(the_state.state_id);

                the_state.add_data = function(data_name, data_type, data) {
                    var dataObj = {
                        data_name: data_name,
                        data_type: data_type,
                        data: data
                    };
    
                    this.data.set(data_name, dataObj);
                };

                the_state.data = new Discord.Collection();
                return the_state;
            } else {
                this.logger.error("[CRITICAL] Unable to create new command state!");
                return null;
            }
        }
    }

    async save_state(state) {
        if(state.hasOwnProperty("delete") && state.delete === true) {
            this.delete_state(state);
            return;
        }

        var respGet = await this.api.get('command_state', {
            state_id: state.state_id
        });

        if(respGet.hasOwnProperty("command_states") && respGet.command_states.length <= 0) {
            this.logger.warn("You attempted to save a state that does not exist! Please ensure you are grabbing states through StateFactory::get_state() to ensure they are properly registered!");
        }

        var respUpdate = await this.api.put('command_state', {
            state_id: state.state_id,
            expiration: moment().add(10, 'minutes').format('YYYY-MM-DD HH:mm:ss')
        });

        var respData = await this.api.get('state_data', {
            state_id: state.state_id,
            _limit: 100
        });

        var existing_data = new Discord.Collection();

        for(var cur_data of respData.state_data) {
            existing_data.set(cur_data.data_id, cur_data);
        }

        for(var data_name of Array.from(state.data.keys())) {
            var the_data = state.data.get(data_name);
            if(!existing_data.has(data_name)) {
                this.logger.info({
                    message: "State Data Creation",
                    state_id: state.state_id,
                    data_type: the_data.data_type,
                    data_name: the_data.data_name,
                    data: String(the_data.data)
                });

                var respPost = await this.api.post('state_data', {
                    state_id: state.state_id,
                    data_type: the_data.data_type,
                    data_name: the_data.data_name,
                    data: String(the_data.data)
                });
            } else if(existing_data.has(data_name) && existing_data.get(data_name).data_type !== the_data.data_type) {
                var respPut = await this.api.put('state_data', {
                    data_id: the_data.data_id,
                    data_type: the_data.data_type,
                    data: String(the_data.data)
                });

                existing_data.delete(data_name);
            } else if(existing_data.has(data_name) && existing_data.get(data_name).data !== the_data.data) {
                var respPut = await this.api.put('state_data', {
                    data_id: the_data.data_id,
                    data: String(the_data.data)
                });

                existing_data.delete(data_name);
            }
        }

        for(var data_name of Array.from(existing_data.keys())) {
            var exst_data = existing_data.get(data_name);
            var respDelete = await this.api.delete('state_data', {
                data_id: exst_data.data_id
            });
        }
    }

    async delete_state(state) {
        var respDelete = await this.api.delete('command_state', {
            state_id: state.state_id
        });

        return respDelete.status == 200;
    }
}

module.exports = StateManager;
