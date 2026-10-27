// Dynamic backend endpoint resolution without hardcoded project IDs or URLs
const CLOUD_CATALYST_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_CATALYST_URL || '';

// If running in browser and on a Catalyst domain, localhost, or same-origin, route to relative /server
const PRIMARY_CATALYST_URL = (typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.includes('catalystserverless') ||
  !CLOUD_CATALYST_URL
))
  ? '/server/pms_appointment_service'
  : CLOUD_CATALYST_URL;

/**
 * Universal fetcher that routes exclusively through Catalyst Serverless Functions (ZRC backend).
 */
async function fetchCatalyst(path, options = {}) {
  let networkFailed = false;
  let lastError = null;

  // Try primary (local proxy or direct cloud)
  try {
    const res = await fetch(`${PRIMARY_CATALYST_URL}${path}`, options);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return data;
    if (data) {
      // Server reached and returned a structured response
      return { ok: false, error: data.error || data.message || `Request failed with status ${res.status}`, ...data };
    }
    lastError = `Request failed with status ${res.status}`;
  } catch (err) {
    networkFailed = true;
    lastError = err.message;
  }

  // Fallback to CLOUD_CATALYST_URL only if primary had a true network connection failure
  if (networkFailed && PRIMARY_CATALYST_URL !== CLOUD_CATALYST_URL) {
    try {
      const cRes = await fetch(`${CLOUD_CATALYST_URL}${path}`, options);
      const cData = await cRes.json().catch(() => null);
      if (cRes.ok && cData?.ok) return cData;
      if (cData) {
        return { ok: false, error: cData.error || cData.message || `Request failed with status ${cRes.status}`, ...cData };
      }
    } catch (cErr) {
      if (!lastError) lastError = cErr.message;
    }
  }

  return { ok: false, error: lastError || 'Unable to connect to clinic service. Please try again.' };
}

/**
 * Obtain PMS OAuth token status via Catalyst Serverless token bridge (server-side managed).
 */
export async function getPmsAccessToken() {
  const cData = await fetchCatalyst('/token');
  if (cData && cData.ok && cData.accessToken) {
    return cData.accessToken;
  }
  return null;
}

/**
 * Fetch active PMS doctors/practitioners from Catalyst Serverless Function (ZRC GET).
 */
export async function getPmsDoctors() {
  const cData = await fetchCatalyst('/doctors');
  if (cData && cData.ok && Array.isArray(cData.doctors)) {
    const basePrefix = PRIMARY_CATALYST_URL.startsWith('http')
      ? PRIMARY_CATALYST_URL.replace(/\/server\/pms_appointment_service.*$/, '')
      : '';
    return cData.doctors.map((d) => ({
      ...d,
      medicalDegrees: d.medicalDegrees || d.Medical_Degrees || d.qualification || '',
      image: d.image?.startsWith('/') && basePrefix ? `${basePrefix}${d.image}` : d.image
    }));
  }

  if (cData?.error) {
    throw new Error(cData.error);
  }
  return [];
}

/**
 * Fetch live PMS Services from Services__s module in PMS via Catalyst Serverless Function (ZRC COQL).
 */
export async function getPmsServices() {
  const cData = await fetchCatalyst('/services');
  if (cData && cData.ok && Array.isArray(cData.services)) {
    return cData.services;
  }
  if (cData?.error) {
    throw new Error(cData.error);
  }
  return [];
}

export const getPmsDepartments = getPmsServices;

/**
 * Fetch dynamic Hospital / Clinic info from PMS via Catalyst Serverless Function (ZRC App_Settings & Org Photo).
 */
export async function getPmsHospitalInfo() {
  const cData = await fetchCatalyst('/hospital');
  if (cData && cData.ok && cData.hospital) {
    return cData.hospital;
  }
  return null;
}

/**
 * Search Patient in PMS by 10-digit mobile number via Catalyst Serverless Function (ZRC COQL).
 */
export async function searchPmsPatient(mobileNumber) {
  const cleanMobile = String(mobileNumber).replace(/\D/g, '').slice(-10);
  if (!cleanMobile) return null;

  const cData = await fetchCatalyst(`/patient/search?mobile=${encodeURIComponent(cleanMobile)}`);
  if (cData && cData.found && cData.patient) {
    return cData.patient;
  }
  return null;
}

/**
 * Fetch live schedule configuration from Zoho PMS CRM (Business Hours, Holidays, Unavailability, Shift Hours via ZRC).
 */
export async function getPmsScheduleConfig() {
  const cData = await fetchCatalyst('/schedule-config');
  if (cData && cData.ok) {
    return {
      businessHours: cData.businessHours || null,
      holidays: cData.holidays || [],
      unavailabilities: cData.unavailabilities || [],
      shiftHours: cData.shiftHours || []
    };
  }
  return {
    businessHours: null,
    holidays: [],
    unavailabilities: [],
    shiftHours: []
  };
}

/**
 * Fetch already booked slots for a specific date and doctor via Catalyst Serverless Function (ZRC COQL).
 */
export async function getPmsBookedAppointments(dateStr, doctorId) {
  if (!dateStr) return [];

  const docParam = doctorId ? `&doctorId=${encodeURIComponent(doctorId)}` : '';
  const cData = await fetchCatalyst(`/booked-slots?date=${encodeURIComponent(dateStr)}${docParam}`);
  if (cData && Array.isArray(cData.booked)) {
    return cData.booked.map(r => {
      const d = new Date(r.startTime);
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const isPM = hours >= 12;
      const displayHours = hours % 12 === 0 ? 12 : hours % 12;
      return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    });
  }
  return [];
}

/**
 * Fetch Priority picklist values dynamically from Catalyst Serverless Function.
 */
export async function getPmsPriorities() {
  const cData = await fetchCatalyst('/priorities');
  if (cData && cData.ok && Array.isArray(cData.priorities)) {
    return cData.priorities;
  }
  return ['Routine', 'Urgent', 'ASAP', 'STAT'];
}

/**
 * Book a new appointment in Appointments__s module in PMS via Catalyst Serverless Function (ZRC POST).
 */
export async function createPmsAppointment({
  firstName = '',
  lastName = '',
  patientName = '',
  mobileNumber = '',
  doctorId = '',
  doctor = null,
  departmentId = '',
  department = null,
  service = null,
  duration = 30,
  visitDate = '',
  startTime = '',
  priority = 'Routine',
  appointmentName = '',
  matchedPatientId = null,
  patient = null,
  chiefComplaint = '',
  additionalInfo = ''
}) {
  const resolvedFullName = (patientName || `${firstName} ${lastName}`).trim();

  // Route exclusively via Catalyst Serverless Function which executes ZRC / COQL server-side
  const cData = await fetchCatalyst('/book-appointment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName,
      lastName,
      patientName: resolvedFullName,
      mobileNumber,
      matchedPatientId: matchedPatientId || patient?.id || null,
      doctor: doctor || (doctorId ? { id: doctorId } : null),
      department: department || (departmentId ? { id: departmentId } : null),
      service: service || department,
      duration,
      visitDate,
      startTime,
      priority,
      appointmentName,
      chiefComplaint: chiefComplaint || additionalInfo
    })
  });

  if (cData && cData.ok) {
    return cData;
  }

  throw new Error(cData?.error || 'Unable to confirm your appointment at this time. Please try again.');
}
