'use strict';

const { zrc } = require('../zohoClient');
const {
	DEFAULT_COUNTRY_CODE,
	APPOINTMENT_TARGET_MODE,
	MODULES,
	PATIENT_FIELDS,
	CONTACT_FIELDS
} = require('../config');

// Intentional Business Defaults
const DEFAULT_PATIENT_TYPE = 'OP';
const DEFAULT_PATIENT_LAST_NAME = 'Patient';
const DEFAULT_PROSPECT_LAST_NAME = 'Prospect';

/**
 * Normalizes any mobile number to a clean 10-digit string.
 */
function normalizeMobile(mobileNumber) {
	return mobileNumber ? String(mobileNumber).replace(/\D/g, '').slice(-10) : '';
}

/**
 * Formats raw CRM Patient record into standard DTO structure.
 */
function formatPatient(p, cleanMobile) {
	return {
		id: p[PATIENT_FIELDS.ID] || p.id,
		name: p[PATIENT_FIELDS.FULL_NAME] || `${p[PATIENT_FIELDS.FIRST_NAME] || ''} ${p[PATIENT_FIELDS.LAST_NAME] || ''}`.trim() || p[PATIENT_FIELDS.NAME] || '',
		firstName: p[PATIENT_FIELDS.FIRST_NAME] || '',
		lastName: p[PATIENT_FIELDS.LAST_NAME] || '',
		mobile: cleanMobile,
		email: p[PATIENT_FIELDS.EMAIL] || ''
	};
}

/**
 * Searches Patient module by mobile number using COQL with criteria search fallback.
 */
async function searchPatientByMobile(mobileNumber) {
	const cleanMobile = normalizeMobile(mobileNumber);
	if (!cleanMobile) return null;

	// 1. Try COQL query first (matches with or without country code prefix, e.g. +91)
	try {
		const coqlRes = await zrc.coql(
			`select ${PATIENT_FIELDS.ID}, ${PATIENT_FIELDS.NAME}, ${PATIENT_FIELDS.FULL_NAME}, ${PATIENT_FIELDS.FIRST_NAME}, ${PATIENT_FIELDS.LAST_NAME}, ${PATIENT_FIELDS.MOBILE}, ${PATIENT_FIELDS.EMAIL} from ${MODULES.PATIENT} where ${PATIENT_FIELDS.MOBILE} like '%${cleanMobile}'`
		);
		if (coqlRes.ok && coqlRes.data?.data?.[0]) {
			return formatPatient(coqlRes.data.data[0], cleanMobile);
		}
	} catch (coqlErr) {
		console.warn('ZRC Patient COQL search error, falling back to criteria search');
	}

	// 2. Fallback to standard ZRC criteria search if COQL returns no rows or fails
	try {
		const sRes = await zrc.get(`/crm/v8/${MODULES.PATIENT}/search`, {
			params: { criteria: `(${PATIENT_FIELDS.MOBILE}:equals:${cleanMobile})` }
		});
		if (sRes.ok && sRes.data?.data?.[0]) {
			return formatPatient(sRes.data.data[0], cleanMobile);
		}
	} catch (fallbackErr) {
		console.warn('Patient fallback search error');
	}

	return null;
}

/**
 * Searches Contacts module by mobile number using COQL with search API fallback.
 */
async function searchContactByMobile(mobileNumber) {
	const cleanMobile = normalizeMobile(mobileNumber);
	if (!cleanMobile) return null;

	// 1. Try COQL query first (matches with or without country code prefix)
	try {
		const coqlRes = await zrc.coql(
			`select ${CONTACT_FIELDS.ID}, ${CONTACT_FIELDS.FULL_NAME}, ${CONTACT_FIELDS.PHONE}, ${CONTACT_FIELDS.MOBILE} from ${MODULES.CONTACTS} where ${CONTACT_FIELDS.PHONE} like '%${cleanMobile}' or ${CONTACT_FIELDS.MOBILE} like '%${cleanMobile}'`
		);
		if (coqlRes.ok && coqlRes.data?.data?.[0]?.id) {
			const c = coqlRes.data.data[0];
			return {
				id: String(c[CONTACT_FIELDS.ID] || c.id),
				name: c[CONTACT_FIELDS.FULL_NAME] || '',
				mobile: c[CONTACT_FIELDS.MOBILE] || c[CONTACT_FIELDS.PHONE] || cleanMobile
			};
		}
	} catch (coqlErr) {
		console.warn('ZRC Contacts COQL search error, falling back to search API');
	}

	// 2. Fallback to standard ZRC Contacts search API
	try {
		const sRes = await zrc.get(`/crm/v8/${MODULES.CONTACTS}/search`, {
			params: { phone: cleanMobile }
		});
		if (sRes.ok && sRes.data?.data?.[0]?.id) {
			const c = sRes.data.data[0];
			return {
				id: String(c[CONTACT_FIELDS.ID] || c.id),
				name: c[CONTACT_FIELDS.FULL_NAME] || `${c[CONTACT_FIELDS.FIRST_NAME] || ''} ${c[CONTACT_FIELDS.LAST_NAME] || ''}`.trim(),
				mobile: c[CONTACT_FIELDS.MOBILE] || c[CONTACT_FIELDS.PHONE] || cleanMobile
			};
		}
	} catch (fallbackErr) {
		console.warn('Contacts fallback search error');
	}

	return null;
}

/**
 * Registers a new Patient record in the Patient module via ZRC POST.
 */
