'use strict';

const { zrc } = require('../zohoClient');
const { pad } = require('../utils/http');
const {
	TIMEZONE_OFFSET,
	MODULES,
	APPOINTMENT_FIELDS,
	SERVICE_FIELDS,
	USER_TYPES
} = require('../config');
const { resolveAppointmentFor, createPatient } = require('./patientService');

// Intentional Business Defaults
const DEFAULT_APPOINTMENT_DURATION = 30;
const DEFAULT_START_TIME = '10:00';
const DEFAULT_PRIORITY = 'Routine';
const DEFAULT_STATUS = 'Scheduled';
const DEFAULT_SERVICE_NAME = 'Consultation';
const DEFAULT_CHIEF_COMPLAINT = 'Clinical Consultation';
const DEFAULT_LOCATION = 'Business Address';

/**
 * Formats raw appointment record for booked slot checking.
 */
function formatBookedSlot(a) {
	return {
		id: a.id,
		startTime: a[APPOINTMENT_FIELDS.START_TIME] || a.Appointment_Start_Time,
		endTime: a[APPOINTMENT_FIELDS.END_TIME] || a.Appointment_End_Time,
		status: a[APPOINTMENT_FIELDS.STATUS] || a.Status,
		doctorId: a[APPOINTMENT_FIELDS.OWNER]?.id || a[APPOINTMENT_FIELDS.PRACTITIONER]?.id || a[APPOINTMENT_FIELDS.DOCTOR]?.id || null
	};
}

/**
 * Checks if appointment matches optional doctor ID parameter.
 */
function matchesDoctor(a, doctorIdParam) {
	if (!doctorIdParam) return true;
	const docId = a[APPOINTMENT_FIELDS.OWNER]?.id || a[APPOINTMENT_FIELDS.PRACTITIONER]?.id || a[APPOINTMENT_FIELDS.DOCTOR]?.id;
	return !docId || String(docId) === String(doctorIdParam);
}

/**
 * Retrieves booked appointment slots for a given date and optional doctor ID.
 */
async function getBookedSlots(dateParam, doctorIdParam) {
	let booked = [];
	let coqlSucceeded = false;

	// Attempt 1: Target COQL query for appointments on this date
	if (dateParam) {
		try {
			const coqlQuery = `select ${APPOINTMENT_FIELDS.ID}, ${APPOINTMENT_FIELDS.START_TIME}, ${APPOINTMENT_FIELDS.END_TIME}, ${APPOINTMENT_FIELDS.STATUS}, ${APPOINTMENT_FIELDS.OWNER}, ${APPOINTMENT_FIELDS.SERVICE_NAME} from ${MODULES.APPOINTMENTS} where ${APPOINTMENT_FIELDS.STATUS} != 'Cancelled' and ${APPOINTMENT_FIELDS.START_TIME} between '${dateParam}T00:00:00${TIMEZONE_OFFSET}' and '${dateParam}T23:59:59${TIMEZONE_OFFSET}'`;
			const coqlRes = await zrc.coql(coqlQuery);
			if (coqlRes.ok && Array.isArray(coqlRes.data?.data)) {
				booked = coqlRes.data.data
					.filter(a => matchesDoctor(a, doctorIdParam))
					.map(formatBookedSlot);
				coqlSucceeded = true;
			}
		} catch (cErr) {
			console.warn('Booked slots COQL failed, using ZRC fallback');
		}
	}

	// Attempt 2: Only fallback if COQL query actually failed (NOT when a day legitimately has 0 bookings)
	if (!coqlSucceeded) {
		try {
			const searchParams = {
				fields: `${APPOINTMENT_FIELDS.ID},${APPOINTMENT_FIELDS.START_TIME},${APPOINTMENT_FIELDS.END_TIME},${APPOINTMENT_FIELDS.STATUS},${APPOINTMENT_FIELDS.OWNER},${APPOINTMENT_FIELDS.SERVICE_NAME},${APPOINTMENT_FIELDS.PRACTITIONER},${APPOINTMENT_FIELDS.DOCTOR}`,
				per_page: 200
			};
			if (dateParam) {
				searchParams.criteria = `(${APPOINTMENT_FIELDS.START_TIME}:starts_with:${dateParam})`;
			}

			const aRes = await zrc.get(`/crm/v8/${MODULES.APPOINTMENTS}`, { params: searchParams });
			const aList = aRes.data?.data || [];
			booked = aList
				.filter(a => (!dateParam || (a[APPOINTMENT_FIELDS.START_TIME] && a[APPOINTMENT_FIELDS.START_TIME].startsWith(dateParam))) && matchesDoctor(a, doctorIdParam))
				.map(formatBookedSlot);
		} catch (fallbackErr) {
			console.warn('Booked slots fallback search failed');
		}
	}

	return booked;
}

