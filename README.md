# PMS Appointment Portal — Configuration & Embed Guide

This guide explains how to customize and configure the appointment booking portal for **Zoho Sites**, **WordPress**, or any website without modifying core application code.

---

## 1. Configuration File: `portal-config.json`

The master configuration file is located directly at the **project root**:
* [`portal-config.json`](file:///d:/Employee%20Welness/wellness-pms/portal-config.json) (Master single source of truth for portal settings)

It is automatically synchronized into the client at build time (`client/src/portal-config.json` and `client/public/portal-config.json`).

### Full Configuration Reference

```json
{
  "companyDetails": {
    "showHeader": true,
    "showLogo": true,
    "showCompanyName": true,
    "showAddress": true,
    "showClinicHours": true,
    "showPhone": true
  },
  "departments": {
    "showDepartmentStep": true,
    "defaultDepartment": "",
    "showDuration": true,
    "showDoctorCount": true
  },
  "doctors": {
    "allowDoctorSelection": true,
    "showDoctorPhotos": true,
    "showSpecialization": true
  },
  "patientForm": {
    "requireEmail": false,
    "showAppointmentName": true,
    "showReasonForVisit": true,
    "requireReasonForVisit": true,
    "showAdditionalNotes": true,
    "showPriority": true
  },
  "theme": {
    "primaryColor": "#0284c7",
    "borderRadius": "16px"
  }
}
```

### Options Breakdown

| Section | Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`companyDetails`** | `showHeader` | Boolean | `true` | Show or hide the entire top branding header. |
| | `showLogo` | Boolean | `true` | Show or hide the hospital/clinic logo or initials avatar. |
| | `showCompanyName` | Boolean | `true` | Display hospital name fetched from PMS. |
| | `showAddress` | Boolean | `true` | Display clinic address / practice type. |
| | `showClinicHours` | Boolean | `true` | Display business hours badge. |
| | `showPhone` | Boolean | `true` | Display click-to-call phone button. |
| **`departments`** | `showDepartmentStep` | Boolean | `true` | Set to `false` to skip Step 1 and jump straight to Doctor & Date selection. |
| | `defaultDepartment` | String | `""` | Department ID or name (e.g. `"Cardiology"`) to auto-select. |
| | `showDuration` | Boolean | `true` | Show consultation duration badge (e.g. `30 min`). |
| | `showDoctorCount` | Boolean | `true` | Show count of available doctors on department cards. |
| **`doctors`** | `allowDoctorSelection` | Boolean | `true` | Set to `false` to auto-assign the first doctor and hide the doctor picker. |
| | `showDoctorPhotos` | Boolean | `true` | Show doctor image from PMS. If `false`, displays initials avatar. |
| | `showSpecialization` | Boolean | `true` | Show doctor degrees and role subtitle. |
| **`patientForm`** | `requireEmail` | Boolean | `false` | When `true`, shows an email field and marks it mandatory. |
| | `showAppointmentName` | Boolean | `true` | Show or hide the appointment name input field. |
| | `showReasonForVisit` | Boolean | `true` | Show or hide the chief complaint / reason for visit field. |
| | `requireReasonForVisit`| Boolean | `true` | Whether chief complaint is required (`*`) to proceed. |
| | `showAdditionalNotes` | Boolean | `true` | Show or hide the additional notes textarea. |
| | `showPriority` | Boolean | `true` | Show or hide the Routine / Urgent priority buttons. |
| **`theme`** | `primaryColor` | Hex String | `"#0284c7"` | Primary brand color applied to active buttons, tabs, and badges. |
| | `borderRadius` | String | `"16px"` | Corner roundness for cards and inputs. |

---

## 2. Dynamic URL Overrides (For WordPress & Zoho Sites Embeds)

You can override **any** setting dynamically via URL query parameters when embedding the portal into WordPress pages or Zoho Sites via `<iframe>`.

### Available Query Parameters

| Parameter | Example | Effect |
| :--- | :--- | :--- |
| `hideHeader=true` | `?hideHeader=true` | Hides the top clinic header bar (ideal when embedding inside existing website header). |
| `hideDept=true` | `?hideDept=true` | Skips Step 1 (Department step) and starts at Doctor & Date selection. |
| `dept=<name>` | `?dept=Cardiology` | Automatically preselects the specified department. |
| `hideDoctors=true` | `?hideDoctors=true` | Hides the doctor picker (auto-assigns doctor). |
| `hideDoctorPhotos=true`| `?hideDoctorPhotos=true`| Uses initials avatars instead of doctor photos. |
| `requireEmail=true` | `?requireEmail=true` | Requires patient email address. |
| `hideApptName=true` | `?hideApptName=true` | Hides the appointment name field. |
| `hideNotes=true` | `?hideNotes=true` | Hides additional notes field. |
| `hidePriority=true` | `?hidePriority=true` | Hides priority buttons. |
| `primaryColor=<hex>` | `?primaryColor=%230284c7`| Changes brand color to match the host website theme. |
| `first`, `last`, `mobile`| `?first=John&mobile=9876543210`| Prepopulates patient info if user is logged into your site. |

---

## 3. Embedding Examples

### Example A: Standard Full Portal Embed
```html
<iframe
  src="https://your-portal-url.catalystserverless.in/app/"
  width="100%"
  height="900"
  frameborder="0"
  style="border: none; border-radius: 12px;"
></iframe>
```

### Example B: Department-Specific Page (e.g. "Book Cardiology Consultation" in WordPress)
```html
<iframe
  src="https://your-portal-url.catalystserverless.in/app/?hideHeader=true&hideDept=true&dept=Cardiology"
  width="100%"
  height="820"
  frameborder="0"
  style="border: none;"
></iframe>
```

### Example C: Seamless Embedded Widget with Custom Brand Color
```html
<iframe
  src="https://your-portal-url.catalystserverless.in/app/?hideHeader=true&primaryColor=%2310b981&requireEmail=true"
  width="100%"
  height="850"
  frameborder="0"
  style="border: none;"
></iframe>
```

---

## 4. Backend CRM Module & Field API Names (`crmApi.js` & `config.js`)

Following the **WidgetRepo** single source of truth convention, all Zoho CRM / PMS module names and field API names are centralized in:
* [`functions/pms_appointment_service/crmApi.js`](file:///d:/Employee%20Welness/wellness-pms/functions/pms_appointment_service/crmApi.js) (and re-exported by [`config.js`](file:///d:/Employee%20Welness/wellness-pms/functions/pms_appointment_service/config.js))

If any module or field API name differs in your specific Zoho CRM/PMS vertical setup, you can edit it directly in `crmApi.js` or set an environment variable override without modifying service code:

| Category | Constant Group | Key Names & Defaults |
| :--- | :--- | :--- |
| **Modules** | `MODULES` | `APPOINTMENTS` (`'Appointments__s'`), `SERVICES` (`'Services__s'`), `PATIENT` (`'Patient'`), `CONTACTS` (`'Contacts'`), `APP_SETTINGS` (`'App_Settings'`), `USERS` (`'users'`), `ORG` (`'org'`) |
| **Appointments** | `APPOINTMENT_FIELDS` | `NAME` (`'Appointment_Name'`), `START_TIME` (`'Appointment_Start_Time'`), `END_TIME` (`'Appointment_End_Time'`), `APPOINTMENT_FOR` (`'Appointment_For'`), `SERVICE_NAME` (`'Service_Name'`), `OWNER` (`'Owner'`), `STATUS` (`'Status'`), `PRIORITY` (`'Priority'`) |
| **Services** | `SERVICE_FIELDS` | `NAME` (`'Service_Name'`), `DURATION` (`'Duration'`), `PRICE` (`'Price'`), `STATUS` (`'Status'`), `LOCATION` (`'Location'`), `MEMBERS` (`'Members'`) |
| **Patient** | `PATIENT_FIELDS` | `FIRST_NAME` (`'First_Name'`), `LAST_NAME` (`'Last_Last'`), `FULL_NAME` (`'Full_Name'`), `MOBILE` (`'Mobile_No'`), `EMAIL` (`'Email'`) |
| **Contacts** | `CONTACT_FIELDS` | `FIRST_NAME` (`'First_Name'`), `LAST_NAME` (`'Last_Name'`), `MOBILE` (`'Mobile'`), `PHONE` (`'Phone'`), `EMAIL` (`'Email'`), `LEAD_SOURCE` (`'Lead_Source'`) |
| **Settings** | `APP_SETTINGS_FIELDS` | `HOSPITAL_NAME` (`'Hospital_Name'`), `CONTACT_NUMBER` (`'Contact_Number'`), `EMAIL_ID` (`'Email_ID'`), `PRACTICE_TYPE` (`'Practice_Type'`) |
