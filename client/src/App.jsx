import { useState, useEffect, useMemo } from 'react'
import {
  getPmsServices,
  getPmsDoctors,
  getPmsPriorities,
  getPmsBookedAppointments,
  searchPmsPatient,
  createPmsAppointment,
  getPmsHospitalInfo,
  getPmsScheduleConfig
} from './services/pmsService'
import DateField from './components/DateField'
import MatchCard, { patientMatchRow } from './components/MatchCard'
import PatientDetailModal from './components/PatientDetailModal'
import { LoadingScreen, StatusScreen } from './components/StatusScreen'
import { useToast } from './components/Toast'
import { formatPmsErrorMessage } from './utils/errorUtils'
import './App.css'
import defaultPortalConfig from '../../portal-config.json'

function getResolvedConfig() {
  const cfg = JSON.parse(JSON.stringify(defaultPortalConfig))
  if (typeof window !== 'undefined' && window.location.search) {
    const p = new URLSearchParams(window.location.search)
    // companyDetails
    if (p.get('hideHeader') === 'true') cfg.companyDetails.showHeader = false
    if (p.get('hideLogo') === 'true') cfg.companyDetails.showLogo = false
    if (p.get('hideCompanyName') === 'true') cfg.companyDetails.showCompanyName = false
    if (p.get('hideAddress') === 'true') cfg.companyDetails.showAddress = false
    if (p.get('hideHours') === 'true') cfg.companyDetails.showClinicHours = false
    if (p.get('hidePhone') === 'true') cfg.companyDetails.showPhone = false

    // departments
    if (p.get('hideDept') === 'true' || p.get('showDepartmentStep') === 'false') cfg.departments.showDepartmentStep = false
    if (p.get('dept')) cfg.departments.defaultDepartment = p.get('dept')
    if (p.get('hideDuration') === 'true') cfg.departments.showDuration = false
    if (p.get('hideDoctorCount') === 'true') cfg.departments.showDoctorCount = false

    // doctors
    if (p.get('hideDoctors') === 'true' || p.get('allowDoctorSelection') === 'false') cfg.doctors.allowDoctorSelection = false
    if (p.get('hideDoctorPhotos') === 'true') cfg.doctors.showDoctorPhotos = false
    if (p.get('hideSpecialization') === 'true') cfg.doctors.showSpecialization = false

    // patientForm
    if (p.get('requireEmail') === 'true') cfg.patientForm.requireEmail = true
    if (p.get('showEmail') === 'true') cfg.patientForm.showEmail = true
    if (p.get('hideApptName') === 'true') cfg.patientForm.showAppointmentName = false
    if (p.get('hideReason') === 'true') cfg.patientForm.showReasonForVisit = false
    if (p.get('requireReason') === 'false') cfg.patientForm.requireReasonForVisit = false
    if (p.get('hideNotes') === 'true') cfg.patientForm.showAdditionalNotes = false
    if (p.get('hidePriority') === 'true') cfg.patientForm.showPriority = false

    // theme
    if (p.get('primaryColor')) cfg.theme.primaryColor = p.get('primaryColor')
    if (p.get('borderRadius')) cfg.theme.borderRadius = p.get('borderRadius')
  }
  return cfg
}
const portalConfig = getResolvedConfig()

const PRIORITIES = ['Routine', 'Urgent', 'ASAP', 'STAT']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const hhmm = (m) => {
  const h24 = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  const ap = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h).padStart(2, '0')}:${mm} ${ap}`
}

function parseTimeToMins(timeStr) {
  if (!timeStr) return null
  const trimmed = String(timeStr).trim().toUpperCase()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i)
  if (!match) return null
  let h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const ap = match[3]
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + m
}

function formatClinicHours(bh) {
  if (!bh) return null
  if (typeof bh === 'string') {
    if (bh.includes('Sunday') && bh.includes('Monday')) {
      return '24 Hours'
    }
    return bh
  }
  const type = String(bh.type || '').toLowerCase()
  if (type.includes('24') || bh.is_24_7 || (bh.same_as_everyday === true && (!bh.daily_timing || bh.daily_timing.length === 0))) {
    return '24 Hours'
  }
  const formatTime = (t) => {
    if (!t) return ''
    if (/am|pm/i.test(t)) return t
    const parts = String(t).split(':')
    let h = parseInt(parts[0], 10)
    const m = parts[1] || '00'
    const ap = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m} ${ap}`
  }
  if (Array.isArray(bh.daily_timing) && bh.daily_timing.length >= 2) {
    const s = formatTime(bh.daily_timing[0])
    const e = formatTime(bh.daily_timing[1])
    return (s && e) ? `${s} – ${e}` : '24 Hours'
  }
  if (Array.isArray(bh.custom_timing) && bh.custom_timing.length > 0) {
    const first = bh.custom_timing[0]
    const timing = first.daily_timing || first.timing || first.business_timing || first.shift_timing
    if (Array.isArray(timing) && timing.length >= 2) {
      const s = formatTime(timing[0])
      const e = formatTime(timing[1])
      return (s && e) ? `${s} – ${e}` : '24 Hours'
    }
  }
  return '24 Hours'
}

function getWorkingBlocksForDate(dateStr, businessHours, doctorShift) {
  if (!dateStr) return []
  const dt = new Date(`${dateStr}T12:00:00`)
  const dayName = DAY_NAMES[dt.getDay()]

  // 1. Check doctor's specific shift hours if assigned
  if (doctorShift) {
    const shiftDays = doctorShift.business_days || doctorShift.days || []
    if (shiftDays.length === 0 || shiftDays.includes(dayName)) {
      if (Array.isArray(doctorShift.daily_timing) && doctorShift.daily_timing.length >= 2) {
        const startM = parseTimeToMins(doctorShift.daily_timing[0])
        let endM = parseTimeToMins(doctorShift.daily_timing[1])
        if (endM === 0 || doctorShift.daily_timing[1]?.includes('12:00 AM') || doctorShift.daily_timing[1] === '24:00') {
          endM = 1440
        }
        if (startM !== null && endM !== null && endM > startM) {
          return [[startM, endM]]
        }
      }
      if (Array.isArray(doctorShift.custom_timing)) {
        const ct = doctorShift.custom_timing.find(c => c.days === dayName || c.days?.includes(dayName))
        const timing = ct?.daily_timing || ct?.timing || ct?.business_timing
        if (Array.isArray(timing) && timing.length >= 2) {
          const startM = parseTimeToMins(timing[0])
          let endM = parseTimeToMins(timing[1])
          if (endM === 0 || timing[1]?.includes('12:00 AM') || timing[1] === '24:00') {
            endM = 1440
          }
          if (startM !== null && endM !== null && endM > startM) {
            return [[startM, endM]]
          }
        }
      }
    } else {
      // Doctor has assigned shift hours, but this day is an off-day
      return []
    }
  }

  // 2. Organization Business Hours (fallback when doctor has no shift hours assigned)
  if (businessHours) {
    const rawDays = businessHours.business_days || []
    const isWorkingDay = rawDays.length === 0 || rawDays.includes(dayName)
    if (!isWorkingDay) return []

    const typeStr = String(businessHours.type || '').toLowerCase()
    const bhValStr = String(businessHours.business_hours || '').toLowerCase()
    if (typeStr.includes('24') || bhValStr.includes('24')) {
      // Full 24 Hours: round-the-clock 00:00 to 24:00 (0 to 1440 minutes)
      return [[0, 1440]]
    }

    if (businessHours.same_as_everyday && Array.isArray(businessHours.daily_timing) && businessHours.daily_timing.length >= 2) {
      const startM = parseTimeToMins(businessHours.daily_timing[0])
      let endM = parseTimeToMins(businessHours.daily_timing[1])
      if (endM === 0 || businessHours.daily_timing[1]?.includes('12:00 AM') || businessHours.daily_timing[1] === '24:00') {
        endM = 1440
      }
      if (startM !== null && endM !== null && endM > startM) {
        return [[startM, endM]]
      }
    }

    if (Array.isArray(businessHours.custom_timing)) {
      const ct = businessHours.custom_timing.find(c => c.days === dayName || c.days?.includes(dayName))
      const timing = ct?.business_timing || ct?.daily_timing || ct?.timing
      if (Array.isArray(timing) && timing.length >= 2) {
        const startM = parseTimeToMins(timing[0])
        let endM = parseTimeToMins(timing[1])
        if (endM === 0 || timing[1]?.includes('12:00 AM') || timing[1] === '24:00') {
          endM = 1440
        }
        if (startM !== null && endM !== null && endM > startM) {
          return [[startM, endM]]
        }
      }
    }
  }

  // Default fallback for 24 hours: 00:00 to 24:00
  return [[0, 1440]]
}


