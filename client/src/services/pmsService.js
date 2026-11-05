import portalConfig from '../../../portal-config.json';

// Configurable Catalyst Function Name (from portal-config.json or .env override)
export const FUNCTION_NAME = import.meta.env.VITE_FUNCTION_NAME 
  || portalConfig.catalyst?.functionName 
  || '';

// Dynamic backend endpoint resolution without hardcoded project IDs or URLs
const CLOUD_CATALYST_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_CATALYST_URL || '';

// If running in browser and on a Catalyst domain, localhost, or same-origin, route to relative /server/<FUNCTION_NAME>
export const PRIMARY_CATALYST_URL = (typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.includes('catalystserverless') ||
  !CLOUD_CATALYST_URL
))
  ? `/server/${FUNCTION_NAME}`
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
      lastError = cErr.message;
    }
  }

  return { ok: false, error: lastError || 'Service unavailable' };
}

/**
 * Normalizes doctor payload attributes.
 */
function normalizeDoctor(doc) {
  if (!doc) return null;
  const fullName = doc.fullName || doc.name || `${doc.first_name || ''} ${doc.last_name || ''}`.trim();
  const rawId = doc.id || doc.zuid || doc.userId || doc.practitionerId;
  return {
    id: String(rawId),
    name: fullName,
    fullName: fullName,
    email: doc.email || '',
    phone: doc.phone || doc.mobile || '',
    specialization: doc.specialization || doc.designation || doc.role || '',
    medicalDegrees: doc.medicalDegrees || doc.degree || '',
    image: doc.image || doc.photoUrl || null,
    avatar: doc.avatar || doc.image || null,
    zuid: doc.zuid || doc.id || null,
    services: Array.isArray(doc.services) ? doc.services : [],
    serviceIds: Array.isArray(doc.serviceIds) ? doc.serviceIds : []
  };
}

/**
 * Normalizes clinical service/department payload attributes.
 */
function normalizeService(srv) {
  if (!srv) return null;
  return {
    id: String(srv.id),
    name: srv.name || srv.serviceName || 'General Consultation',
    duration: srv.duration ? Number(srv.duration) : 30,
    price: srv.price !== undefined ? Number(srv.price) : 0,
    description: srv.description || '',
    members: Array.isArray(srv.members) ? srv.members : [],
    memberIds: Array.isArray(srv.memberIds) ? srv.memberIds : [],
    doctorCount: Array.isArray(srv.members) ? srv.members.length : (srv.doctorCount || 0)
  };
}

// ─── Exported Service Functions ──────────────────────────────────────────────

export const getPmsHospitalDetails = () => fetchCatalyst('/hospital');
export const getPmsHospitalInfo = async () => {
  const res = await fetchCatalyst('/hospital');
  return res.ok && res.hospital ? res.hospital : null;
};

export const getPmsDoctors = async () => {
  const res = await fetchCatalyst('/doctors');
  if (res.ok && Array.isArray(res.doctors)) {
    return res.doctors.map(normalizeDoctor).filter(Boolean);
  }
  return [];
};

export const getPmsServices = async () => {
  const res = await fetchCatalyst('/services');
  const arr = res.services || res.departments;
  if (res.ok && Array.isArray(arr)) {
    return arr.map(normalizeService).filter(Boolean);
  }
  return [];
};

export const getPmsDepartments = getPmsServices;

export const getPmsPriorities = async () => {
  const res = await fetchCatalyst('/priorities');
  if (res.ok && Array.isArray(res.priorities)) {
    return res.priorities;
  }
  return ['Routine', 'Urgent'];
};

export const getPmsScheduleConfig = async () => {
  const res = await fetchCatalyst('/schedule-config');
  if (res.ok) {
    return {
      businessHours: res.businessHours || null,
      holidays: Array.isArray(res.holidays) ? res.holidays : [],
      unavailabilities: Array.isArray(res.unavailabilities) ? res.unavailabilities : [],
      shiftHours: Array.isArray(res.shiftHours) ? res.shiftHours : []
    };
  }
  return {
    businessHours: null,
    holidays: [],
    unavailabilities: [],
    shiftHours: []
  };
};

