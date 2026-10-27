'use strict';

/**
 * PMS Appointment Service Configuration Module
 * 
 * Centralizes environment-dependent configuration with sensible defaults.
 * Differentiates genuine environment configuration from business defaults and API constants.
 */

// 1. Remote API Endpoints (overridable via environment variables)
const PMS_BASE_URL = process.env.PMS_BASE_URL || 'https://pms.zohovertical.in/crm';
const ZOHO_ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
const ZOHO_TOKEN_URL = `${ZOHO_ACCOUNTS_URL.replace(/\/$/, '')}/oauth/v2/token`;
const ZOHO_PROFILE_URL = process.env.ZOHO_PROFILE_URL || 'https://profile.zoho.in';
const ZOHO_CONTACTS_URL = process.env.ZOHO_CONTACTS_URL || 'https://contacts.zoho.in';

// 2. Cache & Timing Configurations
const CACHE_CONFIG = {
	HOSPITAL_LOGO_TTL_MS: process.env.HOSPITAL_LOGO_TTL_MS ? Number(process.env.HOSPITAL_LOGO_TTL_MS) : 60 * 60 * 1000, // 1 hour
	DOCTOR_IMAGE_TTL_MS: process.env.DOCTOR_IMAGE_TTL_MS ? Number(process.env.DOCTOR_IMAGE_TTL_MS) : 30 * 60 * 1000,   // 30 minutes
	DEFAULT_TOKEN_EXPIRY_SEC: 3600,                                                                                     // 1 hour
	TOKEN_EXPIRY_BUFFER_SEC: 300,                                                                                       // 5 minutes
	RATE_LIMIT_COOLDOWN_MS: 30000,                                                                                      // 30 seconds
	BROWSER_CACHE_MAX_AGE_SEC: 86400                                                                                    // 24 hours
};

// 3. Regional / Operational Configurations
const TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET || '+05:30';
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '+91';
const APPOINTMENT_TARGET_MODE = process.env.APPOINTMENT_TARGET_MODE || 'auto'; // 'auto' | 'prospect' | 'patient_only'

// 4. CORS Configuration
// Optional comma-separated origins from environment variables (e.g. custom domain or external website)
const ENV_ORIGINS = process.env.ALLOWED_ORIGINS
	? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
	: [];

const ALLOW_ALL_ORIGINS = process.env.ALLOWED_ORIGINS === '*' || process.env.CORS_ALLOW_ALL === 'true';

/**
 * Validates if an incoming request Origin is trusted.
 * Dynamically validates Catalyst platform domains, local development, same-host calls, and environment variables without hardcoding.
 */
function isAllowedOrigin(origin, req = null) {
	if (!origin) return false;
	if (ALLOW_ALL_ORIGINS) return true;

	const clean = String(origin).trim().toLowerCase();
	if (ENV_ORIGINS.includes(clean)) return true;

	try {
		const u = new URL(clean);
		const hostname = u.hostname.toLowerCase();

		// 1. Allow all Catalyst platform domains dynamically (development, staging, production, all regions)
		if (
			hostname.endsWith('.catalystserverless.in') ||
			hostname.endsWith('.catalystserverless.com') ||
			hostname.endsWith('.catalystserverless.eu')
		) {
			return true;
		}

		// 2. Allow local development (any local port)
		if (hostname === 'localhost' || hostname === '127.0.0.1') {
			return true;
		}

		// 3. Allow same-origin / same-host if the request host header matches
		if (req && req.headers && req.headers.host) {
			const reqHost = req.headers.host.toLowerCase().split(':')[0];
			if (hostname === reqHost) return true;
		}
	} catch (_) {}

	return false;
}

const CORS_CONFIG = {
	ENV_ORIGINS,
	isAllowedOrigin,
	ALLOW_ALL_ORIGINS,
	METHODS: 'GET, POST, PUT, DELETE, OPTIONS',
	HEADERS: 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
};

// 5. CRM Module & Field API Names (WidgetRepo Single Source of Truth)
const crmApi = require('./crmApi');

module.exports = {
	PMS_BASE_URL,
	ZOHO_ACCOUNTS_URL,
	ZOHO_TOKEN_URL,
	ZOHO_PROFILE_URL,
	ZOHO_CONTACTS_URL,
	CACHE_CONFIG,
	TIMEZONE_OFFSET,
	DEFAULT_COUNTRY_CODE,
	APPOINTMENT_TARGET_MODE,
	CORS_CONFIG,
	// CRM API constants
	USER_TYPES: crmApi.USER_TYPES,
	MODULES: crmApi.MODULES,
	APPOINTMENT_FIELDS: crmApi.APPOINTMENT_FIELDS,
	SERVICE_FIELDS: crmApi.SERVICE_FIELDS,
	PATIENT_FIELDS: crmApi.PATIENT_FIELDS,
	CONTACT_FIELDS: crmApi.CONTACT_FIELDS,
	APP_SETTINGS_FIELDS: crmApi.APP_SETTINGS_FIELDS
};