function getServiceIcon(serviceName = '') {
  const n = (serviceName || '').toLowerCase()
  if (n.includes('medic') || n.includes('general') || n.includes('physician') || n.includes('consult')) return 'ti-stethoscope'
  if (n.includes('derma') || n.includes('skin')) return 'ti-mood-smile'
  if (n.includes('ortho') || n.includes('bone')) return 'ti-bone'
  if (n.includes('paed') || n.includes('ped') || n.includes('child')) return 'ti-baby-carriage'
  if (n.includes('cardio') || n.includes('heart')) return 'ti-heart-rate-monitor'
  if (n.includes('physio') || n.includes('therapy') || n.includes('rehab')) return 'ti-run'
  if (n.includes('dent') || n.includes('tooth') || n.includes('teeth') || n.includes('oral')) return 'ti-dental'
  if (n.includes('eye') || n.includes('ophth')) return 'ti-eye'
  if (n.includes('neuro') || n.includes('brain')) return 'ti-brain'
  if (n.includes('gyn') || n.includes('women') || n.includes('obstet')) return 'ti-gender-female'
  if (n.includes('ent') || n.includes('ear') || n.includes('nose') || n.includes('throat')) return 'ti-ear'
  if (n.includes('uro') || n.includes('nephro') || n.includes('kidney') || n.includes('renal')) return 'ti-droplet'
  if (n.includes('pulmo') || n.includes('lung') || n.includes('chest') || n.includes('respira')) return 'ti-wind'
  if (n.includes('gastro') || n.includes('digest') || n.includes('stomach') || n.includes('liver')) return 'ti-pill'
  if (n.includes('endo') || n.includes('diabet') || n.includes('thyroid')) return 'ti-activity'
  if (n.includes('onco') || n.includes('cancer')) return 'ti-ribbon'
  if (n.includes('psych') || n.includes('mental')) return 'ti-mood-plus'
  if (n.includes('surg')) return 'ti-cut'
  if (n.includes('diet') || n.includes('nutri')) return 'ti-apple'
  return 'ti-stethoscope'
}

function getServiceDescription(service) {
  if (service?.description && service.description.trim()) {
    return service.description.trim()
  }
  const n = String(service?.name || '').toLowerCase()
  if (n.includes('nephro') || n.includes('kidney') || n.includes('renal')) {
    return 'Kidney care, renal function review, and urinary health consultations.'
  }
  if (n.includes('cardio') || n.includes('heart')) {
    return 'Heart health, ECG, chest pain, and blood pressure review.'
  }
  if (n.includes('derma') || n.includes('skin')) {
    return 'Skin care, acne, rashes, hair, and allergy consultations.'
  }
  if (n.includes('ortho') || n.includes('bone') || n.includes('joint')) {
    return 'Bone, joint pain, fractures, arthritis, and mobility care.'
  }
  if (n.includes('paed') || n.includes('ped') || n.includes('child')) {
    return 'Child healthcare, vaccinations, and pediatric growth monitoring.'
  }
  if (n.includes('gyn') || n.includes('women') || n.includes('obstet')) {
    return 'Women’s wellness, prenatal checkups, and reproductive health.'
  }
  if (n.includes('dent') || n.includes('tooth') || n.includes('oral')) {
    return 'Dental checkups, tooth pain, cleaning, and oral care.'
  }
  if (n.includes('ent') || n.includes('ear') || n.includes('throat')) {
    return 'Ear, nose, throat conditions, sinus, and hearing checkups.'
  }
  if (n.includes('eye') || n.includes('ophth')) {
    return 'Vision exams, eye infections, and ocular health checkups.'
  }
  if (n.includes('neuro') || n.includes('brain')) {
    return 'Headache, migraines, nerve health, and neurological review.'
  }
  if (n.includes('uro')) {
    return 'Urinary tract health, bladder care, and urological consultations.'
  }
  if (n.includes('pulmo') || n.includes('lung') || n.includes('chest') || n.includes('respira')) {
    return 'Asthma, chronic cough, lung health, and respiratory care.'
  }
  if (n.includes('gastro') || n.includes('digest') || n.includes('stomach') || n.includes('liver')) {
    return 'Digestive wellness, acid reflux, stomach, and liver care.'
  }
  if (n.includes('endo') || n.includes('diabet') || n.includes('thyroid') || n.includes('hormone')) {
    return 'Diabetes management, thyroid disorders, and endocrine wellness.'
  }
  if (n.includes('onco') || n.includes('cancer')) {
    return 'Oncology evaluations, cancer screenings, and specialized therapy care.'
  }
  if (n.includes('psych') || n.includes('mental')) {
    return 'Mental wellness, stress management, anxiety, and psychological support.'
  }
  if (n.includes('physio') || n.includes('therapy') || n.includes('rehab')) {
    return 'Physical therapy, rehabilitation, muscle recovery, and pain relief.'
  }
  if (n.includes('rheuma') || n.includes('arthrit')) {
    return 'Autoimmune conditions, joint inflammation, and rheumatology care.'
  }
  if (n.includes('surg')) {
    return 'Surgical consultations, wound evaluations, and pre-op assessments.'
  }
  if (n.includes('diet') || n.includes('nutri')) {
    return 'Personalized nutrition counseling, diet planning, and metabolic health.'
  }
  if (n.includes('medic') || n.includes('general') || n.includes('physician') || n.includes('consult')) {
    return 'Fever, infections, blood pressure, and diabetes review.'
  }
  return 'Comprehensive clinical consultation, evaluation, and care.'
}

function DoctorAvatar({ doctor, isSelected, initials }) {
  const [imgError, setImgError] = useState(false)
  const imageSrc = doctor?.image || (doctor?.id
    ? `/server/pms_appointment_service/doctor-image?id=${doctor.id}${doctor.zuid ? `&zuid=${doctor.zuid}` : ''}`
    : null)
  const hasImage = Boolean(portalConfig.doctors?.showDoctorPhotos !== false && imageSrc && !imgError)

  return (
    <span className={`doctor-avatar ${isSelected ? 'is-selected' : ''}`}>
      {hasImage ? (
        <img
          src={imageSrc}
          alt={doctor.name || initials}
          className="doctor-avatar-img"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="doctor-avatar-initials">{initials}</span>
      )}
    </span>
  )
}