export const getPmsBookedAppointments = async (date, doctorId) => {
  if (!date) return [];
  const params = new URLSearchParams({ date });
  if (doctorId) params.append('doctorId', doctorId);
  const res = await fetchCatalyst(`/booked-slots?${params.toString()}`);
  if (res.ok && Array.isArray(res.booked)) {
    return res.booked
      .map(slot => {
        if (!slot.startTime) return null;
        try {
          const d = new Date(slot.startTime);
          const hours = d.getHours();
          const mins = d.getMinutes();
          const period = hours >= 12 ? 'PM' : 'AM';
          const h = hours % 12 || 12;
          const padM = String(mins).padStart(2, '0');
          return `${h}:${padM} ${period}`;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return [];
};

export const getPmsDoctorImageUrl = (id, zuid) => {
  const params = new URLSearchParams();
  if (id) params.append('id', id);
  if (zuid) params.append('zuid', zuid);
  return `${PRIMARY_CATALYST_URL}/doctor-image?${params.toString()}`;
};

export const searchPmsPatient = async (mobile) => {
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (cleanMobile.length !== 10) return null;
  const res = await fetchCatalyst(`/patient/search?mobile=${cleanMobile}`);
  if (res.ok && res.found && res.patient) {
    return res.patient;
  }
  return null;
};

export const createPmsAppointment = (appointmentData) => {
  return fetchCatalyst('/book-appointment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appointmentData)
  });
};

export const checkPmsHealth = () => fetchCatalyst('/');

export const getAllPmsData = async () => {
  const [hRes, dRes, sRes, scRes, pRes] = await Promise.all([
    fetchCatalyst('/hospital'),
    fetchCatalyst('/doctors'),
    fetchCatalyst('/services'),
    fetchCatalyst('/schedule-config'),
    fetchCatalyst('/priorities')
  ]);

  const hasFailed = !sRes.ok && !dRes.ok;
  const errorMsg = sRes.error || dRes.error || hRes.error || null;

  const rawDocs = dRes.ok && Array.isArray(dRes.doctors) ? dRes.doctors : [];
  const rawServices = sRes.ok && Array.isArray(sRes.services || sRes.departments) ? (sRes.services || sRes.departments) : [];

  const doctors = rawDocs.map(normalizeDoctor).filter(Boolean);
  const departments = rawServices.map(normalizeService).filter(Boolean);

  // Cross-reference doctors with department assignments
  departments.forEach(dept => {
    if (dept.memberIds && dept.memberIds.length > 0) {
      dept.doctors = doctors.filter(doc => dept.memberIds.includes(doc.id));
      dept.doctorCount = dept.doctors.length;
    } else {
      dept.doctors = doctors;
      dept.doctorCount = doctors.length;
    }
  });

  return {
    ok: !hasFailed,
    error: hasFailed ? (errorMsg || 'Unable to load appointment services right now. Please check your connection and try again.') : null,
    hospitalInfo: hRes.ok && hRes.hospital ? hRes.hospital : null,
    doctors,
    services: departments,
    departments,
    scheduleConfig: scRes.ok ? {
      businessHours: scRes.businessHours || null,
      holidays: Array.isArray(scRes.holidays) ? scRes.holidays : [],
      unavailabilities: Array.isArray(scRes.unavailabilities) ? scRes.unavailabilities : [],
      shiftHours: Array.isArray(scRes.shiftHours) ? scRes.shiftHours : []
    } : {
      businessHours: null,
      holidays: [],
      unavailabilities: [],
      shiftHours: []
    },
    priorities: pRes.ok && Array.isArray(pRes.priorities) ? pRes.priorities : ['Routine', 'Urgent']
  };
};