/**
 * Extracts and normalizes service member practitioner IDs.
 */
function extractServiceMemberIds(rawMembers) {
	if (!Array.isArray(rawMembers)) return [];
	return rawMembers
		.map(m => String(m.Members?.id || m.id))
		.filter(Boolean);
}

/**
 * Applies fetched CRM Services__s fields to the service details object.
 */
function applyServiceDetails(target, sData) {
	if (!sData) return;
	target.serviceId = sData[SERVICE_FIELDS.ID] || sData.id || target.serviceId;
	target.serviceName = (sData[SERVICE_FIELDS.SERVICE_NAME] || sData[SERVICE_FIELDS.NAME] || target.serviceName || '').trim();
	target.serviceDuration = Number(sData[SERVICE_FIELDS.DURATION]) || target.serviceDuration;
	if (Array.isArray(sData[SERVICE_FIELDS.MEMBERS])) {
		target.serviceMembers = extractServiceMemberIds(sData[SERVICE_FIELDS.MEMBERS]);
	}
}

/**
 * Resolves Service ID, Name, Duration, and assigned practitioner Members.
 */
async function resolveServiceDetails(service, department, duration) {
	const result = {
		serviceId: (service && typeof service === 'object' ? service.id : null) || 
		           (department && typeof department === 'object' ? department.id : null) || 
		           (typeof service === 'string' && /^\d+$/.test(service) ? service : null) || 
		           (typeof department === 'string' && /^\d+$/.test(department) ? department : null),
		serviceName: '',
		serviceDuration: duration || (service && service.duration) || (department && department.duration) || DEFAULT_APPOINTMENT_DURATION,
		serviceMembers: []
	};

	const queryName = (typeof service === 'string' && !/^\d+$/.test(service) ? service : '') ||
	                  (typeof department === 'string' && !/^\d+$/.test(department) ? department : '') ||
	                  (service?.name || department?.name || service?.Service_Name || department?.Service_Name || '');

	// 1. If serviceId is not known, fetch services from CRM to find matching or default service
	if (!result.serviceId) {
		try {
			const sRes = await zrc.get(`/crm/v8/${MODULES.SERVICES}`, {
				params: { fields: `${SERVICE_FIELDS.ID},${SERVICE_FIELDS.SERVICE_NAME},${SERVICE_FIELDS.NAME},${SERVICE_FIELDS.DURATION},${SERVICE_FIELDS.STATUS}`, per_page: 20 }
			});
			const allServices = sRes.data?.data || [];
			let matched = null;
			if (queryName) {
				const qLower = queryName.toLowerCase();
				matched = allServices.find(s => (s[SERVICE_FIELDS.SERVICE_NAME] && s[SERVICE_FIELDS.SERVICE_NAME].toLowerCase().includes(qLower)) || 
				                                (s[SERVICE_FIELDS.NAME] && s[SERVICE_FIELDS.NAME].toLowerCase().includes(qLower)));
			}
			if (!matched) {
				matched = allServices.find(s => s[SERVICE_FIELDS.STATUS] === 'Available') || allServices[0];
			}
			if (matched) {
				result.serviceId = matched[SERVICE_FIELDS.ID] || matched.id;
				result.serviceName = matched[SERVICE_FIELDS.SERVICE_NAME] || matched[SERVICE_FIELDS.NAME];
				result.serviceDuration = Number(matched[SERVICE_FIELDS.DURATION]) || result.serviceDuration;
			}
		} catch (sErr) {
			console.warn('Could not lookup default service');
		}
	}

	// 2. ALWAYS fetch the single service details by ID to extract Members!
	// In Zoho CRM v8, the list endpoint does NOT return subform Members; only GET /Services__s/{id} does.
	if (result.serviceId) {
		try {
			const dRes = await zrc.get(`/crm/v8/${MODULES.SERVICES}/${result.serviceId}`);
			const sData = dRes.data?.data?.[0];
			if (sData) {
				applyServiceDetails(result, sData);
			}
		} catch (dErr) {
			console.warn('Could not fetch single service details for Members');
		}
	}

	return result;
}