function getHospitalInitials(name = '') {
  if (!name) return 'H'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export default function App() {
  const toast = useToast()

  // Live Data from PMS
  const [hospitalInfo, setHospitalInfo] = useState(null)
  const [hospitalLogoError, setHospitalLogoError] = useState(false)
  const [scheduleConfig, setScheduleConfig] = useState({
    businessHours: null,
    holidays: [],
    unavailabilities: [],
    shiftHours: []
  })
  const [services, setServices] = useState([])
  const [doctors, setDoctors] = useState([])
  const [priorities, setPriorities] = useState(PRIORITIES)
  const [bookedSlots, setBookedSlots] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [fetchError, setFetchError] = useState('')

  const showDeptStep = portalConfig.departments?.showDepartmentStep !== false

  // Wizard Step (starts at Step 2 if Department selection step is disabled)
  const [step, setStep] = useState(showDeptStep ? 1 : 2)

  // Step 1: Selected Service from Services__s in PMS
  const [selectedServiceId, setSelectedServiceId] = useState(null)

  // Distinct live services from Services__s (deduplicated by name)
  const displayServices = useMemo(() => {
    const map = new Map()
    for (const s of services) {
      const key = (s.name || '').trim().toLowerCase()
      if (!key) continue
      if (!map.has(key)) {
        map.set(key, { ...s, members: [...(s.members || [])] })
      } else {
        const existing = map.get(key)
        const combinedMembers = [...(existing.members || [])]
        for (const m of (s.members || [])) {
          if (!combinedMembers.some((em) => String(em.id) === String(m.id))) {
            combinedMembers.push(m)
          }
        }
        map.set(key, {
          ...existing,
          ...s,
          members: combinedMembers,
          doctorCount: Math.max(combinedMembers.length, existing.doctorCount || 0, s.doctorCount || 0)
        })
      }
    }
    return Array.from(map.values())
  }, [services])

  // Step 2: Selected Doctor & Schedule
  const [selectedDoctorId, setSelectedDoctorId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [timeFilter, setTimeFilter] = useState('all')
  const [disabledDateNotice, setDisabledDateNotice] = useState(null)
  const todayKey = useMemo(() => iso(new Date()), [])

  useEffect(() => {
    if (!disabledDateNotice) return
    const timer = setTimeout(() => {
      setDisabledDateNotice(null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [disabledDateNotice])

  // Step 3: Patient Inputs & PMS Matching
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [matchedPatient, setMatchedPatient] = useState(null)
  const [detailPatient, setDetailPatient] = useState(null)
  const [searchingPatient, setSearchingPatient] = useState(false)
  const [apptName, setApptName] = useState('')
  const [apptEdited, setApptEdited] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [extra, setExtra] = useState('')
  const [priority, setPriority] = useState('Routine')

  // Status & errors
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [bookingRef, setBookingRef] = useState(null)
  const [confirmedAppt, setConfirmedAppt] = useState(null)

  // Apply configurable brand theme & border radius from portal-config.json
  useEffect(() => {
    if (portalConfig.theme?.primaryColor) {
      document.documentElement.style.setProperty('--brand', portalConfig.theme.primaryColor)
      document.documentElement.style.setProperty('--brand-dark', portalConfig.theme.primaryColor)
      document.documentElement.style.setProperty('--brand-tab', portalConfig.theme.primaryColor)
    }
    if (portalConfig.theme?.borderRadius) {
      document.documentElement.style.setProperty('--portal-radius', portalConfig.theme.borderRadius)
    }
  }, [])

  // Load live Services, Doctors, and Schedule Configuration from PMS on mount or retry
  const loadData = () => {
    setLoadingData(true)
    setFetchError('')

    Promise.all([
      getPmsServices(),
      getPmsDoctors(),
      getPmsPriorities(),
      getPmsHospitalInfo(),
      getPmsScheduleConfig()
    ])
      .then(([srvList, docList, prioList, hosp, sched]) => {
        setServices(srvList || [])
        setDoctors(docList || [])
        if (prioList?.length) setPriorities(prioList)
        if (hosp) setHospitalInfo(hosp)
        if (sched) setScheduleConfig(sched)

        if (srvList?.length > 0) {
          const defDept = portalConfig.departments?.defaultDepartment
          const matched = defDept
            ? srvList.find((s) => String(s.id) === String(defDept) || (s.name && s.name.toLowerCase().includes(defDept.toLowerCase())))
            : null
          setSelectedServiceId(matched ? matched.id : srvList[0].id)
        }
        if (docList?.length > 0) {
          setSelectedDoctorId(docList[0].id)
        }
      })
      .catch((err) => {
        console.error('Failed to load clinic data')
        setFetchError('Unable to load clinical departments right now. Please check your connection and try again.')
      })
      .finally(() => {
        setLoadingData(false)
      })
  }

  useEffect(() => {
    loadData()
  }, [])

  // Sync document title with hospital name
  useEffect(() => {
    if (hospitalInfo?.name) {
      document.title = `Book Appointment | ${hospitalInfo.name}`
    }
  }, [hospitalInfo?.name])

  // Reset scroll to top on step transitions
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  // Prepopulate from URL params if provided (?first=Ganga&last=Elumalai&mobile=9876543210&email=ganga@example.com)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('first')) setFirst(params.get('first'))
    if (params.get('last')) setLast(params.get('last'))
    if (params.get('mobile')) setMobile(params.get('mobile').replace(/\D/g, '').slice(-10))
    if (params.get('email')) setEmail(params.get('email'))
  }, [])

  // Live Patient search in PMS when 10 digits are entered
  const cleanMobile = mobile.replace(/\D/g, '')
  useEffect(() => {
    if (cleanMobile.length === 10) {
      setSearchingPatient(true)
      searchPmsPatient(cleanMobile)
        .then((patient) => {
          if (patient) {
            setMatchedPatient(patient)
            if (!first && patient.firstName) setFirst(patient.firstName)
            if (!last && patient.lastName) setLast(patient.lastName)
            if (!email && patient.email) setEmail(patient.email)
          } else {
            setMatchedPatient(null)
          }
        })
        .catch(() => setMatchedPatient(null))
        .finally(() => setSearchingPatient(false))
    } else {
      setMatchedPatient(null)
    }
  }, [cleanMobile])

  // Fetch real booked appointments for the selected date and doctor
  useEffect(() => {
    if (selectedDate && selectedDoctorId) {
      getPmsBookedAppointments(selectedDate, selectedDoctorId)
        .then((slots) => setBookedSlots(slots))
        .catch(() => setBookedSlots([]))
    } else {
      setBookedSlots([])
    }
  }, [selectedDate, selectedDoctorId])

  const selectedService = displayServices.find((s) => String(s.id) === String(selectedServiceId)) || services.find((s) => String(s.id) === String(selectedServiceId)) || displayServices[0] || services[0] || null

  // Filter to show only doctors associated with the selected service in PMS
  const availableDoctors = useMemo(() => {
    if (!selectedService) return doctors

    const serviceMemberIds = new Set(
      (selectedService.members || []).map((m) => String(m.id || m))
    )
    const serviceMemberNames = new Set(
      (selectedService.members || []).map((m) => (m.name || '').trim().toLowerCase()).filter(Boolean)
    )

    if (serviceMemberIds.size === 0 && serviceMemberNames.size === 0) {
      return doctors
    }

    const matched = doctors.filter((d) =>
      serviceMemberIds.has(String(d.id)) ||
      serviceMemberNames.has((d.name || '').trim().toLowerCase())
    )

    return matched.length > 0 ? matched : doctors
  }, [selectedService, doctors])

  const selectedDoctor = availableDoctors.find((d) => String(d.id) === String(selectedDoctorId)) || doctors.find((d) => String(d.id) === String(selectedDoctorId)) || null

  // Ensure selectedDoctorId is always one of the available doctors for the selected service
  useEffect(() => {
    if (availableDoctors.length > 0) {
      const exists = availableDoctors.some((d) => String(d.id) === String(selectedDoctorId))
      if (!exists) {
        setSelectedDoctorId(availableDoctors[0].id)
        setSelectedSlot(null)
      }
    }
  }, [availableDoctors, selectedDoctorId])

  const autoName = () => {
    const patientFullName = `${first} ${last}`.trim()
    const svcName = (selectedService?.name || selectedService?.Service_Name || 'Consultation').trim()
    return patientFullName ? `${svcName} - ${patientFullName}` : svcName
  }

  const effectiveApptName = apptEdited ? apptName : autoName()

  const typedFullName = `${first} ${last}`.trim().toLowerCase()
  const matchedFullName = (matchedPatient?.name || '').trim().toLowerCase()
  const isExactOrPrefillMatch = Boolean(
    matchedPatient && (
      !first.trim() ||
      !last.trim() ||
      matchedFullName === typedFullName ||
      (matchedFullName.includes(first.toLowerCase().trim()) && matchedFullName.includes(last.toLowerCase().trim()))
    )
  )

  const clearError = (key) => {
    if (errors[key]) {
      const next = { ...errors }
      delete next[key]
      setErrors(next)
    }
  }

  // Generate 21-day calendar based on live Business Hours, Holidays, Doctor Leave, and Elapsed Times
  const dates = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const list = []

    const bh = scheduleConfig.businessHours
    const bhDays = bh?.business_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

    const holidayDates = new Map()
    for (const h of (scheduleConfig.holidays || [])) {
      const hStart = (h.date || h.start_date || h.from || '').slice(0, 10)
      if (hStart) {
        holidayDates.set(hStart, h.name || 'Clinic Holiday')
      }
    }

    // Check doctor full-day leaves
    const doctorLeaveDates = new Set()
    if (selectedDoctorId) {
      for (const u of (scheduleConfig.unavailabilities || [])) {
        const uDocId = String(u.user_id?.id || u.user_id || u.user?.id || u.user || '')
        if (uDocId && uDocId !== String(selectedDoctorId)) continue
        const uStart = (u.from || u.start_date || '').slice(0, 10)
        const isFull = u.all_day === true || !u.from?.includes('T') || (u.from && u.to && (new Date(u.to) - new Date(u.from) >= 23 * 3600 * 1000))
        if (isFull && uStart) {
          doctorLeaveDates.add(uStart)
        }
      }
    }

    // Find doctor shift if any
    const docShift = (scheduleConfig.shiftHours || []).find((s) => {
      if (Array.isArray(s.users)) {
        return s.users.some((u) => String(u.id || u) === String(selectedDoctorId))
      }
      return false
    })

    // Generate dates covering at least 21 days, or extending if selectedDate is further ahead
    let daysCount = 21
    if (selectedDate) {
      const selDt = new Date(selectedDate + 'T00:00:00')
      const diffDays = Math.ceil((selDt.getTime() - today.getTime()) / 86400000)
      if (diffDays >= 21) {
        daysCount = Math.min(diffDays + 7, 90)
      }
    }

    for (let i = 0; i < daysCount; i++) {
      const dt = new Date(today.getTime() + i * 86400000)
      const key = iso(dt)
      const dayName = DAY_NAMES[dt.getDay()]
      const isClosedDay = !bhDays.includes(dayName)
      const holidayName = holidayDates.get(key)
      const isDoctorLeave = doctorLeaveDates.has(key)

      // Working blocks for this specific date
      const blocks = getWorkingBlocksForDate(key, bh, docShift)
      const isDayOff = blocks.length === 0

      // For today: check if all possible slots have already passed
      let allSlotsPassed = false
      if (key === todayKey) {
        const latestSlotStart = blocks.reduce((max, [start, end]) => Math.max(max, end - 30), 0)
        if (nowMinutes >= latestSlotStart || blocks.length === 0) {
          allSlotsPassed = true
        }
      }

      const disabled = isClosedDay || Boolean(holidayName) || isDoctorLeave || isDayOff || allSlotsPassed

      let statusReason = ''
      if (allSlotsPassed) statusReason = 'All slots for today have ended'
      else if (holidayName) statusReason = `Clinic Holiday: ${holidayName}`
      else if (isDoctorLeave) statusReason = 'Doctor is unavailable'
      else if (isClosedDay || isDayOff) statusReason = `Closed on ${dayName}s`

      list.push({
        key,
        dow: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
        day: String(dt.getDate()).padStart(2, '0'),
        mon: dt.toLocaleDateString('en-IN', { month: 'short' }),
        disabled,
        isHoliday: Boolean(holidayName),
        isOnLeave: isDoctorLeave,
        isPast: allSlotsPassed,
        reason: statusReason
      })
    }
    return list
  }, [scheduleConfig, selectedDoctorId, selectedDate])

  // Auto-select the first enabled date on load or when doctor changes if current date is disabled
  useEffect(() => {
    const curMeta = dates.find((d) => d.key === selectedDate)
    if (!selectedDate || (curMeta && curMeta.disabled)) {
      const firstActive = dates.find((d) => !d.disabled)
      if (firstActive) {
        setSelectedDate(firstActive.key)
        setSelectedSlot(null)
      } else {
        setSelectedDate(null)
        setSelectedSlot(null)
      }
    }
  }, [dates, selectedDoctorId])

  // Generate time slots based on real Duration, Working Blocks, Doctor Unavailability, and Bookings
  const slotList = useMemo(() => {
    if (!selectedService || !selectedDoctor || !selectedDate) return []
    const duration = Number(selectedService.duration) || 30

    // Find doctor shift if any
    const docShift = (scheduleConfig.shiftHours || []).find((s) => {
      if (Array.isArray(s.users)) {
        return s.users.some((u) => String(u.id || u) === String(selectedDoctor.id))
      }
      return false
    })

    const workingBlocks = getWorkingBlocksForDate(selectedDate, scheduleConfig.businessHours, docShift)
    if (workingBlocks.length === 0) return []

    // Doctor partial unavailabilities for this date
    const partialLeaves = []
    for (const u of (scheduleConfig.unavailabilities || [])) {
      const uDocId = String(u.user_id?.id || u.user_id || u.user?.id || u.user || '')
      if (uDocId && uDocId !== String(selectedDoctor.id)) continue
      const uStartStr = u.from || u.start_date || ''
      const uEndStr = u.to || u.end_date || ''
      if (uStartStr.startsWith(selectedDate)) {
        const fromM = parseTimeToMins(uStartStr.includes('T') ? uStartStr.slice(11, 16) : u.start_time)
        const toM = parseTimeToMins(uEndStr.includes('T') ? uEndStr.slice(11, 16) : u.end_time)
        if (fromM !== null && toM !== null && toM > fromM) {
          partialLeaves.push([fromM, toM])
        }
      }
    }

    const now = new Date()
    const todayKey = iso(now)
    const isToday = selectedDate === todayKey
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const out = []
    for (const [from, to] of workingBlocks) {
      for (let m = from; m + duration <= to; m += duration) {
        // If selected date is today, skip past times!
        if (isToday && m <= nowMinutes) {
          continue
        }

        const label = hhmm(m)
        const isBooked = bookedSlots.includes(label)
        const isOnLeave = partialLeaves.some(([lf, lt]) => m < lt && m + duration > lf)

        // If slot falls during doctor leave, skip it so it is not shown as strikethrough
        if (isOnLeave) {
          continue
        }

        out.push({
          m,
          label,
          taken: isBooked,
          reason: isBooked ? 'Already booked' : ''
        })
      }
    }
    return out
  }, [selectedService, selectedDoctor, selectedDate, scheduleConfig, bookedSlots])

  // Count and filter slots by period of day
  const filterCounts = useMemo(() => {
    let morning = 0, afternoon = 0, evening = 0, night = 0
    for (const s of slotList) {
      if (s.m >= 360 && s.m < 720) morning++
      else if (s.m >= 720 && s.m < 1020) afternoon++
      else if (s.m >= 1020 && s.m < 1260) evening++
      else night++
    }
    return { all: slotList.length, morning, afternoon, evening, night }
  }, [slotList])

  const displaySlots = useMemo(() => {
    if (timeFilter === 'morning') return slotList.filter((s) => s.m >= 360 && s.m < 720)
    if (timeFilter === 'afternoon') return slotList.filter((s) => s.m >= 720 && s.m < 1020)
    if (timeFilter === 'evening') return slotList.filter((s) => s.m >= 1020 && s.m < 1260)
    if (timeFilter === 'night') return slotList.filter((s) => s.m >= 1260 || s.m < 360)
    return slotList
  }, [slotList, timeFilter])

  const selectedDateMeta = useMemo(() => {
    return dates.find((d) => d.key === selectedDate) || null
  }, [dates, selectedDate])

  const isDoctorOnLeave = Boolean(
    selectedDateMeta?.isOnLeave ||
    (slotList.length > 0 && slotList.every((s) => s.taken && s.reason?.toLowerCase().includes('unavailable')))
  )

  const validate = () => {
    const errs = {}
    if (step === 1 && showDeptStep && !selectedServiceId) errs.service = 'Please choose a department to continue.'
    if (step === 2) {
      if (portalConfig.doctors?.allowDoctorSelection !== false && !selectedDoctorId) errs.doctor = 'Select a doctor.'
      if (!selectedDate) errs.slot = 'Select an appointment date.'
      else if (!selectedSlot) errs.slot = 'Select time slot'
      else if (bookedSlots.includes(selectedSlot)) errs.slot = 'This slot has already been booked. Please choose another available time.'
    }
    if (step === 3) {
      if (!first.trim()) errs.first = 'Enter the first name.'
      if (!last.trim()) errs.last = 'Enter the last name.'
      if (cleanMobile.length !== 10) errs.mobile = 'Enter a 10-digit mobile number.'
      if (portalConfig.patientForm?.requireEmail) {
        if (!email.trim()) {
          errs.email = 'Enter an email address.'
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          errs.email = 'Enter a valid email address.'
        }
      }
      if (portalConfig.patientForm?.requireReasonForVisit !== false && !complaint.trim()) {
        errs.complaint = 'Describe the patient’s complaint.'
      }
    }
    if (step === 4) {
      if (!selectedSlot) errs.slot = 'Select time slot'
      else if (bookedSlots.includes(selectedSlot)) errs.slot = 'This appointment time has already been booked. Please choose another time.'
    }
    return errs
  }

  const handleNext = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      const firstErr = Object.values(errs)[0]
      if (firstErr) {
        toast.warning(firstErr, { title: 'Required Field' })
      }
      return
    }

    if (step === 4) {
      // Create real appointment in PMS Appointments__s
      setSubmitting(true)
      try {
        const payload = {
          firstName: first.trim(),
          lastName: last.trim(),
          patientName: `${first} ${last}`.trim(),
          mobileNumber: cleanMobile,
          email: email.trim() || undefined,
          matchedPatientId: isExactOrPrefillMatch ? (matchedPatient?.id || null) : null,
          doctor: selectedDoctor ? { id: selectedDoctor.id, name: selectedDoctor.name } : null,
          doctorId: selectedDoctor?.id,
          service: selectedService ? { id: selectedService.id, name: selectedService.name || selectedService.Service_Name || 'Consultation', duration: selectedService.duration } : null,
          departmentId: selectedService?.id,
          duration: selectedService?.duration || 30,
          visitDate: selectedDate,
          startTime: selectedSlot,
          priority: priority || 'Routine',
          appointmentName: (effectiveApptName && !effectiveApptName.startsWith('null -') && !effectiveApptName.startsWith('undefined -'))
            ? effectiveApptName.trim()
            : `${(selectedService?.name || selectedService?.Service_Name || 'Consultation').trim()} - ${first} ${last}`.trim(),
          chiefComplaint: complaint.trim(),
          additionalInfo: extra.trim()
        }

        const result = await createPmsAppointment(payload)
        const refId = result?.appointmentId || result?.id || 'CONFIRMED'
        setBookingRef(refId)
        setConfirmedAppt({
          refId,
          serviceName: selectedService?.name || selectedService?.Service_Name || 'Consultation',
          doctorName: selectedDoctor?.name || 'Assigned Practitioner',
          dateLabel,
          slot: selectedSlot,
          patientName: `${first} ${last}`.trim()
        })

        // Instantly mark slot as booked locally so re-selection is prevented
        if (selectedSlot) {
          setBookedSlots((prev) => (prev.includes(selectedSlot) ? prev : [...prev, selectedSlot]))
        }
        // Also refresh booked slots from the server
        if (selectedDate && selectedDoctorId) {
          getPmsBookedAppointments(selectedDate, selectedDoctorId)
            .then((slots) => setBookedSlots(slots))
            .catch(() => {})
        }

        // Empty all form inputs so the form is fresh and clean for the next booking
        setFirst('')
        setLast('')
        setMobile('')
        setEmail('')
        setMatchedPatient(null)
        setDetailPatient(null)
        setSelectedSlot(null)
        setApptName('')
        setApptEdited(false)
        setComplaint('')
        setExtra('')
        setPriority('Routine')
        setErrors({})

        setStep(5)
        toast.success('Your appointment has been successfully confirmed!', { title: 'Booking Confirmed' })
      } catch (err) {
        console.error('Appointment booking error')
        const friendlyMsg = formatPmsErrorMessage(err.message)
        toast.error(friendlyMsg, { title: 'Booking Incomplete' })
      } finally {
        setSubmitting(false)
      }
      return
    }

    setStep((prev) => prev + 1)
    setErrors({})
  }

  const handleBack = () => {
    const minStep = showDeptStep ? 1 : 2
    if (step > minStep) {
      if (selectedDate && selectedDoctorId) {
        getPmsBookedAppointments(selectedDate, selectedDoctorId)
          .then((slots) => {
            setBookedSlots(slots)
            if (selectedSlot && slots.includes(selectedSlot)) {
              setSelectedSlot(null)
            }
          })
          .catch(() => {})
      }
      setStep((prev) => prev - 1)
      setErrors({})
    }
  }

  const handleRestart = () => {
    setStep(showDeptStep ? 1 : 2)
    if (services.length > 0) setSelectedServiceId(services[0].id)
    if (doctors.length > 0) setSelectedDoctorId(doctors[0].id)
    setSelectedDate(null)
    setSelectedSlot(null)
    setFirst('')
    setLast('')
    setMobile('')
    setEmail('')
    setMatchedPatient(null)
    setDetailPatient(null)
    setApptName('')
    setApptEdited(false)
    setComplaint('')
    setExtra('')
    setPriority('Routine')
    setErrors({})
    setSubmitError('')
    setBookingRef(null)
    setConfirmedAppt(null)
    if (selectedDate && selectedDoctorId) {
      getPmsBookedAppointments(selectedDate, selectedDoctorId)
        .then((slots) => setBookedSlots(slots))
        .catch(() => {})
    }
  }

  const dateLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : 'Select a date below'

  const formatReviewDate = (dateStr) => {
    if (!dateStr) return '—'
    const dt = new Date(dateStr + 'T00:00:00')
    const dow = dt.toLocaleDateString('en-US', { weekday: 'short' })
    const day = dt.getDate()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
    const mon = months[dt.getMonth()] || dt.toLocaleDateString('en-US', { month: 'short' })
    const year = dt.getFullYear()
    return `${dow}, ${day} ${mon}, ${year}`
  }

  const stepsRail = [
    ...(showDeptStep ? [{ num: '1', stepIndex: 1, label: 'Department', value: selectedService ? selectedService.name : 'Choose department' }] : []),
    { num: showDeptStep ? '2' : '1', stepIndex: 2, label: 'Doctor & time', value: selectedDoctor && selectedSlot ? `${selectedDoctor.name} · ${selectedSlot}` : 'Pick doctor & slot' },
    { num: showDeptStep ? '3' : '2', stepIndex: 3, label: 'Patient details', value: first || last ? `${first} ${last}`.trim() : 'Name and mobile' },
    { num: showDeptStep ? '4' : '3', stepIndex: 4, label: 'Confirm', value: bookingRef ? 'Confirmed' : 'Review and book' }
  ]

  const reviewRows = [
    { label: 'Patient', value: `${first} ${last}`.trim() || '—' },
    { label: 'Mobile', value: cleanMobile ? `+91 ${cleanMobile}` : '—' },
    ...(email ? [{ label: 'Email', value: email.trim() }] : []),
    ...(showDeptStep ? [{ label: 'Department', value: selectedService ? selectedService.name : '—' }] : []),
    ...(portalConfig.doctors?.allowDoctorSelection !== false ? [{
      label: 'Doctor',
      value: selectedDoctor
        ? (selectedDoctor.name.startsWith('Dr.') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`)
        : '—'
    }] : []),
    { label: 'Date', value: formatReviewDate(selectedDate) },
    {
      label: 'Time',
      value: selectedSlot ? `${selectedSlot}${portalConfig.departments?.showDuration !== false ? ` · ${selectedService?.duration || 30} mins` : ''}` : '—'
    },
    ...(portalConfig.patientForm?.showAppointmentName !== false ? [{
      label: 'Appointment name',
      value: effectiveApptName
        ? effectiveApptName.replace(/\s+-\s+/, ' — ')
        : (selectedService && (first || last) ? `${selectedService.name} — ${first} ${last}`.trim() : '—')
    }] : []),
    ...(portalConfig.patientForm?.showPriority !== false ? [{ label: 'Priority', value: priority || 'Routine' }] : []),
    ...(portalConfig.patientForm?.showReasonForVisit !== false ? [{ label: 'Chief complaint', value: complaint.trim() || '—' }] : []),
    ...(portalConfig.patientForm?.showAdditionalNotes !== false && extra.trim() ? [{ label: 'Additional info', value: extra.trim() }] : [])
  ]

  if (loadingData) {
    return <LoadingScreen message="Loading appointment services…" />
  }

  if (fetchError && (!services || services.length === 0)) {
    return (
      <StatusScreen
        title="Unable to load appointment services"
        error={fetchError}
        onRetry={loadData}
      />
    )
  }

  return (
    <div className="app-shell">
      {/* Brand Header (Configurable via portal-config.json) */}
      <header className="app-header">
        {portalConfig.companyDetails?.showHeader !== false && (
          <div className="app-header__inner">
            {portalConfig.companyDetails?.showLogo !== false && (
              hospitalInfo?.image && !hospitalLogoError ? (
                <div className="ph-avatar ph-avatar--image">
                  <img
                    src={hospitalInfo.image}
                    alt={hospitalInfo.name || 'Hospital Logo'}
                    className="ph-avatar-img"
                    onError={() => setHospitalLogoError(true)}
                  />
                </div>
              ) : hospitalInfo?.name ? (
                <div className="ph-avatar">
                  {getHospitalInitials(hospitalInfo.name)}
                </div>
              ) : null
            )}
            <div className="app-header__meta">
              {portalConfig.companyDetails?.showCompanyName !== false && hospitalInfo?.name && (
                <div className="ph-title" title={hospitalInfo.name}>
                  {hospitalInfo.name}
                </div>
              )}
              {portalConfig.companyDetails?.showAddress !== false && (hospitalInfo?.address || hospitalInfo?.practiceType) && (
                <div className="ph-subtitle" title={hospitalInfo.address || hospitalInfo.practiceType}>
                  {hospitalInfo.address || hospitalInfo.practiceType}
                </div>
              )}
            </div>
            {portalConfig.companyDetails?.showClinicHours !== false && hospitalInfo?.businessHours && (
              <>
                <div className="app-header__divider"></div>
                <div className="app-header__badge-wrap">
                  <span className="avail-rec-badge" title="Clinic Business Hours">
                    <i className="ti ti-clock"></i>
                    <span>Clinic Hours: {formatClinicHours(hospitalInfo.businessHours)}</span>
                  </span>
                </div>
              </>
            )}
            {portalConfig.companyDetails?.showPhone !== false && hospitalInfo?.phone && (
              <a
                href={`tel:${hospitalInfo.phone}`}
                className="app-header__phone"
                title={`Call ${hospitalInfo.phone}`}
              >
                <i className="ti ti-phone"></i>
                <span className="app-header__phone-text">{hospitalInfo.phone.startsWith('+') ? hospitalInfo.phone : `+91 ${hospitalInfo.phone}`}</span>
              </a>
            )}
          </div>
        )}

        {/* Mobile Header Stepper: Progress Bar + Step Eyebrow */}
        <div className="mobile-header-stepper">
          <div className="mobile-progress-stepper">
            {stepsRail.map((st) => (
              <div
                key={st.stepIndex}
                onClick={() => { if (step > st.stepIndex) { setStep(st.stepIndex); setErrors({}); } }}
                className={`mobile-progress-seg ${step > st.stepIndex ? 'is-completed is-clickable' : step === st.stepIndex ? 'is-active' : ''}`}
                title={step > st.stepIndex ? `Go back to ${st.label}` : ''}
              ></div>
            ))}
          </div>
          <div className="mobile-step-eyebrow">
            <span className="mobile-step-eyebrow__badge">
              {step === 5 ? 'CONFIRMED' : `STEP ${showDeptStep ? step : step - 1} OF ${stepsRail.length}`}
            </span>
            <span className="mobile-step-eyebrow__topic">
              {step === 1 ? 'Department' :
               step === 2 ? 'Doctor, Date & Time' :
               step === 3 ? 'Patient Details' :
               step === 4 ? 'Review & Confirm' : 'Appointment Confirmed'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="app-main">
        
        {/* Step Navigation Sidebar */}
        <aside className="app-sidebar">
          <div className="app-sidebar__title">
            Book appointment
          </div>
          <ol className="steps-rail">
            {stepsRail.map((st) => {
              const on = step === st.stepIndex
              const past = step > st.stepIndex
              return (
                <li key={st.stepIndex}>
                  <button
                    type="button"
                    onClick={() => { if (st.stepIndex < step) { setStep(st.stepIndex); setErrors({}); } }}
                    className={`step-rail-btn ${on ? 'is-active' : ''} ${past ? 'is-past' : 'is-disabled'}`}
                  >
                    <span className={`step-rail-badge ${past ? 'is-past' : on ? 'is-active' : ''}`}>
                      {past ? (
                        <svg
                          className="step-rail-check-icon"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" fill="#16A34A" />
                          <path
                            d="M8.5 12.5L11 15L15.5 9.5"
                            stroke="white"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        st.num
                      )}
                    </span>
                    <span className="step-rail-info">
                      <span className={`step-rail-label ${on ? 'is-active' : ''}`}>
                        {st.label}
                      </span>
                      <span className="step-rail-sub">
                        {st.value}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>


        </aside>

        {/* Wizard Form Card */}
        <section className={`wizard-card ${step === 5 ? 'wizard-card--confirmed' : ''}`}>
          {/* Card Step Header */}
          <div className="wizard-card__header">
            <div className="wizard-card__title-group">
              <div className="wizard-card__title">
                {step === 1 ? 'Book appointment' :
                 step === 2 ? 'Doctor and time' :
                 step === 3 ? 'Patient Details' :
                 step === 4 ? 'Review and Confirm' : 'Appointment Confirmed'}
              </div>
            </div>
            <span className="dsk-chip dsk-chip--brand">
              {step === 5 ? 'Confirmed' : `Step ${step} of 4`}
            </span>
          </div>

          {/* Card Body */}
          <div className="wizard-card__body">
            
            {/* STEP 1: Live Services from Services__s */}
            {step === 1 && (
              <div className="step-flow">
                <div className="section-divider">
                  <span className="section-divider__label">
                   Department
                  </span>
                  <span className="section-divider__line"></span>
                </div>

                {loadingData && (
                  <div className="loading-banner">
                    <i className="ti ti-loader"></i>
                    <span>Loading clinical departments...</span>
                  </div>
                )}

                {!loadingData && displayServices.length === 0 && (
                  <div className="empty-banner" style={{ padding: '36px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>🩺</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#10151c', marginBottom: '6px' }}>
                      No consultation services available right now
                    </div>
                    <p style={{ fontSize: '14px', color: '#667085', maxWidth: '420px', margin: '0 auto 20px', lineHeight: 1.5 }}>
                      We couldn't retrieve the list of active clinical departments. Please check your internet connection or try refreshing.
                    </p>
                    <button
                      type="button"
                      onClick={loadData}
                      className="btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}
                    >
                      <i className="ti ti-refresh"></i>
                      Refresh services
                    </button>
                  </div>
                )}

                {!loadingData && displayServices.length > 0 && (
                  <>
                    <div className="cards-grid">
                      {displayServices.map((s) => {
                        const on = String(s.id) === String(selectedServiceId)
                        const icon = getServiceIcon(s.name)
                        const docCount = s.doctorCount ?? (Array.isArray(s.members) ? s.members.length : 0)
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSelectedServiceId(s.id)
                              setSelectedSlot(null)
                              clearError('service')
                            }}
                            className={`select-card ${on ? 'is-selected' : ''}`}
                          >
                            <div className="service-card__top">
                              <span className={`service-card__icon ${on ? 'is-selected' : ''}`}>
                                <i className={`ti ${icon}`}></i>
                              </span>
                              <div className="service-card__info">
                                <div className="service-card__title">
                                  {s.name}
                                </div>
                                <div className="service-card__meta-line">
                                  {portalConfig.departments?.showDuration !== false && <span>{s.duration} min</span>}
                                  {portalConfig.departments?.showDuration !== false && portalConfig.departments?.showDoctorCount !== false && (
                                    <span className="service-card__meta-dot">•</span>
                                  )}
                                  {portalConfig.departments?.showDoctorCount !== false && (
                                    <span>{docCount} {docCount === 1 ? 'doctor' : 'doctors'}</span>
                                  )}
                                </div>
                              </div>
                              {portalConfig.departments?.showDuration !== false && (
                                <span className="service-card__badge desktop-only">
                                  {s.duration} min
                                </span>
                              )}
                              <i className="ti ti-chevron-right select-card__chevron"></i>
                            </div>

                            <div className="service-card__desc desktop-only">
                              {getServiceDescription(s)}
                            </div>

                            {portalConfig.departments?.showDoctorCount !== false && (
                              <div className="service-card__footer desktop-only">
                                <span className="service-card__doc-count">
                                  <strong className="service-card__status">
                                    {docCount > 0 ? `${docCount} ${docCount === 1 ? 'Doctor Available' : 'Doctors Available'}` : 'Doctors Available'}
                                  </strong>
                                </span>
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {errors.service && (
                      <div className="field-error-msg field-error-msg--below">
                        <i className="ti ti-alert-circle"></i>
                        <span>{errors.service}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* STEP 2: Doctor and Schedule */}
            {step === 2 && (
              <div className="step-flow--lg">
                {/* Doctor Selection from PMS Users */}
                {portalConfig.doctors?.allowDoctorSelection !== false && (
                  <div className="step-flow">
                    <div className="section-divider">
                      <span className="section-divider__label">
                        {selectedService ? `Doctors for ${selectedService.name}` : 'Doctor'}
                      </span>
                      <span className="section-divider__line"></span>
                    </div>

                    <div className="doctors-grid">
                      {availableDoctors.map((d) => {
                        const on = String(d.id) === String(selectedDoctorId)
                        const initials = (d.name || 'DR').replace(/^Dr\.\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setSelectedDoctorId(d.id)
                              setSelectedSlot(null)
                              setDisabledDateNotice(null)
                              clearError('doctor')
                            }}
                            className={`select-card ${on ? 'is-selected' : ''}`}
                          >
                            <div className="doctor-card__row">
                              <DoctorAvatar doctor={d} isSelected={on} initials={initials} />
                              <div className="doctor-card__info">
                                <div className="doctor-name" title={d.name}>{d.name}</div>
                                {portalConfig.doctors?.showSpecialization !== false && d.medicalDegrees && (
                                  <div className="doctor-degrees" title={d.medicalDegrees}>{d.medicalDegrees}</div>
                                )}
                                {portalConfig.doctors?.showSpecialization !== false && (
                                  <div className="doctor-role" title={d.role || 'Consultant Specialist'}>{d.role || 'Consultant Specialist'}</div>
                                )}
                                {d.email && (
                                  <div className="doctor-email desktop-only" title={d.email}>
                                    <i className="ti ti-mail"></i>
                                    <span className="doctor-email__text">{d.email}</span>
                                  </div>
                                )}
                              </div>
                              <i className="ti ti-chevron-right select-card__chevron"></i>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Schedule & Slot Picker */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Schedule &amp; Slots
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  <div className="form-group appointment-date-group">
                    <label className="form-label">
                      Appointment date <span className="form-required">*</span>
                    </label>
                    <DateField
                      value={selectedDate ? new Date(`${selectedDate}T00:00:00`) : null}
                      minDate={new Date()}
                      onChange={(d) => {
                        const pad = (n) => String(n).padStart(2, '0')
                        setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
                        setSelectedSlot(null)
                        clearError('slot')
                      }}
                      error={!!errors.slot && !selectedDate}
                    />
                    <span className="form-hint">Choose a date or pick below</span>
                  </div>

                  {/* 21-day Date Buttons */}
                  <div className="date-strip">
                    {dates.map((dt) => {
                      const on = dt.key === selectedDate && !dt.disabled
                      const holidayClass = dt.isHoliday ? 'is-holiday' : ''
                      const pastClass = dt.isPast ? 'is-past' : ''
                      return (
                        <button
                          key={dt.key}
                          type="button"
                          aria-disabled={dt.disabled}
                          title={dt.reason || (dt.disabled ? 'Unavailable' : dt.dow)}
                          onClick={() => {
                            if (dt.disabled) {
                              setDisabledDateNotice(`${dt.dow}, ${dt.day} ${dt.mon}: ${dt.reason || 'Unavailable'}`)
                            } else {
                              setDisabledDateNotice(null)
                              setSelectedDate(dt.key)
                              setSelectedSlot(null)
                              clearError('slot')
                            }
                          }}
                          className={`date-btn ${on ? 'is-selected' : ''} ${dt.disabled ? 'is-disabled' : ''} ${holidayClass} ${pastClass}`}
                        >
                          <span className="date-btn__dow">{dt.dow}</span>
                          <span className="date-btn__day">{dt.day}</span>
                          <span className="date-btn__mon">{dt.mon}</span>
                        </button>
                      )
                    })}
                  </div>

                  {disabledDateNotice && (
                    <div className="date-strip-notice">
                      <i className="ti ti-info-circle"></i>
                      <span>{disabledDateNotice}</span>
                      <button
                        type="button"
                        className="date-strip-notice__close"
                        onClick={() => setDisabledDateNotice(null)}
                        aria-label="Dismiss notice"
                      >
                        <i className="ti ti-x"></i>
                      </button>
                    </div>
                  )}

                  {/* Available Time Slots */}
                  <div className="form-group">
                    <span className="form-label">
                      Available time slots <span className="form-required">*</span>
                      {errors.slot && <span className="section-error inline-slot-error">{errors.slot}</span>}
                    </span>

                    {isDoctorOnLeave ? (
                      <div className="info-banner">
                        <i className="ti ti-info-circle"></i>
                        <span>
                          {selectedDoctor ? (selectedDoctor.name.startsWith('Dr.') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`) : 'Doctor'} is unavailable on this date. Please select another date.
                        </span>
                      </div>
                    ) : (
                      <>
                        {/* Time of Day Period Filter Tabs for 24-Hour Slots */}
                        {slotList.length > 0 && (
                          <div className="slot-filter-tabs">
                            <button
                              type="button"
                              onClick={() => setTimeFilter('all')}
                              className={`slot-filter-btn ${timeFilter === 'all' ? 'is-active' : ''}`}
                            >
                              All ({filterCounts.all})
                            </button>
                            {filterCounts.morning > 0 && (
                              <button
                                type="button"
                                onClick={() => setTimeFilter('morning')}
                                className={`slot-filter-btn ${timeFilter === 'morning' ? 'is-active' : ''}`}
                              >
                                Morning ({filterCounts.morning})
                              </button>
                            )}
                            {filterCounts.afternoon > 0 && (
                              <button
                                type="button"
                                onClick={() => setTimeFilter('afternoon')}
                                className={`slot-filter-btn ${timeFilter === 'afternoon' ? 'is-active' : ''}`}
                              >
                                Afternoon ({filterCounts.afternoon})
                              </button>
                            )}
                            {filterCounts.evening > 0 && (
                              <button
                                type="button"
                                onClick={() => setTimeFilter('evening')}
                                className={`slot-filter-btn ${timeFilter === 'evening' ? 'is-active' : ''}`}
                              >
                                Evening ({filterCounts.evening})
                              </button>
                            )}
                            {filterCounts.night > 0 && (
                              <button
                                type="button"
                                onClick={() => setTimeFilter('night')}
                                className={`slot-filter-btn ${timeFilter === 'night' ? 'is-active' : ''}`}
                              >
                                Night ({filterCounts.night})
                              </button>
                            )}
                          </div>
                        )}

                        {slotList.length > 0 ? (
                          displaySlots.length > 0 ? (
                            <div className="slots-grid">
                              {displaySlots.map((s) => {
                                const on = selectedSlot === s.label
                                return (
                                  <button
                                    key={s.label}
                                    type="button"
                                    disabled={s.taken}
                                    title={s.reason || undefined}
                                    onClick={() => {
                                      if (!s.taken) {
                                        setSelectedSlot(s.label)
                                        clearError('slot')
                                      }
                                    }}
                                    className={`slot-btn ${on ? 'is-selected' : ''} ${s.taken ? 'is-taken' : ''}`}
                                  >
                                    {s.label}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="info-banner">
                              <i className="ti ti-info-circle"></i>
                              <span>No slots available in this time window. Select "All" above to see all slots.</span>
                            </div>
                          )
                        ) : (
                          <div className="info-banner">
                            <i className="ti ti-info-circle"></i>
                            <span>
                              {!selectedDate
                                ? 'Select a date above to display available consultation slots.'
                                : selectedDate === iso(new Date())
                                ? 'All consultation slots for today have ended. Please select an upcoming date.'
                                : 'No slots remain on this date. Please select another day.'}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Patient Details & Match */}
            {step === 3 && (
              <div className="step-flow--lg">
                {/* Patient Information */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Patient Information
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  <div className="form-grid-3">
                    <label className="form-group">
                      <span className="form-label">
                        First name <span className="form-required">*</span>
                      </span>
                      <span className="form-control">
                        <input
                          type="text"
                          value={first}
                          onChange={(e) => { setFirst(e.target.value); clearError('first'); }}
                          placeholder="First name"
                        />
                      </span>
                      {errors.first && <span className="section-error">{errors.first}</span>}
                    </label>

                    <label className="form-group">
                      <span className="form-label"> Last name <span className="form-required">*</span></span>
                      <span className="form-control">
                        <input
                          type="text"
                          value={last}
                          onChange={(e) => { setLast(e.target.value); clearError('last'); }}
                          placeholder="Last name"
                        />
                      </span>
                      {errors.last && <span className="section-error">{errors.last}</span>}
                    </label>

                    <label className="form-group">
                      <span className="form-label">
                        Mobile number <span className="form-required">*</span>
                      </span>
                      <span className="form-control">
                        <span className="phone-prefix">
                          +91<span className="phone-prefix__divider"></span>
                        </span>
                        <input
                          type="tel"
                          value={mobile}
                          onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); clearError('mobile'); }}
                          placeholder="10-digit mobile"
                        />
                        {searchingPatient && <i className="ti ti-loader icon-loader"></i>}
                        {cleanMobile.length === 10 && !searchingPatient && (
                          <i className="ti ti-circle-check icon-check"></i>
                        )}
                      </span>
                      {errors.mobile && <span className="section-error">{errors.mobile}</span>}
                    </label>

                    {(portalConfig.patientForm?.requireEmail || portalConfig.patientForm?.showEmail) && (
                      <label className="form-group">
                        <span className="form-label">
                          Email address {portalConfig.patientForm?.requireEmail && <span className="form-required">*</span>}
                        </span>
                        <span className="form-control">
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
                            placeholder="patient@example.com"
                          />
                        </span>
                        {errors.email && <span className="section-error">{errors.email}</span>}
                      </label>
                    )}
                  </div>

                  {matchedPatient && !searchingPatient && (
                    isExactOrPrefillMatch ? (
                      <MatchCard
                        variant="found"
                        lead="Existing patient found — this appointment will be booked under their record, so history and balance stay in one place."
                        matches={[
                          patientMatchRow(matchedPatient)
                        ]}
                        foot="Name and mobile number both match this record, so the appointment is booked under it. To book someone else, change the name or the number."
                      />
                    ) : (
                      <MatchCard
                        variant="multi"
                        lead="A patient is registered on this mobile number — pick one, or keep the typed name to book a new patient on the same number."
                        matches={[
                          patientMatchRow(matchedPatient, [
                            {
                              label: 'Use this patient',
                              icon: 'ti-user-check',
                              primary: true,
                              onClick: () => {
                                const parts = String(matchedPatient.name || '').trim().split(/\s+/)
                                setFirst(matchedPatient.firstName || parts[0] || '')
                                setLast(matchedPatient.lastName || parts.slice(1).join(' ') || '')
                              }
                            }
                          ])
                        ]}
                        foot="A shared family phone is normal — the name you type is matched against the patient you pick."
                      />
                    )
                  )}
                </div>

                {/* Appointment Metadata */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Appointment Details
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  {portalConfig.patientForm?.showAppointmentName !== false && (
                    <label className="form-group">
                      <span className="form-label">Appointment name</span>
                      <span className="form-control">
                        <input
                          type="text"
                          value={effectiveApptName}
                          onChange={(e) => { setApptName(e.target.value); setApptEdited(true); }}
                        />
                      </span>
                    </label>
                  )}

                  {portalConfig.patientForm?.showReasonForVisit !== false && (
                    <label className="form-group">
                      <span className="form-label">
                        Chief complaint {portalConfig.patientForm?.requireReasonForVisit !== false && <span className="form-required">*</span>}
                      </span>
                      <span className="form-control-textarea">
                        <textarea
                          rows={3}
                          value={complaint}
                          onChange={(e) => { setComplaint(e.target.value); clearError('complaint'); }}
                          placeholder="Describe the clinical symptoms or reason for visit"
                        />
                      </span>
                      {errors.complaint && <span className="section-error">{errors.complaint}</span>}
                    </label>
                  )}

                  {portalConfig.patientForm?.showAdditionalNotes !== false && (
                    <label className="form-group">
                      <span className="form-label">Additional information</span>
                      <span className="form-control-textarea">
                        <textarea
                          rows={2}
                          value={extra}
                          onChange={(e) => setExtra(e.target.value)}
                          placeholder="Prior treatments, allergies, or notes for the doctor"
                        />
                      </span>
                    </label>
                  )}

                  {/* Priority Selector */}
                  {portalConfig.patientForm?.showPriority !== false && (
                    <div className="form-group">
                      <span className="form-label">Priority</span>
                      <div className="priority-group">
                        {priorities.map((p) => {
                          const on = priority === p
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setPriority(p)}
                              className={`priority-btn ${on ? 'is-active' : ''}`}
                            >
                              {p}
                            </button>
                          )
                        })}
                      </div>

                      {errors.doctor && (
                        <div className="field-error-msg">
                          <i className="ti ti-alert-circle"></i>
                          <span>{errors.doctor}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 4: Review and Confirm */}
            {step === 4 && (
              <div className="step-flow">
                <div className="review-card-table">
                  {reviewRows.map((r) => (
                    <div key={r.label} className="review-row">
                      <span className="review-label">{r.label}</span>
                      <span className="review-value">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 5: Appointment Confirmed */}
            {step === 5 && (
              <div className="confirmation-wrap">
                <div className="confirmation-header">
                  <span className="confirmation-icon" aria-hidden="true">
                    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="23" cy="23" r="23" fill="#DCFCE7" />
                      <circle cx="23" cy="23" r="17" fill="#16A34A" />
                      <path
                        d="M16 23.5L20.5 28L30 18.5"
                        stroke="white"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="wizard-card__title-group">
                    <span className="wizard-card__title">Appointment confirmed</span>
                    <span className="confirmation-header__subtitle">
                      {confirmedAppt?.serviceName || selectedService?.name} · {confirmedAppt?.doctorName || selectedDoctor?.name} · {confirmedAppt?.dateLabel || dateLabel} at {confirmedAppt?.slot || 'Scheduled time'}
                      {confirmedAppt?.patientName ? ` · Patient: ${confirmedAppt.patientName}` : ''}
                    </span>
                  </span>
                </div>



                <div className="confirmation-actions">
                  <button
                    type="button"
                    onClick={handleRestart}
                    className="btn-secondary btn-restart"
                  >
                    <i className="ti ti-plus"></i>Book another appointment
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Card Footer Navigation */}
          {step <= 4 && (
            <div className="wizard-footer">
              <div className="wizard-footer__btn-row">
                {step > (showDeptStep ? 1 : 2) && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="btn-back-footer"
                    aria-label="Previous step"
                    title="Go back"
                  >
                    <i className="ti ti-chevron-left"></i>
                  </button>
                )}

                <span className="wizard-footer__hint desktop-only">
                  {step === 1 ? (selectedService ? `${selectedService.duration}-minute consultation selected` : 'Select a department') :
                   step === 2 ? (selectedSlot ? `${dateLabel} at ${selectedSlot}` : 'Doctor, date and time required') :
                   step === 3 ? '' :
                   'Confirms your appointment with the clinic'}
                </span>

                <button
                  type="button"
                  disabled={submitting || (step === 1 && services.length === 0)}
                  onClick={handleNext}
                  className="btn-primary"
                >
                  <span>{submitting ? 'Confirming...' : step === 4 ? 'Confirm & book' : 'Continue'}</span>
                  <i className={submitting ? 'ti ti-loader' : step === 4 ? 'ti ti-check' : 'ti ti-chevron-right'}></i>
                </button>
              </div>
            </div>
          )}

        </section>
      </main>

      {/* Patient Full Record Detail Modal */}
      {detailPatient && (
        <PatientDetailModal
          patient={detailPatient}
          onClose={() => setDetailPatient(null)}
        />
      )}
    </div>
  )
}
