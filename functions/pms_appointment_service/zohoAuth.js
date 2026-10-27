'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ZOHO_TOKEN_URL, CACHE_CONFIG } = require('./config');

function loadLocalEnv() {
	const envPaths = [
		path.join(__dirname, '.env'),
		path.join(__dirname, '..', '..', '.env')
	];
	for (const envPath of envPaths) {
		if (fs.existsSync(envPath)) {
			try {
				const content = fs.readFileSync(envPath, 'utf8');
				for (const line of content.split(/\r?\n/)) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
						const idx = trimmed.indexOf('=');
						const key = trimmed.slice(0, idx).trim();
						let val = trimmed.slice(idx + 1).trim();
						if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
							val = val.slice(1, -1);
						}
						if (!process.env[key]) {
							process.env[key] = val;
						}
					}
				}
			} catch (e) {}
		}
	}
}

function getCredentials() {
	loadLocalEnv();
	const clientId = process.env.CLIENT_ID;
	const clientSecret = process.env.CLIENT_SECRET;
	const soid = process.env.SOID;
	const scopes = process.env.SCOPES;

	const missing = [];
	if (!clientId) missing.push('CLIENT_ID');
	if (!clientSecret) missing.push('CLIENT_SECRET');
	if (!soid) missing.push('SOID');
	if (!scopes) missing.push('SCOPES');

	if (missing.length > 0) {
		throw new Error(`Missing required Zoho OAuth environment variable(s): ${missing.join(', ')}. Set them in .env (local) or Catalyst Console (deployed).`);
	}

	return { clientId, clientSecret, soid, scopes };
}

function getTokenCacheFile(clientId) {
	const safeId = String(clientId || 'default').replace(/[^a-zA-Z0-9]/g, '_');
	return path.join(os.tmpdir(), `pms_oauth_token_${safeId}.json`);
}

function readTokenFromFile(clientId) {
	try {
		const filePath = getTokenCacheFile(clientId);
		if (fs.existsSync(filePath)) {
			const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			if (data && data.token && Date.now() < (data.expires_at || 0)) {
				return data;
			}
		}
	} catch (e) {}
	return null;
}

function writeTokenToFile(token, clientId, expiresInSec = 3600) {
	try {
		const filePath = getTokenCacheFile(clientId);
		const data = {
			token,
			expires_at: Date.now() + ((expiresInSec || 3600) - 300) * 1000
		};
		fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
	} catch (e) {}
}

let cachedToken = process.env.PMS_TOKEN || null;
let cachedTokenClientId = null;
let tokenExpiryTime = 0;
let pendingTokenPromise = null;
let rateLimitedUntil = 0;

/**
 * Fetches and caches the Zoho OAuth token via Client Credentials (auto-refreshes every 55 mins).
 */
async function getAccessToken() {
	const { clientId, clientSecret, soid, scopes } = getCredentials();
	const now = Date.now();

	// In-memory cache valid only for the matching clientId
	if (cachedToken && cachedTokenClientId === clientId && now < tokenExpiryTime) {
		return cachedToken;
	}

	// 1. Try file cache across processes for this specific clientId
	const fileCache = readTokenFromFile(clientId);
	if (fileCache) {
		cachedToken = fileCache.token;
		cachedTokenClientId = clientId;
		tokenExpiryTime = fileCache.expires_at;
		return cachedToken;
	}

	// 2. If rate-limited recently and we have an existing token for this client, reuse it
	if (now < rateLimitedUntil && cachedToken && cachedTokenClientId === clientId) {
		return cachedToken;
	}

	// 3. Deduplicate concurrent token requests
	if (pendingTokenPromise) {
		return pendingTokenPromise;
	}

	pendingTokenPromise = (async () => {
		try {
			const params = new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: clientId,
				client_secret: clientSecret,
				scope: scopes,
				soid: soid
			});

			const res = await fetch(ZOHO_TOKEN_URL, {
				method: 'POST',
				body: params
			});

			const rawText = await res.text();
			let data = {};
			try { data = JSON.parse(rawText); } catch (pe) {}

			if (data.access_token) {
				cachedToken = data.access_token;
				cachedTokenClientId = clientId;
				tokenExpiryTime = Date.now() + ((data.expires_in || 3600) - 300) * 1000;
				writeTokenToFile(cachedToken, clientId, data.expires_in || 3600);
				return cachedToken;
			}

			if (rawText.includes('too many requests')) {
				rateLimitedUntil = Date.now() + 30000;
			}

			console.warn('Zoho accounts token request failed');
		} catch (err) {
			console.warn('OAuth refresh error');
		} finally {
			pendingTokenPromise = null;
		}

		if (cachedToken && Date.now() < tokenExpiryTime) {
			return cachedToken;
		}

		throw new Error('Unable to authenticate with Zoho Accounts. Please try again later.');
	})();

	return pendingTokenPromise;
}

function clearAccessToken() {
	cachedToken = null;
	cachedTokenClientId = null;
	tokenExpiryTime = 0;
	try {
		const { clientId } = getCredentials();
		const filePath = getTokenCacheFile(clientId);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch (e) {}
}

module.exports = {
	getAccessToken,
	clearAccessToken
};
