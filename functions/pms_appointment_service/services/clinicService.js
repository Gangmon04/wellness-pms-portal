'use strict';

const { zrc } = require('../zohoClient');
const {
	ZOHO_PROFILE_URL,
	MODULES,
	SERVICE_FIELDS,
	APP_SETTINGS_FIELDS,
	USER_TYPES
} = require('../config');
const { getHospitalLogoBase64, doctorZuidCache: defaultDoctorZuidCache } = require('./imageService');

// Intentional Business Defaults
const DEFAULT_BUSINESS_HOURS = '24 Hours';
const DEFAULT_SERVICE_NAME = 'Consultation';
const DEFAULT_SERVICE_DURATION = 30;
const DEFAULT_SERVICE_STATUS = 'Available';
const DEFAULT_SERVICE_LOCATION = 'Business Address';
const DEFAULT_DOCTOR_ROLE = 'Doctor';

/**
 * Formats a 24-hour time string into a 12-hour AM/PM string.
 */
function formatTime(t) {
	if (!t) return '';
	if (/am|pm/i.test(t)) return t;
	const parts = String(t).split(':');
	let h = parseInt(parts[0], 10);
	const m = parts[1] || '00';
	const ampm = h >= 12 ? 'PM' : 'AM';
	h = h % 12 || 12;
	return `${h}:${m} ${ampm}`;
}

/**
 * Formats raw business hours object into a readable clinic hours string.
 */
function formatBusinessHours(bh) {
	if (!bh) return DEFAULT_BUSINESS_HOURS;
	const type = String(bh.type || '').toLowerCase();

	if (type.includes('24') || bh.is_24_7 || (bh.same_as_everyday === true && (!bh.daily_timing || bh.daily_timing.length === 0))) {
		return DEFAULT_BUSINESS_HOURS;
	} else if (Array.isArray(bh.daily_timing) && bh.daily_timing.length >= 2) {
		const start = formatTime(bh.daily_timing[0]);
		const end = formatTime(bh.daily_timing[1]);
		return (start && end) ? `${start} – ${end}` : DEFAULT_BUSINESS_HOURS;
	} else if (Array.isArray(bh.custom_timing) && bh.custom_timing.length > 0) {
		const first = bh.custom_timing[0];
		const timing = first.daily_timing || first.timing || first.business_timing || first.shift_timing;
		if (Array.isArray(timing) && timing.length >= 2) {
			const start = formatTime(timing[0]);
			const end = formatTime(timing[1]);
			return (start && end) ? `${start} – ${end}` : DEFAULT_BUSINESS_HOURS;
		}
		return DEFAULT_BUSINESS_HOURS;
	}
	return DEFAULT_BUSINESS_HOURS;
}

/**
 * Fetches hospital details from App_Settings, with fallback to org info, business hours, and logo.
 */
async function getHospitalInfo() {
	let hospitalName = '';
	let phone = '';
	let email = '';
	let address = '';
	let practiceType = '';
	let businessHours = '';

	// 1. Try App_Settings first via ZRC GET
	try {
		const sRes = await zrc.get(`/crm/v8/${MODULES.APP_SETTINGS}`, {
			params: {
				fields: `${APP_SETTINGS_FIELDS.ID},${APP_SETTINGS_FIELDS.HOSPITAL_NAME},${APP_SETTINGS_FIELDS.CONTACT_NUMBER},${APP_SETTINGS_FIELDS.EMAIL_ID},${APP_SETTINGS_FIELDS.PRACTICE_TYPE},${APP_SETTINGS_FIELDS.ADDRESS},${APP_SETTINGS_FIELDS.CITY},${APP_SETTINGS_FIELDS.STATE},${APP_SETTINGS_FIELDS.PINCODE}`,
				per_page: 1
			}
		});
		const setting = sRes.data?.data?.[0];
		if (setting) {
			hospitalName = setting[APP_SETTINGS_FIELDS.HOSPITAL_NAME] || '';
			phone = setting[APP_SETTINGS_FIELDS.CONTACT_NUMBER] || '';
			email = setting[APP_SETTINGS_FIELDS.EMAIL_ID] || '';
			address = [
				setting[APP_SETTINGS_FIELDS.ADDRESS],
				setting[APP_SETTINGS_FIELDS.CITY],
				setting[APP_SETTINGS_FIELDS.STATE],
				setting[APP_SETTINGS_FIELDS.PINCODE]
			].filter(Boolean).join(', ');
			practiceType = setting[APP_SETTINGS_FIELDS.PRACTICE_TYPE] || '';
		}
	} catch (e) {
		console.warn('Could not fetch App_Settings via ZRC');
	}

	// 2. Fallback to /crm/v8/org if hospitalName is not set in App_Settings
	if (!hospitalName) {
		try {
			const oRes = await zrc.get(`/crm/v8/${MODULES.ORG}`);
			const org = oRes.data?.org?.[0];
			if (org) {
				hospitalName = org.company_name || '';
				phone = phone || org.phone || '';
				email = email || org.primary_email || '';
				address = address || [org.street, org.city, org.state, org.zip].filter(Boolean).join(', ');
			}
		} catch (oErr) {
			console.warn('Could not fetch org info via ZRC');
		}
	}

	// 3. Fetch Business Hours for practice info via ZRC GET
	try {
		const bhRes = await zrc.get(`/crm/v8/${MODULES.BUSINESS_HOURS}`);
		const bh = bhRes.data?.business_hours || (Array.isArray(bhRes.data?.data) ? bhRes.data.data[0] : null);
		businessHours = formatBusinessHours(bh);
	} catch (bErr) {
		console.warn('Could not fetch business hours via ZRC');
	}

	// 4. Fetch Hospital Logo Photo (cached in-memory for 1 hour)
	const hospitalImage = await getHospitalLogoBase64();

	return {
		name: hospitalName || '',
		phone: phone || '',
		email: email || '',
		address: address || '',
		practiceType: practiceType || '',
		businessHours: businessHours || '',
		image: hospitalImage || ''
	};
}

