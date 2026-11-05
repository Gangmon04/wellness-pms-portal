# PMS Appointment Booking Portal — Zoho Catalyst

A production-grade, white-label appointment booking web portal integrated with **Zoho Practice Management System (PMS)** and powered by **Zoho Catalyst Serverless Functions** and **Web Client Hosting**.

---

## 🚀 Quick Setup & Deployment

To deploy this application to your Zoho Catalyst account, open your terminal in the project root and run:

```powershell
.\setup.ps1
```

> **Tip:** If PowerShell restricts script execution on your computer, run:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\setup.ps1
> ```

The interactive wizard will automatically guide you through all 6 deployment steps:
1. **File Validation** — Verifies all required files and configurations exist.
2. **Prerequisites Check** — Checks Node.js and installs/authenticates Zoho Catalyst CLI.
3. **Project Association** — Links to your Zoho Catalyst project.
4. **Dependency Installation** — Installs backend and frontend dependencies.
5. **Backend Deployment** — Configures OAuth credentials and deploys the serverless function.
6. **Frontend Deployment** — Builds the React application and deploys it to Catalyst Web Client Hosting.

For advanced deployment parameters, see [**`setup.md`**](setup.md) and [**`helpdoc.md`**](helpdoc.md).

---

## ⚙️ Customizing the Portal (`portal-config.json`)

The single master configuration file is located at the project root:
* **[`portal-config.json`](portal-config.json)**

You can customize branding, colors, feature toggles, and form requirements directly without modifying code:

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

---

## 🌐 Embedding in Your Website (WordPress, Zoho Sites, etc.)

Once deployed, you can embed the booking portal into any web page using an `<iframe>`:

```html
<iframe
  src="https://<your-domain>.catalystserverless.in/app/"
  width="100%"
  height="900"
  frameborder="0"
  style="border: none; border-radius: 14px;"
></iframe>
```

### URL Query Overrides (Optional)

You can override any configuration setting dynamically using URL query parameters:

| Parameter | Example | Effect |
| :--- | :--- | :--- |
| `hideHeader=true` | `?hideHeader=true` | Hides the top branding header (best for embedded frames). |
| `hideDept=true` | `?hideDept=true` | Skips department selection and starts directly at doctor/date selection. |
| `dept=<Name>` | `?dept=Cardiology` | Auto-selects the specified department. |
| `hideDoctors=true` | `?hideDoctors=true` | Hides doctor picker and auto-assigns practitioner. |
| `requireEmail=true` | `?requireEmail=true` | Makes email input mandatory on the booking form. |
| `first`, `last`, `mobile` | `?first=John&mobile=9876543210` | Pre-populates patient information fields. |

---

## 📁 Project Structure

```
├── portal-config.json       # Master runtime branding & feature configuration
├── catalyst.json            # Zoho Catalyst architecture mapping
├── setup.ps1                # Automated 6-step setup & deployment wizard
├── setup.md                 # Complete setup wizard documentation
├── helpdoc.md               # Quick reference guide & troubleshooting
├── client/                  # React 19 + Vite frontend web portal
│   ├── public/              # Static assets (favicons, logos, client-package.json)
│   └── src/                 # React UI components & services
└── functions/               # Catalyst Serverless Functions (ZRC Backend)
    └── pms_appointment_service/
        ├── index.js         # REST API router & rate limiter
        ├── crmApi.js        # Centralized Zoho CRM/PMS schema field definitions
        └── services/        # Appointment, doctor, schedule, and patient services
```