/**
 * Calculates start and end ISO datetime strings (+05:30) for an appointment.
 */
function calculateAppointmentTimes(visitDate, startTime, serviceDuration) {
	const timePart = startTime ? startTime.replace(/\s*(AM|PM)/i, '').trim() : DEFAULT_START_TIME;
	const isPM = startTime && startTime.toUpperCase().includes('PM');
	let [hrs, mins] = timePart.split(':').map(Number);
	if (isPM && hrs < 12) hrs += 12;
	if (!isPM && startTime && startTime.toUpperCase().includes('AM') && hrs === 12) hrs = 0;
	const safeHrs = (hrs !== undefined && !isNaN(hrs)) ? hrs : 10;
	const safeMins = (mins !== undefined && !isNaN(mins)) ? mins : 0;
	const startDateTimeStr = `${visitDate}T${pad(safeHrs)}:${pad(safeMins)}:00${TIMEZONE_OFFSET}`;

	const endDate = new Date(new Date(startDateTimeStr).getTime() + (Number(serviceDuration) || DEFAULT_APPOINTMENT_DURATION) * 60 * 1000);
	const endDateTimeStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00${TIMEZONE_OFFSET}`;

	return { startDateTimeStr, endDateTimeStr };
}

/**
 * Resolves doctor/owner ID adhering to PMS rules (Owner must be a member of service if members exist, and must be an active CRM user).
 */
async function resolveAppointmentDoctor(doctor, doctorId, serviceMembers) {
	let targetDocId = (doctor && typeof doctor === 'object' ? doctor.id : null) || 
	                  (typeof doctor === 'string' && /^\d+$/.test(doctor) ? doctor : null) || 
	                  doctorId;

	let activeUsers = [];
	try {
		const uRes = await zrc.get(`/crm/v8/${MODULES.USERS}`, { params: { type: USER_TYPES.ACTIVE, per_page: 50 } });
		activeUsers = uRes.data?.users || [];
	} catch (uErr) {
		console.warn('Could not fetch active users for doctor resolution');
	}

	const activeUserIds = activeUsers.map(u => String(u.id));

	// If a doctor was requested and is an active user
	if (targetDocId && activeUserIds.includes(String(targetDocId))) {
		if (Array.isArray(serviceMembers) && serviceMembers.length > 0) {
			if (serviceMembers.includes(String(targetDocId))) {
				return String(targetDocId);
			}
			const validMember = serviceMembers.find(m => activeUserIds.includes(String(m)));
			if (validMember) {
				return String(validMember);
			}
		}
		return String(targetDocId);
	}

	// If no valid targetDocId, pick an active user from serviceMembers
	if (Array.isArray(serviceMembers) && serviceMembers.length > 0) {
		const validMember = serviceMembers.find(m => activeUserIds.includes(String(m)));
		if (validMember) {
			return String(validMember);
		}
	}

	// Fallback to active clinical doctor or first active user
	const clinicalUser = activeUsers.find(u => u.profile?.name === 'Doctor' || u.role?.name === 'Doctor') || activeUsers[0];
	return clinicalUser?.id ? String(clinicalUser.id) : null;
}

/**
 * Validates, prepares, and inserts an appointment in PMS (Appointments__s).
 */
async function createAppointment(body = {}) {
	// Flexible field alias normalization for Zoho Sites native forms & Webhooks
	const firstName = body.firstName || body.First_Name || body.first_name || (typeof body.Name === 'object' ? body.Name.First : null) || '';
	const lastName = body.lastName || body.Last_Name || body.last_name || (typeof body.Name === 'object' ? body.Name.Last : null) || '';
	const patientName = body.patientName || body.patient_name || (typeof body.Name === 'string' ? body.Name : null) || `${firstName} ${lastName}`.trim();
	const mobileNumber = body.mobileNumber || body.mobile_number || body.mobile || body.phone || body.Phone || body.Phone_Number || (typeof body.Phone === 'object' ? body.Phone.Number : null) || '';
	const email = body.email || body.Email || '';
	const visitDate = body.visitDate || body.visit_date || body.date || body.Date || body.Appointment_Date || body.appointment_date || '';
	const startTime = body.startTime || body.start_time || body.time || body.Time || body.Preferred_Time || body.preferred_time || '10:00 AM';
	const department = body.department || body.Department || body.service || body.Service || body.Specialty || '';
	const service = body.service || body.Service || department;
	const chiefComplaint = body.chiefComplaint || body.chief_complaint || body.complaint || body.reason || body.Reason || body.symptoms || body.Symptoms || body.message || body.Message || 'General Consultation';
	const doctor = body.doctor || body.Doctor;
	const duration = body.duration || body.Duration;
	const priority = body.priority || body.Priority;
	const appointmentName = body.appointmentName || body.Appointment_Name;
	const additionalInfo = body.additionalInfo || body.description || body.Description;
	const matchedPatientId = body.matchedPatientId || body.matchedPatient?.id || null;

	const fullName = patientName.trim();
	const cleanMobile = String(mobileNumber).replace(/\D/g, '').slice(-10);

	if (!fullName || fullName.length < 2) {
		return {
			status: 400,
			data: { ok: false, error: 'A valid patient name (minimum 2 characters) is required.' }
		};
	}

	if (!cleanMobile || cleanMobile.length !== 10) {
		return {
			status: 400,
			data: { ok: false, error: 'A valid 10-digit mobile number is required.' }
		};
	}

	if (!visitDate) {
		return {
			status: 400,
			data: { ok: false, error: 'Appointment date is required.' }
		};
	}

	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(visitDate)) {
		return {
			status: 400,
			data: { ok: false, error: 'Invalid appointment date format (expected YYYY-MM-DD).' }
		};
	}

	// Reject past calendar dates
	const todayDateStr = new Date().toISOString().slice(0, 10);
	if (visitDate < todayDateStr) {
		return {
			status: 400,
			data: { ok: false, error: 'Appointment date cannot be in the past.' }
		};
	}

	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
		return {
			status: 400,
			data: { ok: false, error: 'Please enter a valid email address.' }
		};
	}

	// 1. Resolve Appointment_For target via ZRC / COQL (Supports Contacts prospect flow or Patient)
	let apptFor = await resolveAppointmentFor({
		firstName,
		lastName,
		patientName: fullName,
		mobileNumber,
		email,
		matchedPatientId: matchedPatientId || body.matchedPatient?.id || null
	});

	if (!apptFor || !apptFor.id) {
		return {
			status: 400,
			data: {
				ok: false,
				error: 'Could not link or register Patient/Contact in PMS for this appointment.'
			}
		};
	}

	// 2. Resolve Service / Department ID & valid Members
	const {
		serviceId,
		serviceName,
		serviceDuration,
		serviceMembers
	} = await resolveServiceDetails(service, department, duration);

	// 3. Format DateTimes: "YYYY-MM-DDTHH:mm:00+05:30"
	const { startDateTimeStr, endDateTimeStr } = calculateAppointmentTimes(visitDate, startTime, serviceDuration);

	// 4. Construct record for Appointments__s
	const cleanServiceName = (serviceName && String(serviceName).trim() !== 'null' && String(serviceName).trim() !== 'undefined')
		? String(serviceName).trim()
		: DEFAULT_SERVICE_NAME;
	const rawApptName = typeof appointmentName === 'string' ? appointmentName.trim() : '';
	const isCorrupted = !rawApptName ||
		rawApptName.startsWith('null -') ||
		rawApptName.startsWith('undefined -') ||
		rawApptName.startsWith('null —') ||
		rawApptName.startsWith('undefined —');

	const finalAppointmentName = !isCorrupted ? rawApptName : `${cleanServiceName} - ${fullName}`;

	const appointmentRecord = {
		[APPOINTMENT_FIELDS.NAME]: finalAppointmentName,
		[APPOINTMENT_FIELDS.APPOINTMENT_FOR]: {
			id: String(apptFor.id),
			module: { api_name: apptFor.module.api_name }
		},
		[APPOINTMENT_FIELDS.LOCATION]: DEFAULT_LOCATION,
		[APPOINTMENT_FIELDS.START_TIME]: startDateTimeStr,
		[APPOINTMENT_FIELDS.END_TIME]: endDateTimeStr,
		[APPOINTMENT_FIELDS.STATUS]: DEFAULT_STATUS,
		[APPOINTMENT_FIELDS.PRIORITY]: priority || DEFAULT_PRIORITY,
		Chief_Complaint: chiefComplaint || DEFAULT_CHIEF_COMPLAINT,
		...(additionalInfo ? { [APPOINTMENT_FIELDS.DESCRIPTION]: additionalInfo } : {})
	};

	if (serviceId) {
		appointmentRecord[APPOINTMENT_FIELDS.SERVICE_NAME] = { id: String(serviceId) };
	}

	const targetDocId = await resolveAppointmentDoctor(doctor, body.doctorId, serviceMembers);
	if (targetDocId) {
		appointmentRecord[APPOINTMENT_FIELDS.OWNER] = { id: targetDocId };
	}

	// 5. Conflict Prevention: ensure slot is not already booked for this doctor
	const bookedList = await getBookedSlots(visitDate, targetDocId);
	const reqStartMs = new Date(startDateTimeStr).getTime();
	const reqEndMs = new Date(endDateTimeStr).getTime();

	const hasConflict = bookedList.some(slot => {
		if (['Cancelled', 'No Show', 'Rescheduled'].includes(slot.status)) return false;
		if (!slot.startTime || !slot.endTime) return false;
		const slotStartMs = new Date(slot.startTime).getTime();
		const slotEndMs = new Date(slot.endTime).getTime();
		// Overlap check
		return reqStartMs < slotEndMs && reqEndMs > slotStartMs;
	});

	if (hasConflict) {
		return {
			status: 409,
			data: {
				ok: false,
				error: 'This appointment slot is already booked. Please choose another time slot.'
			}
		};
	}

	// 6. Insert record into Appointments__s via ZRC POST
	let insertRes = await zrc.post(`/crm/v8/${MODULES.APPOINTMENTS}`, {
		data: [appointmentRecord],
		trigger: ['workflow', 'approval']
	});

	let insertData = insertRes.data || {};
	let result = insertData.data?.[0];

	// Auto-fallback: If PMS schema for Appointments__s rejects Contacts for Appointment_For
	// (e.g. this clinic requires Patient specifically), automatically create a Patient and retry.
	if (result?.code !== 'SUCCESS' && apptFor.module?.api_name === MODULES.CONTACTS) {
		const errMsg = `${result?.message || ''} ${insertData?.message || ''} ${JSON.stringify(result?.details || '')}`.toLowerCase();
		const isLookupRestriction = result?.code === 'INVALID_DATA' ||
			errMsg.includes('appointment_for') ||
			errMsg.includes('invalid') ||
			errMsg.includes('lookup') ||
			errMsg.includes('patient');

		if (isLookupRestriction) {
			console.warn('Appointment_For rejected Contacts target, auto-falling back to Patient module');
			try {
				const fallbackPatient = await createPatient({
					firstName,
					lastName,
					fullName,
					mobileNumber,
					email
				});

				if (fallbackPatient?.id) {
					apptFor = fallbackPatient;
					appointmentRecord[APPOINTMENT_FIELDS.APPOINTMENT_FOR] = {
						id: String(fallbackPatient.id),
						module: { api_name: MODULES.PATIENT }
					};

					insertRes = await zrc.post(`/crm/v8/${MODULES.APPOINTMENTS}`, {
						data: [appointmentRecord],
						trigger: ['workflow', 'approval']
					});
					insertData = insertRes.data || {};
					result = insertData.data?.[0];
				}
			} catch (fbErr) {
				console.error('Auto-fallback createPatient failed');
			}
		}
	}

	if (result?.code === 'SUCCESS') {
		const createdRecordId = result.details?.id;
		let autoNumber = null;

		// Fetch newly created record from CRM to get the auto-generated Appointment ID (e.g. "APPT-147")
		if (createdRecordId) {
			try {
				const fetchRes = await zrc.get(`/crm/v8/${MODULES.APPOINTMENTS}/${createdRecordId}`);
				const createdData = fetchRes.data?.data?.[0];
				if (createdData) {
					autoNumber = createdData[APPOINTMENT_FIELDS.APPOINTMENT_ID] ||
						createdData.Appointment_ID ||
						createdData.Appointment_Number ||
						createdData.Appointment_No ||
						createdData.Auto_Number ||
						null;
				}
			} catch (fetchErr) {
				console.warn('Could not fetch created appointment auto-number:', fetchErr.message);
			}
		}

		const resolvedAppointmentId = autoNumber || createdRecordId;

		return {
			status: 200,
			data: {
				ok: true,
				appointmentId: resolvedAppointmentId,
				appointmentNumber: autoNumber || null,
				recordId: createdRecordId,
				id: resolvedAppointmentId,
				appointmentName: appointmentRecord.Appointment_Name,
				appointmentFor: apptFor,
				isProspect: !!apptFor.isProspect,
				message: 'Appointment successfully created in PMS.'
			}
		};
	}

/**
 * Translates raw CRM error codes and messages into user-friendly clinical messages.
 */
function formatCrmErrorMessage(message, code, details) {
	const raw = String(message || '').toLowerCase();
	if (code === 'INVALID_DATA' || raw === 'invalid data') {
		const field = details?.api_name;
		if (field === 'Appointment_Start_Time') {
			return 'The selected appointment time is outside clinic business hours. Please pick an open slot.';
		}
		if (field === 'Owner' || field === 'Doctor' || details?.json_path?.includes('Owner')) {
			return 'The selected practitioner is not assigned to this department. Please choose another doctor or service.';
		}
		if (field === 'Service_Name') {
			return 'The selected department service is currently unavailable.';
		}
		return 'Could not process the appointment with the provided details. Please choose another slot or verify your details.';
	}
	if (raw.includes('service members') || raw.includes('part of service')) {
		return 'The selected practitioner is not assigned to this department. Please choose another doctor or service.';
	}
	if (raw.includes('business hours') || raw.includes('operating hours')) {
		return 'The selected appointment time is outside clinic business hours. Please choose an open slot.';
	}
	return message || 'Failed to create appointment in PMS.';
}

	const friendlyError = formatCrmErrorMessage(result?.message || insertData.message, result?.code, result?.details);

	return {
		status: 400,
		data: {
			ok: false,
			error: friendlyError,
			rawError: result?.message || insertData.message || null,
			details: result?.details || null
		}
	};
}

module.exports = {
	getBookedSlots,
	resolveServiceDetails,
	calculateAppointmentTimes,
	resolveAppointmentDoctor,
	createAppointment
};
