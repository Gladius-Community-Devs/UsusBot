var axios = require('axios');
var fs = require('fs');
var { ApiError } = require('./errors.js');

/**
 * Class that wraps Axios to make interacting with the LabsAPI easier.
 *
 * Every call resolves to the API's `data` section on success and **throws** an
 * {@link ApiError} on any non-2xx response or transport failure. Failures are
 * reported through the module-level reporter (see {@link APIClient.configure}),
 * so callers must let the error propagate: the old behaviour of logging to
 * stdout and returning `undefined` made every downstream
 * `resp.hasOwnProperty(...)` fail with an unrelated TypeError and discarded
 * the real cause.
 *
 * @example
 * const APIClient = require('./APIClient.js');
 * APIClient.configure({ reporter });          // once at boot
 * const api = new APIClient({ correlationId });
 * const resp = await api.get('module', { name: 'gladius' });
 */

/** @type {?Object} Shared sink for every instance; set by {@link APIClient.configure}. */
let reporter = null;

/** Cached API token; read once instead of on every request. */
let cachedToken = null;

/**
 * Read the API token from beside the deployment root, caching the result.
 * @returns {string} The trimmed token.
 * @throws {Error} If the token file cannot be read.
 */
function readToken() {
	if (cachedToken !== null) return cachedToken;
	try {
		cachedToken = fs.readFileSync(__dirname + '/../../../usus_api_token.txt', 'utf8').trim();
	} catch (error) {
		throw new Error('usus_api_token.txt could not be read: ' + error.message);
	}
	return cachedToken;
}

class APIClient {

	/**
	 * @param {Object} [options]
	 * @param {number} [options.timeoutMs=10000] - Per-request timeout.
	 * @param {?string} [options.correlationId] - Ties every call made for one
	 *   command invocation together in the logs.
	 */
	constructor(options = {}) {
		this.api_url = 'https://budaslounge.com/usus_api/';
		this.access_url = 'UsusBot Server';
		this.timeoutMs = options.timeoutMs || 10000;
		this.correlationId = options.correlationId || null;
		this.token = readToken();
	}

	/**
	 * Install the shared error reporter. Called once at boot; without it,
	 * failures fall back to stderr.
	 * @param {Object} options
	 * @param {Object} options.reporter - The reporter to notify.
	 * @returns {void}
	 */
	static configure({ reporter: configuredReporter }) {
		reporter = configuredReporter || null;
	}

	/**
	 * Builds the URL for a specific resource of form: [this.api_url][resource]
	 * @param {string} resource - The name of the resource to build URL for
	 * @return {string} The proper URL for the endpoint of the given resource
	 */
	buildUrl(resource) {
		return this.api_url + resource;
	}

	/**
	 * Perform one request and translate any failure into an {@link ApiError}.
	 *
	 * The token is sent as a query parameter on GET (Axios cannot send a body
	 * with GET) and in the body otherwise; either way it is redacted before the
	 * error is stored, so failures can be logged safely.
	 *
	 * @param {string} method - HTTP method: get, post, put or delete.
	 * @param {string} resource - The resource to act on.
	 * @param {Object} payload - Query parameters (GET) or request body.
	 * @returns {Promise<Object>} The `data` section of the API response.
	 * @throws {ApiError} On any non-2xx response or transport failure.
	 */
	async request(method, resource, payload) {
		const startedAt = Date.now();
		const body = { ...(payload || {}), _token: this.token, _api_url: this.access_url };
		const config = {
			method,
			url: this.buildUrl(resource),
			timeout: this.timeoutMs,
		};
		if (method === 'get') {
			config.params = body;
		} else {
			config.data = body;
		}

		try {
			const resp = await axios.request(config);
			return resp.data;
		} catch (error) {
			const apiError = new ApiError({
				method,
				resource,
				status: error?.response?.status ?? null,
				code: error?.code ?? null,
				body: this.describeBody(error),
				durationMs: Date.now() - startedAt,
				params: body,
				correlationId: this.correlationId,
			});
			this.report(apiError);
			throw apiError;
		}
	}

	/**
	 * Render the server's response body for logging without blowing up on an
	 * unexpected shape.
	 * @param {*} error - The Axios error.
	 * @returns {?string} A truncated, printable body.
	 */
	describeBody(error) {
		const data = error?.response?.data;
		if (data === undefined || data === null) return error?.message || null;
		if (typeof data === 'string') return data.slice(0, 500);
		try {
			return JSON.stringify(data).slice(0, 500);
		} catch (_) {
			return null;
		}
	}

	/**
	 * Hand the failure to the shared reporter, or stderr when unconfigured.
	 * @param {ApiError} apiError - The failure to report.
	 * @returns {void}
	 */
	report(apiError) {
		if (reporter) {
			reporter.report(apiError, { correlationId: this.correlationId });
			return;
		}
		console.error('[APIClient] ' + apiError.message);
	}

	/**
	 * Used for obtaining information about a specific resource instance or
	 * listing instances of a resource. Can be ordered and filtered as well.
	 * @param {string} resource - The name of the resource for which to make a request
	 * @param {Object} params - Parameters, parsed into a query string
	 * @return {Promise<Object>} The data section of the API response
	 */
	async get(resource, params) {
		return this.request('get', resource, params);
	}

	/**
	 * Used for creating a new instance of a resource.
	 * @param {string} resource - The name of the resource to act on
	 * @param {Object} data - Request body
	 * @return {Promise<Object>} The data section of the API response
	 */
	async post(resource, data) {
		return this.request('post', resource, data);
	}

	/**
	 * Used for updating an existing instance of a resource.
	 * @param {string} resource - The name of the resource to act on
	 * @param {Object} data - Request body
	 * @return {Promise<Object>} The data section of the API response
	 */
	async put(resource, data) {
		return this.request('put', resource, data);
	}

	/**
	 * Used for deleting an instance of a resource.
	 * @param {string} resource - The name of the resource to act on
	 * @param {Object} data - Request body
	 * @return {Promise<Object>} The data section of the API response
	 */
	async delete(resource, data) {
		return this.request('delete', resource, data);
	}
}

module.exports = APIClient;