/**
 * Fetches active practitioners from PMS via ZRC GET, filtered and sorted.
 */
async function getDoctors(doctorZuidCache = defaultDoctorZuidCache) {
	const pmsRes = await zrc.get(`/crm/v8/${MODULES.USERS}`, {
		params: {
			type: USER_TYPES.ACTIVE,
			fields: 'id,full_name,first_name,last_name,email,Current_Shift__s,Department,Medical_Degrees,Specialization,image_link,Availability_Status,Availability_Start,Availability_End,Session_Slots,zuid,profile,role'
		}
	});

	if (!pmsRes.ok && (!pmsRes.data || !Array.isArray(pmsRes.data.users))) {
		throw new Error(pmsRes.data?.message || `Failed to fetch doctors from PMS (HTTP ${pmsRes.status})`);
	}

	const users = pmsRes.data?.users || [];
	return users
		.filter(u => u.profile?.name === 'Doctor' || u.role?.name === 'Doctor' || u.Department || u.Medical_Degrees || u.profile?.name === 'Administrator' || u.role?.name === 'CEO / MD')
		.sort((a, b) => {
			const aDoc = (a.role?.name === 'Doctor' || a.profile?.name === 'Doctor' || a.Department) ? 1 : 0;
			const bDoc = (b.role?.name === 'Doctor' || b.profile?.name === 'Doctor' || b.Department) ? 1 : 0;
			return bDoc - aDoc;
		})
		.map(u => {
			const zuid = u.zuid || null;
			if (u.id && zuid && doctorZuidCache) {
				doctorZuidCache.set(String(u.id), String(zuid));
			}
			const image = u.image_link || (zuid ? `${ZOHO_PROFILE_URL}/file?ID=${zuid}&fs=thumb` : `/server/pms_appointment_service/doctor-image?id=${u.id}`);
			const medicalDegrees = u.Medical_Degrees || u.medical_degrees || u.qualification || '';
			return {
				id: u.id,
				name: u.full_name,
				email: u.email,
				role: u.role?.name || u.profile?.name || DEFAULT_DOCTOR_ROLE,
				medicalDegrees: medicalDegrees || '',
				department: u.Department || '',
				specialization: u.Specialization || '',
				zuid,
				image
			};
		});
}

/**
 * Extracts and normalizes service member practitioner references.
 */
function extractServiceMembers(rawMembers) {
	if (!Array.isArray(rawMembers)) return [];
	return rawMembers
		.map(m => ({ id: m.Members?.id || m.id, name: m.Members?.name || '' }))
		.filter(m => m.id);
}

/**
 * Formats a raw Services__s record into standard DTO format.
 */
function formatServiceItem(s, members = []) {
	return {
		id: s[SERVICE_FIELDS.ID] || s.id,
		name: s[SERVICE_FIELDS.SERVICE_NAME] || s[SERVICE_FIELDS.NAME] || DEFAULT_SERVICE_NAME,
		duration: Number(s[SERVICE_FIELDS.DURATION]) || DEFAULT_SERVICE_DURATION,
		description: s[SERVICE_FIELDS.DESCRIPTION] || '',
		price: s[SERVICE_FIELDS.PRICE] || 0,
		status: s[SERVICE_FIELDS.STATUS] || DEFAULT_SERVICE_STATUS,
		location: s[SERVICE_FIELDS.LOCATION] || DEFAULT_SERVICE_LOCATION,
		members,
		doctorCount: members.length
	};
}

