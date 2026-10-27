'use strict';

const { sendJson, readJsonBody, getCorsHeaders } = require('./utils/http');
const { CORS_CONFIG, MODULES } = require('./config');
const { checkRateLimit } = require('./utils/rateLimiter');

const {
	getHospitalDetails,
	getScheduleConfiguration,
	getDoctorsList,
	getServicesList,
	getPriorities
} = require('./services/clinicService');

const {
	streamHospitalLogo,
	streamDoctorImage
} = require('./services/imageService');

const {
	findPatientByMobile
} = require('./services/patientService');

const {
	getBookedSlots,
	createAppointment
} = require('./services/appointmentService');

module.exports = async (req, res) => {
	res.__req = req;

	// CORS preflight handling
	if (req.method === 'OPTIONS') {
		res.writeHead(204, getCorsHeaders(req));
		return res.end();
	}

	// URL parsing
	const parsedUrl = new URL(req.url, 'http://localhost');
	const pathname = parsedUrl.pathname.replace(/\/$/, '') || '/';

	try {
		// Route dispatching & service calls

		// GET /hospital/logo (Streams hospital logo binary)
		if (req.method === 'GET' && pathname.endsWith('/hospital/logo')) {
			return streamHospitalLogo(res, req);
		}

		// GET /hospital (Dynamic hospital details, business hours & Base64 logo)
		if (req.method === 'GET' && pathname.endsWith('/hospital')) {
			const hospital = await getHospitalDetails();
			return sendJson(res, 200, { ok: true, hospital }, req);
		}

		// GET /priorities (Picklist values)
		if (req.method === 'GET' && pathname.endsWith('/priorities')) {
			return sendJson(res, 200, { ok: true, priorities: getPriorities() }, req);
		}

		// GET /doctor-image?id=...&zuid=... (Streams doctor photo binary)
		if (req.method === 'GET' && pathname.endsWith('/doctor-image')) {
			const id = parsedUrl.searchParams.get('id');
			const zuid = parsedUrl.searchParams.get('zuid');
			return streamDoctorImage(res, id, zuid, req);
		}

		// GET /doctors (Active practitioners)
		if (req.method === 'GET' && pathname.endsWith('/doctors')) {
			const doctors = await getDoctorsList();
			return sendJson(res, 200, { ok: true, doctors });
		}

		// GET /services (Clinical services / departments)
		if (req.method === 'GET' && pathname.endsWith('/services')) {
			const services = await getServicesList();
			return sendJson(res, 200, { ok: true, departments: services, services });
		}

		// GET /patient/search?mobile=... (Patient lookup by mobile with rate limiting & 10-digit validation)
		if (req.method === 'GET' && pathname.endsWith('/patient/search')) {
			if (!checkRateLimit(req, 'patient_search', 15, 60000)) {
				return sendJson(res, 429, { ok: false, error: 'Too many lookup requests. Please wait a moment.' }, req);
			}

			const mobileParam = parsedUrl.searchParams.get('mobile');
			const cleanMobile = mobileParam ? String(mobileParam).replace(/\D/g, '').slice(-10) : '';
			if (!cleanMobile || cleanMobile.length !== 10) {
				return sendJson(res, 400, { ok: false, error: 'A valid 10-digit mobile number is required.' }, req);
			}

			const patient = await findPatientByMobile(cleanMobile);
			if (patient) {
				return sendJson(res, 200, { ok: true, found: true, patient }, req);
			}
			return sendJson(res, 200, { ok: true, found: false }, req);
		}

		// GET /schedule-config (Business hours, holidays, unavailability, shift hours)
		if (req.method === 'GET' && pathname.endsWith('/schedule-config')) {
			const config = await getScheduleConfiguration();
			return sendJson(res, 200, { ok: true, ...config }, req);
		}

		// GET /booked-slots?date=YYYY-MM-DD&doctorId=... (Booked slots for date/doctor)
		if (req.method === 'GET' && pathname.endsWith('/booked-slots')) {
			const dateParam = parsedUrl.searchParams.get('date');
			const doctorIdParam = parsedUrl.searchParams.get('doctorId') || parsedUrl.searchParams.get('doctor');
			const booked = await getBookedSlots(dateParam, doctorIdParam);
			return sendJson(res, 200, { ok: true, booked }, req);
		}

		// POST /book-appointment (Appointment creation with rate limiting & input validation)
		if (req.method === 'POST' && pathname.endsWith('/book-appointment')) {
			if (!checkRateLimit(req, 'book_appointment', 6, 60000)) {
				return sendJson(res, 429, { ok: false, error: 'Too many appointment requests. Please wait a moment.' }, req);
			}
			const body = await readJsonBody(req);
			const result = await createAppointment(body);
			return sendJson(res, result.status, result.data, req);
		}

		// Service status health check
		return sendJson(res, 200, {
			status: 'ok',
			service: 'pms_appointment_service',
			version: '3.0.0',
			client: 'ZRC / Zoho CRM v8 SDK',
			targetModule: MODULES.APPOINTMENTS
		});
	} catch (err) {
		console.error('PMS Service Error');
		const statusCode = err.message === 'Invalid JSON payload' ? 400 : 500;
		return sendJson(res, statusCode, {
			ok: false,
			error: err.message || 'Internal server error'
		}, req);
	}
};
