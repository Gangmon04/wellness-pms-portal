'use strict';

const { getAccessToken, clearAccessToken } = require('./zohoAuth');
const { PMS_BASE_URL } = require('./config');

/**
 * Zoho REST Client (ZRC) helper for CRM v8 API requests.
 */
const zrc = {
	async request(method, path, body = null, options = {}) {
		let token = await getAccessToken();

		// Normalize CRM path: ensure /crm/v8 prefix if relative path provided
		let fullPath = path;
		if (!fullPath.startsWith('/crm/')) {
			const version = options.version || 'v8';
			fullPath = `/crm/${version}${fullPath.startsWith('/') ? fullPath : '/' + fullPath}`;
		}

		let url = `${PMS_BASE_URL.replace(/\/crm\/?$/, '')}${fullPath}`;

		// Append query parameters if options.params is supplied
		if (options.params && typeof options.params === 'object') {
			const q = new URLSearchParams();
			for (const [k, v] of Object.entries(options.params)) {
				if (v !== undefined && v !== null && v !== '') {
					q.set(k, String(v));
				}
			}
			const qs = q.toString();
			if (qs) {
				url += (url.includes('?') ? '&' : '?') + qs;
			}
		}

		const headers = {
			'Authorization': `Zoho-oauthtoken ${token}`,
			'Accept': 'application/json',
			...(options.headers || {})
		};

		const fetchOpts = {
			method: method.toUpperCase(),
			headers
		};

		if (body && ['POST', 'PUT', 'PATCH'].includes(fetchOpts.method)) {
			if (typeof body === 'object' && !(body instanceof Buffer)) {
				headers['Content-Type'] = 'application/json; charset=utf-8';
				fetchOpts.body = JSON.stringify(body);
			} else {
				fetchOpts.body = body;
			}
		}

		let res = await fetch(url, fetchOpts);

		// Handle token expiry / 401 retry
		if (res.status === 401) {
			clearAccessToken();
			token = await getAccessToken();
			headers['Authorization'] = `Zoho-oauthtoken ${token}`;
			res = await fetch(url, { ...fetchOpts, headers });
		}

		const contentType = res.headers.get('content-type') || '';
		let responseData = null;
		if (contentType.includes('application/json')) {
			responseData = await res.json().catch(() => null);
		} else {
			responseData = await res.text().catch(() => '');
		}

		return {
			status: res.status,
			ok: res.ok,
			data: responseData,
			headers: res.headers
		};
	},

	get(path, options = {}) {
		return this.request('GET', path, null, options);
	},

	post(path, body = {}, options = {}) {
		return this.request('POST', path, body, options);
	},

	put(path, body = {}, options = {}) {
		return this.request('PUT', path, body, options);
	},

	patch(path, body = {}, options = {}) {
		return this.request('PATCH', path, body, options);
	},

	delete(path, options = {}) {
		return this.request('DELETE', path, null, options);
	},

	// Execute COQL query (CRM Object Query Language)
	async coql(selectQuery) {
		const cleanQuery = String(selectQuery).replace(/\s+/g, ' ').trim();
		return this.post('/crm/v8/coql', { select_query: cleanQuery });
	},

	// Raw binary streaming for images/photos
	async getRaw(path, options = {}) {
		let token = await getAccessToken();
		let url = path.startsWith('http') ? path : `${PMS_BASE_URL.replace(/\/crm\/?$/, '')}${path}`;
		const headers = {
			'Authorization': `Zoho-oauthtoken ${token}`,
			...(options.headers || {})
		};

		let res = await fetch(url, { method: 'GET', headers });
		if (res.status === 401) {
			clearAccessToken();
			token = await getAccessToken();
			headers['Authorization'] = `Zoho-oauthtoken ${token}`;
			res = await fetch(url, { method: 'GET', headers });
		}
		return res;
	}
};

module.exports = {
	zrc,
	PMS_BASE_URL
};