/**
 * Fetches services from Services__s in PMS via ZRC COQL with ZRC GET fallback.
 */
async function getServices() {
	let services = [];

	// Attempt 1: Fast single-query COQL for Services__s with Members
	try {
		const coqlRes = await zrc.coql(
			`select ${SERVICE_FIELDS.ID}, ${SERVICE_FIELDS.SERVICE_NAME}, ${SERVICE_FIELDS.DURATION}, ${SERVICE_FIELDS.DESCRIPTION}, ${SERVICE_FIELDS.PRICE}, ${SERVICE_FIELDS.STATUS}, ${SERVICE_FIELDS.LOCATION}, ${SERVICE_FIELDS.MEMBERS} from ${MODULES.SERVICES} where ${SERVICE_FIELDS.STATUS} = 'Active'`
		);
		if (coqlRes.ok && Array.isArray(coqlRes.data?.data) && coqlRes.data.data.length > 0) {
			services = coqlRes.data.data.map(s => formatServiceItem(s, extractServiceMembers(s[SERVICE_FIELDS.MEMBERS] || s.Members)));
		}
	} catch (coqlErr) {
		console.warn('Services COQL failed, using ZRC GET fallback');
	}

	// Attempt 2: Standard ZRC GET fallback if COQL was unsupported or empty
	if (services.length === 0) {
		const pmsRes = await zrc.get(`/crm/v8/${MODULES.SERVICES}`, {
			params: {
				fields: `${SERVICE_FIELDS.ID},${SERVICE_FIELDS.SERVICE_NAME},${SERVICE_FIELDS.DURATION},${SERVICE_FIELDS.DESCRIPTION},${SERVICE_FIELDS.PRICE},${SERVICE_FIELDS.STATUS},${SERVICE_FIELDS.LOCATION}`,
				per_page: 100
			}
		});

		if (!pmsRes.ok && (!pmsRes.data || !Array.isArray(pmsRes.data.data))) {
			throw new Error(pmsRes.data?.message || `Failed to fetch services from PMS (HTTP ${pmsRes.status})`);
		}

		const rawList = pmsRes.data?.data || [];
		services = await Promise.all(rawList.map(async s => {
			let members = [];
			try {
				const dRes = await zrc.get(`/crm/v8/${MODULES.SERVICES}/${s.id}`);
				members = extractServiceMembers(dRes.data?.data?.[0]?.Members);
			} catch (mErr) {
				console.warn('Could not fetch Members for service');
			}
			return formatServiceItem(s, members);
		}));
	}

	return services;
}

/**
 * Fetches live schedule configuration from Zoho PMS CRM (Business Hours, Holidays, Unavailability, Shift Hours).
 */
async function getScheduleConfig() {
	const [bhRes, holRes, unavailRes, shiftRes] = await Promise.allSettled([
		zrc.get('/crm/v8/settings/business_hours'),
		zrc.get('/crm/v8/settings/holidays'),
		zrc.get('/crm/v8/settings/users_unavailability'),
		zrc.get('/crm/v8/settings/business_hours/shift_hours')
	]);

	let businessHours = null;
	if (bhRes.status === 'fulfilled' && bhRes.value.ok) {
		const bhData = bhRes.value.data;
		businessHours = bhData?.business_hours || (Array.isArray(bhData?.data) ? bhData.data[0] : null) || null;
	}

	let holidays = [];
	if (holRes.status === 'fulfilled' && holRes.value.ok) {
		const holData = holRes.value.data;
		holidays = holData?.holidays || (Array.isArray(holData?.data) ? holData.data : []) || [];
	}

	let unavailabilities = [];
	if (unavailRes.status === 'fulfilled' && unavailRes.value.ok) {
		const uData = unavailRes.value.data;
		unavailabilities = uData?.users_unavailability || uData?.user_unavailability || (Array.isArray(uData?.data) ? uData.data : []) || [];
	}

	let shiftHours = [];
	if (shiftRes.status === 'fulfilled' && shiftRes.value.ok) {
		const sData = shiftRes.value.data;
		shiftHours = sData?.shift_hours || (Array.isArray(sData?.data) ? sData.data : []) || [];
	}

	return {
		businessHours,
		holidays,
		unavailabilities,
		shiftHours
	};
}

const PRIORITIES = Object.freeze(['Routine', 'Urgent', 'ASAP', 'STAT']);

/**
 * Returns available appointment priority picklist options.
 */
function getPriorities() {
	return PRIORITIES;
}

module.exports = {
	formatTime,
	formatBusinessHours,
	getHospitalInfo,
	getHospitalDetails: getHospitalInfo,
	getDoctors,
	getDoctorsList: getDoctors,
	getServices,
	getServicesList: getServices,
	getScheduleConfig,
	getScheduleConfiguration: getScheduleConfig,
	getPriorities
};
