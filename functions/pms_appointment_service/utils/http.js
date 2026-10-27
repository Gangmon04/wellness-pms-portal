'use strict';

const { CORS_CONFIG } = require('../config');

function getCorsHeaders(req) {
	const rawOrigin = req && req.headers ? (req.headers.origin || req.headers.Origin || '') : '';
	const isAllowed = CORS_CONFIG.isAllowedOrigin(rawOrigin, req);

	// Derive self origin dynamically from request host without hardcoding any URL
	const rawHost = req && req.headers ? (req.headers.host || '') : '';
	const host = rawHost.replace(/:(443|80)$/, '');
	const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
	const selfOrigin = host ? `${proto}://${host}` : null;

	// Safe origin determination:
	// 1. If incoming Origin is verified as trusted -> reflect that specific validated origin
	// 2. If no Origin header was sent (e.g. server-to-server or direct browser navigation) -> dynamically use request host
	// 3. If untrusted origin sent -> do NOT grant CORS access
	const allowedOrigin = isAllowed
		? rawOrigin
		: (!rawOrigin ? selfOrigin : null);

	const headers = {
		'Access-Control-Allow-Methods': CORS_CONFIG.METHODS,
		'Access-Control-Allow-Headers': CORS_CONFIG.HEADERS,
		'Access-Control-Max-Age': '86400',
		'Vary': 'Origin'
	};

	if (allowedOrigin) {
		headers['Access-Control-Allow-Origin'] = allowedOrigin;
		headers['Access-Control-Allow-Credentials'] = 'true';
	}

	return headers;
}

/**
 * Sends a JSON response with validated CORS headers and status code.
 */
function sendJson(res, statusCode, body, req = null) {
	const activeReq = req || res.__req;
	const cors = getCorsHeaders(activeReq);
	const headers = {
		'Content-Type': 'application/json; charset=utf-8',
		...cors
	};

	res.writeHead(statusCode, headers);
	res.end(JSON.stringify(body));
}

/**
 * Reads and parses the JSON request body stream.
 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (chunk) => { raw += chunk; });
		req.on('end', () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch (err) {
				reject(new Error('Invalid JSON payload'));
			}
		});
		req.on('error', reject);
	});
}

/**
 * Generic number/string padding helper (e.g. pad(5) => '05').
 */
function pad(n, width = 2) {
	return String(n).padStart(width, '0');
}

module.exports = {
	sendJson,
	readJsonBody,
	getCorsHeaders,
	pad
};
