'use strict';

/**
 * Error type raised by APIClient for any non-2xx response or transport
 * failure. Carries enough context to diagnose the failure from the log alone:
 * which call, which resource, what the server said, and how long it took.
 *
 * The token is redacted before it is ever stored on the error, so logging an
 * ApiError can never leak credentials.
 */

/**
 * Replace credential-bearing fields in a request payload with a placeholder.
 * @param {*} value - The request payload (params object or request body).
 * @returns {*} A shallow copy with `_token`/`token` redacted, or the value unchanged.
 */
function redact(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = Array.isArray(value) ? [...value] : { ...value };
    for (const key of Object.keys(copy)) {
        if (key === '_token' || key === 'token') copy[key] = '[redacted]';
    }
    return copy;
}

/**
 * A failed API call. Instances are reported by {@link ErrorReporter} at the
 * point of failure, so callers should let them propagate rather than swallow.
 */
class ApiError extends Error {
    /**
     * @param {Object} details
     * @param {string} details.method - HTTP method used.
     * @param {string} details.resource - API resource that was called.
     * @param {?number} [details.status] - HTTP status, when a response arrived.
     * @param {?string} [details.code] - Transport error code (ECONNREFUSED, ...).
     * @param {?string} [details.body] - Server response body, truncated.
     * @param {?number} [details.durationMs] - Time the call took before failing.
     * @param {Object} [details.params] - Request payload (redacted on construction).
     * @param {?string} [details.correlationId] - Ties related calls to one command run.
     */
    constructor({ method, resource, status, code, body, durationMs, params, correlationId }) {
        const label = `${String(method || 'get').toUpperCase()} ${resource}`;
        const reason = status ? `HTTP ${status}` : (code || 'transport error');
        super(`${label} failed (${reason})`);
        this.name = 'ApiError';
        this.method = method;
        this.resource = resource;
        this.status = status ?? null;
        this.code = code ?? null;
        this.body = typeof body === 'string' ? body.slice(0, 500) : null;
        this.durationMs = durationMs ?? null;
        this.params = redact(params);
        this.correlationId = correlationId ?? null;
        /** Set by the reporter so callers do not report the same failure twice. */
        this.reported = false;
    }

    /** Stable key used to group repeated failures and suppress duplicate alerts. */
    get signature() {
        return `api:${this.status ?? this.code ?? 'net'}:${this.resource}`;
    }
}

module.exports = { ApiError, redact };