async function createPatient({ firstName, lastName, fullName, mobileNumber, email }) {
	const cleanMobile = normalizeMobile(mobileNumber);
	const fName = firstName || (fullName ? fullName.split(' ')[0] : '') || '';
	const lName = lastName || (fullName ? fullName.split(' ').slice(1).join(' ') : '') || fName || DEFAULT_PATIENT_LAST_NAME;
	const formattedMobile = cleanMobile ? `${DEFAULT_COUNTRY_CODE}${cleanMobile}` : (mobileNumber || '');

	const newPatientRes = await zrc.post(`/crm/v8/${MODULES.PATIENT}`, {
		data: [{
			[PATIENT_FIELDS.FIRST_NAME]: fName,
			[PATIENT_FIELDS.LAST_NAME]: lName,
			[PATIENT_FIELDS.FULL_NAME]: fullName || `${fName} ${lName}`.trim(),
			[PATIENT_FIELDS.MOBILE]: formattedMobile,
			Patient_Type: DEFAULT_PATIENT_TYPE,
			...(email ? { [PATIENT_FIELDS.EMAIL]: email } : {})
		}],
		trigger: ['workflow']
	});

	const createdPatientId = newPatientRes.data?.data?.[0]?.details?.id;
	if (createdPatientId) {
		return {
			id: String(createdPatientId),
			module: { api_name: MODULES.PATIENT },
			isProspect: false
		};
	}

	throw new Error(`Could not register new Patient in PMS: ${newPatientRes.data?.data?.[0]?.message || 'Unknown error'}`);
}

/**
 * Registers a new prospect in Contacts module via ZRC POST.
 * Uses 'Lead_Source': 'Online Appointment Booking' as established in PMS Widget workflows.
 */
async function createContact({ firstName, lastName, fullName, mobileNumber, email }) {
	const cleanMobile = normalizeMobile(mobileNumber);
	const fName = firstName || (fullName ? fullName.split(' ')[0] : '') || '';
	const lName = lastName || (fullName ? fullName.split(' ').slice(1).join(' ') : '') || fName || DEFAULT_PROSPECT_LAST_NAME;
	const formattedMobile = cleanMobile ? `${DEFAULT_COUNTRY_CODE}${cleanMobile}` : (mobileNumber || '');

	const newContactRes = await zrc.post(`/crm/v8/${MODULES.CONTACTS}`, {
		data: [{
			[CONTACT_FIELDS.FIRST_NAME]: fName,
			[CONTACT_FIELDS.LAST_NAME]: lName,
			[CONTACT_FIELDS.MOBILE]: formattedMobile,
			[CONTACT_FIELDS.PHONE]: formattedMobile,
			...(email ? { [CONTACT_FIELDS.EMAIL]: email } : {}),
			[CONTACT_FIELDS.LEAD_SOURCE]: 'Online Appointment Booking'
		}],
		trigger: ['workflow']
	});

	const createdContactId = newContactRes.data?.data?.[0]?.details?.id;
	if (createdContactId) {
		return {
			id: String(createdContactId),
			module: { api_name: MODULES.CONTACTS },
			isProspect: true
		};
	}

	throw new Error(`Could not register prospect Contact in PMS: ${newContactRes.data?.data?.[0]?.message || 'Unknown error'}`);
}

/**
 * Resolves the Appointment_For target using ZRC / COQL:
 * 1. If matchedPatientId is provided -> returns existing Patient reference (isProspect: false)
 * 2. If existing Patient is found via mobile search -> returns existing Patient reference (isProspect: false)
 * 3. Case A: If APPOINTMENT_TARGET_MODE === 'patient_only' -> registers new Patient
 * 4. Case B: If APPOINTMENT_TARGET_MODE === 'auto' or 'prospect':
 *    a. Checks if an existing Contact exists for this mobile -> reuse Contact (isProspect: true)
 *    b. Creates a new prospect Contact in Contacts module -> (isProspect: true)
 */
async function resolveAppointmentFor({ patientName, firstName, lastName, mobileNumber, email, matchedPatientId }) {
	const fullName = (patientName || `${firstName || ''} ${lastName || ''}`).trim();
	const cleanMobile = normalizeMobile(mobileNumber);

	// 1. If explicitly matched to an existing Patient
	if (matchedPatientId) {
		return {
			id: String(matchedPatientId),
			module: { api_name: MODULES.PATIENT },
			isProspect: false
		};
	}

	// 2. Search Patient module using COQL / criteria search
	if (cleanMobile) {
		try {
			const existingPatient = await searchPatientByMobile(cleanMobile);
			if (existingPatient?.id) {
				return {
					id: String(existingPatient.id),
					module: { api_name: MODULES.PATIENT },
					isProspect: false
				};
			}
		} catch (err) {
			console.warn('Patient search error in resolveAppointmentFor');
		}
	}

	// 3. Case A: If configured for patient-only mode, create Patient directly
	if (APPOINTMENT_TARGET_MODE === 'patient_only') {
		return createPatient({
			firstName,
			lastName,
			fullName,
			mobileNumber,
			email
		});
	}

	// 4. Case B: Prospect flow ('auto' or 'prospect')
	// Check if Contact already exists for this mobile number
	if (cleanMobile) {
		try {
			const existingContact = await searchContactByMobile(cleanMobile);
			if (existingContact?.id) {
				return {
					id: String(existingContact.id),
					module: { api_name: MODULES.CONTACTS },
					isProspect: true
				};
			}
		} catch (cErr) {
			console.warn('Contact search error in resolveAppointmentFor');
		}
	}

	// If no existing contact found, register new prospect Contact
	return createContact({
		firstName,
		lastName,
		fullName,
		mobileNumber,
		email
	});
}

module.exports = {
	normalizeMobile,
	formatPatient,
	searchPatientByMobile,
	findPatientByMobile: searchPatientByMobile,
	searchContactByMobile,
	createContact,
	createPatient,
	resolveAppointmentFor
};
