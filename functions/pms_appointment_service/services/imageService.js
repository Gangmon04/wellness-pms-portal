'use strict';

const { zrc } = require('../zohoClient');
const { CACHE_CONFIG, ZOHO_PROFILE_URL, ZOHO_CONTACTS_URL, MODULES } = require('../config');
const { getCorsHeaders } = require('../utils/http');

let cachedOrgLogo = null;
let logoCachedAt = 0;
const doctorImageCache = new Map();
const doctorZuidCache = new Map();

/**
 * Fetches and caches base64 data URI of the hospital logo.
 */
async function getHospitalLogoBase64() {
	const now = Date.now();
	if (cachedOrgLogo && (now - logoCachedAt < CACHE_CONFIG.HOSPITAL_LOGO_TTL_MS)) {
		return cachedOrgLogo;
	}

	try {
		const pRes = await zrc.getRaw(`/crm/v8/${MODULES.ORG}/photo`);
		if (pRes.ok) {
			const contentType = pRes.headers.get('content-type') || 'image/png';
			const arrayBuf = await pRes.arrayBuffer();
			if (arrayBuf.byteLength > 0) {
				const b64 = Buffer.from(arrayBuf).toString('base64');
				cachedOrgLogo = `data:${contentType};base64,${b64}`;
				logoCachedAt = Date.now();
				return cachedOrgLogo;
			}
		}
	} catch (imgErr) {
		console.warn('Could not fetch hospital logo photo');
	}
	return '';
}

/**
 * Fetches raw hospital logo image buffer for binary streaming.
 */
async function getHospitalLogoRaw() {
	const pRes = await zrc.getRaw(`/crm/v8/${MODULES.ORG}/photo`);
	if (pRes.ok) {
		const contentType = (pRes.headers.get('content-type') || 'image/png').split(';')[0];
		const arrayBuf = await pRes.arrayBuffer();
		return {
			buffer: Buffer.from(arrayBuf),
			contentType,
			contentLength: arrayBuf.byteLength
		};
	}
	return null;
}

/**
 * Looks up and caches a Zoho user's ZUID by their CRM User ID.
 */
async function lookupUserZuid(id) {
	if (!id) return null;
	if (doctorZuidCache.has(String(id))) {
		return doctorZuidCache.get(String(id));
	}

	try {
		const uRes = await zrc.get(`/crm/v8/${MODULES.USERS}/${id}`);
		const userZuid = uRes.data?.users?.[0]?.zuid;
		if (userZuid) {
			const zuidStr = String(userZuid);
			doctorZuidCache.set(String(id), zuidStr);
			return zuidStr;
		}
	} catch (uErr) {
		console.warn('Could not lookup user zuid');
	}
	return null;
}

/**
 * Fetches doctor photo with memory caching and direct CRM endpoint:
 * 1. CRM /crm/v8/users/{id}/photo
 * 2. Cached misses for 60s to prevent repeated slow roundtrips
 */
async function getDoctorImage(id, zuid) {
	if (!id && !zuid) return null;

	const cacheKey = String(id || zuid);
	const cached = doctorImageCache.get(cacheKey);
	if (cached && cached.buffer && (Date.now() - cached.time < CACHE_CONFIG.DOCTOR_IMAGE_TTL_MS)) {
		return {
			buffer: cached.buffer,
			contentType: cached.contentType
		};
	}

	if (cached && cached.missUntil && Date.now() < cached.missUntil) {
		return null;
	}

	// 1. Try official CRM User Photo endpoint with fast fail (under 3s)
	if (id) {
		try {
			const pRes = await zrc.getRaw(`/crm/v8/${MODULES.USERS}/${id}/photo`, { timeout: 3000 });
			if (pRes && pRes.ok) {
				const contentType = (pRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
				const arrayBuf = await pRes.arrayBuffer();
				const buffer = Buffer.from(arrayBuf);
				if (buffer.length > 0) {
					doctorImageCache.set(cacheKey, { buffer, contentType, time: Date.now() });
					return { buffer, contentType };
				}
			}
		} catch (pErr) {
			console.warn(`Could not fetch CRM photo for user ${id}`);
		}
	}

	// 2. Cache miss for 60s so subsequent requests return in 0ms without re-querying
	doctorImageCache.set(cacheKey, { missUntil: Date.now() + (60 * 1000), time: Date.now() });
	return null;
}

/**
 * Streams the hospital logo binary to the HTTP response.
 */
async function streamHospitalLogo(res, req = null) {
	const activeReq = req || res.__req;
	const cors = getCorsHeaders(activeReq);

	try {
		const logo = await getHospitalLogoRaw();
		if (logo) {
			const headers = {
				'Content-Type': logo.contentType,
				'Content-Length': logo.contentLength,
				'Cache-Control': `public, max-age=${CACHE_CONFIG.BROWSER_CACHE_MAX_AGE_SEC}`,
				...cors
			};
			res.writeHead(200, headers);
			return res.end(logo.buffer);
		}
		const errHeaders = {
			'Content-Type': 'application/json',
			...cors
		};
		res.writeHead(404, errHeaders);
		return res.end(JSON.stringify({ ok: false, error: 'No hospital logo found' }));
	} catch (err) {
		console.error('Hospital logo streaming error');
		const errHeaders = {
			'Content-Type': 'application/json',
			...cors
		};
		res.writeHead(500, errHeaders);
		return res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
	}
}

/**
 * Streams the doctor image binary to the HTTP response.
 */
async function streamDoctorImage(res, id, zuid, req = null) {
	const activeReq = req || res.__req;
	const cors = getCorsHeaders(activeReq);

	if (!id && !zuid) {
		const errHeaders = {
			'Content-Type': 'text/plain',
			...cors
		};
		res.writeHead(400, errHeaders);
		return res.end('Missing doctor id or zuid');
	}

	try {
		const image = await getDoctorImage(id, zuid);
		if (image) {
			const headers = {
				'Content-Type': image.contentType,
				'Content-Length': image.buffer.length,
				'Cache-Control': `public, max-age=${CACHE_CONFIG.BROWSER_CACHE_MAX_AGE_SEC}`,
				...cors
			};
			res.writeHead(200, headers);
			return res.end(image.buffer);
		}

		const errHeaders = {
			'Content-Type': 'text/plain',
			...cors
		};
		res.writeHead(404, errHeaders);
		return res.end('Image not found');
	} catch (err) {
		console.error('Error in /doctor-image route');
		const errHeaders = {
			'Content-Type': 'text/plain',
			...cors
		};
		res.writeHead(500, errHeaders);
		return res.end('Internal server error');
	}
}

module.exports = {
	doctorImageCache,
	doctorZuidCache,
	getHospitalLogoBase64,
	getHospitalLogoRaw,
	lookupUserZuid,
	getDoctorImage,
	streamHospitalLogo,
	streamDoctorImage
};
