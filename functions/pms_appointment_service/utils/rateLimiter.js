'use strict';

/**
 * Lightweight in-memory sliding-window rate limiter for public endpoints.
 * Protects against automated scrapers, brute-force enumeration, and booking spam.
 */
const rateLimitBuckets = new Map();

// Periodic cleanup every 5 minutes to prevent memory growth
const cleanupInterval = setInterval(() => {
	const now = Date.now();
	for (const [key, record] of rateLimitBuckets.entries()) {
		if (now > record.resetTime) {
			rateLimitBuckets.delete(key);
		}
	}
}, 5 * 60 * 1000);

if (cleanupInterval.unref) {
	cleanupInterval.unref();
}

/**
 * Extracts client IP from request headers (Catalyst gateway / proxy safe).
 */
function getClientIp(req) {
	if (!req) return '127.0.0.1';
	const headers = req.headers || {};
	const forwarded = headers['x-forwarded-for'] || headers['x-real-ip'] || headers['client-ip'];
	if (forwarded) {
		return String(forwarded).split(',')[0].trim();
	}
	return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks if request exceeds the rate limit.
 * @param {Object} req Request object
 * @param {string} actionIdentifier Endpoint identifier (e.g. 'patient_search' or 'book_appointment')
 * @param {number} maxRequests Maximum allowed requests in the time window
 * @param {number} windowMs Time window in milliseconds (default 60,000ms = 1 minute)
 * @returns {boolean} true if allowed, false if rate limited
 */
function checkRateLimit(req, actionIdentifier = 'general', maxRequests = 15, windowMs = 60000) {
	const ip = getClientIp(req);
	const key = `${actionIdentifier}:${ip}`;
	const now = Date.now();

	let record = rateLimitBuckets.get(key);
	if (!record || now > record.resetTime) {
		record = {
			count: 1,
			resetTime: now + windowMs
		};
		rateLimitBuckets.set(key, record);
		return true;
	}

	record.count += 1;
	if (record.count > maxRequests) {
		return false;
	}

	return true;
}

module.exports = {
	checkRateLimit,
	getClientIp
};
