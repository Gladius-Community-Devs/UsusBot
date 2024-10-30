var axios = require('axios');
var fs = require('fs');

//TEST 11/24/2023 1:07 AM

/**
 * Class that provides a simple wrapper around Axios to make interacting with the LabsAPI easier.
 * You'll need a variable called auth_win that will store a popup window used for CAS authentication.
 * The popup window will call opener.api.do_key_grab(), so you'll want to name your instance "api".
 */
class APIClient {

	/**
	 * Creates an instance of APIClient. Will check for an access token in browser cookie storage.
	 * If no access token is found, it will call this.popup_auth_win(), which opens a popup window
	 * that handles CAS authentication and passes back a temp_key, which can be exchanged for an
	 * access token. Once the APIClient has a token, it will fire an 'ApiReady' event on document.
	 */
	constructor() {
        this.api_url = "https://budaslounge.com/usus_api/";
		this.access_url = "UsusBot Server";
		this.token = fs.readFileSync(__dirname + "/../../../usus_api_token.txt", "utf8");
	}

	/**
	 * Builds the URL for a specific resource of form: [this.api_url][resource].php
	 * @param {string} resource - The name of the resource to build URL for
	 * @return {string} The proper URL for the endpoint of the given resource
	 */
	buildUrl(resource) {
		return this.api_url + resource;
	}

	/**
	 * Generic error handler for get, post, put, and delete functions. Abstracted out to reduce redundant code, and to make
	 * it easier to change.
	 *
	 * @param error The error that was thrown
	 */
	error_handler(error) {
		if(error.hasOwnProperty("response") && error.response.hasOwnProperty("status") && error.response.status == 401) {
            console.log("Unauthorized Error!");
            console.error(error.response);
		} else {
			console.error(error);
		}
	}

	/**
	 * The get, post, put, and delete methods are provided for ease of access, so that all of these methods can be abstracted
	 * to accept essentially the same parameters. This is only necessary because Axios does not support sending a request body
	 * with a get request, so we must use params instead. For delete, we have to provide the request body to the config of the
	 * Axios function call, because it does not provide a parameter for data on delete. I understand that by using params instead
	 * of a file path for identifying resources, this API does not follow conventional RESTful standards, but I am not sure it's
	 * possible to use a file path for identifying resources in our case because we're using PHP with an Apache server.
	 *
	 * @param resource - The type of resource you want to perform an action on
	 * @param params/data - The request body (should be JSON/JavaScript Object)
	 */

	/**
	 * Used for obtaining information about a specific resource instance or listing instances of a resource. Can be ordered and filtered as well.
	 *
	 * An async wrapper for axios.get(). This function should be placed inside a try/catch block, as it will throw any errors that come
	 * its way. It is not necessary to include an access token in the 'params' object, as it will be added before the API call is made.
	 * It is also worth mentioning that any response code from the server that is not in the 2xx range will be thrown as an error. To see
	 * the server's response in this case, look at 'error.response'. When the server responds, this function will fire an ApiGET event containing
	 * the resource and params passed to it, as well as the server's response.
	 * @param {string} resource - A string containing the name of the resource for which to make a request -- will autmatically be built into a URL.
	 * @param {Object} params - An object containing parameters -- Because this is a GET request, these will be parsed into a query string.
	 * @return {Object} The data section of the LabsAPI server's response
	 */
	async get(resource, params) {
		try {
			params._token = this.token;
			params._api_url = this.access_url;
			var resp = await axios.get(this.buildUrl(resource), { params });
			return resp.data;
		} catch(error) {
			this.error_handler(error);
		}
	}

	/**
	 * Used for creating a new instance of a resource.
	 *
	 * An async wrapper for axios.post(). This function should be placed inside a try/catch block, as it will throw any errors that come
	 * its way. It is not necessary to include an access token in the 'params' object, as it will be added before the API call is made.
	 * It is also worth mentioning that any response code from the server that is not in the 2xx range will be thrown as an error. To see
	 * the server's response in this case, look at 'error.response'. When the server responds, this function will fire an ApiGET event containing
	 * the resource and params passed to it, as well as the server's response.
	 *
	 * @param {string} resource - A string containing the name of the resource for which to make a request -- will autmatically be built into a URL.
	 * @param {Object} params - An object containing parameters
	 * @return {Object} The data section of the LabsAPI server's response
	 */
	async post(resource, data) {
		try {
			data._token = this.token;
			data._api_url = this.access_url;
			var resp = await axios.post(this.buildUrl(resource), data);
			return resp.data;
		} catch(error) {
			this.error_handler(error);
		}
	}

	async put(resource, data) {
		try {
			data._token = this.token;
			data._api_url = this.access_url;
			var resp = await axios.put(this.buildUrl(resource), data);
			return resp.data;
		} catch(error) {
			this.error_handler(error);
		}
	}

	async delete(resource, data) {
		try {
			data._token = this.token;
			data._api_url = this.access_url;
			var resp = await axios.delete(this.buildUrl(resource), { data });
			return resp.data;
		} catch(error) {
			this.error_handler(error);
		}
	}
}

module.exports = APIClient;
