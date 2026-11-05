# Zoho Catalyst PMS Appointment Booking Portal

A modern, responsive healthcare appointment booking application built for **Zoho Catalyst** and integrated directly with **Zoho PMS (Practice Management System) Vertical CRM**.

---

## 🏗️ Architecture Overview

The application is deployed on Zoho Catalyst across two serverless components:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Zoho Catalyst Project                           │
├───────────────────────────────────┬────────────────────────────────────┤
│         Web Client Hosting        │       Serverless Function          │
│            (Frontend)             │            (Backend)               │
├───────────────────────────────────┼────────────────────────────────────┤
│ • React (Vite) Production App     │ • Node.js 20 Advanced I/O Function │
│ • Responsive UI (Mobile / Desktop)│ • Directory: pms_appointment_service│
│ • Client manifest:                │ • Zoho OAuth (Self Client)         │
│   client-package.json             │ • Connects to Zoho PMS CRM         │
│ • Hosted at: /app/                │ • Endpoints: /hospital, /doctors,  │
│                                   │   /services, /appointment, etc.    │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 1. Prerequisites (The Only Manual Preparation)

Before running the setup wizard, create a **Self Client** in the [Zoho API Console](https://api-console.zoho.in) (or `.com` for US accounts) to obtain the 4 required credentials:

| Credential | Example / Format | Purpose |
| :--- | :--- | :--- |
| **`CLIENT_ID`** | `1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` | Zoho OAuth Client ID |
| **`CLIENT_SECRET`** | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Zoho OAuth Client Secret |
| **`SOID`** | `Solution.600xxxxxxx` | Solution Org ID (from your PMS CRM URL) |
| **`SCOPES`** | *(Default provided by script)* | `Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL` |

The setup wizard will prompt for these credentials and deploy them with the backend function.

> **Catalyst Project Note:** Zoho Catalyst requires new projects to be created in the [Zoho Catalyst Console](https://console.catalyst.zoho.in) (or `.com` for US accounts). If you have not created one yet, the setup wizard will automatically open the console in your browser during Step 3 so you can click **+ Create Project**, and will then link it via `catalyst project:use`.

---

## 2. Automated Deployment (1 Command)

Everything required to build, configure, link, and deploy both the backend and frontend is **100% automated** by the setup wizard.

### Run Setup:

```powershell
.\setup.ps1
```
*(For non-interactive execution with defaults: `.\setup.ps1 -Yes`)*  
*(To stream live raw verbose logs to the console: `.\setup.ps1 -v`)*

### What the wizard handles automatically:
1. **Validates Files** — Verifies all project configs and package manifests.
2. **Prerequisites Check** — Checks Node.js ($\ge$ 18), installs Catalyst CLI globally if missing, and verifies Zoho login.
3. **Project Association** — Links your directory to your Zoho Catalyst project (auto-opens the Catalyst Console if you need to create a new project).
4. **Installs Dependencies** — Runs `npm install` for both backend and frontend.
5. **Configures & Deploys Backend** — Prompts for credentials, updates config, and deploys `pms_appointment_service`.
6. **Builds & Deploys Frontend** — Builds the production Vite bundle and deploys to Catalyst Web Client Hosting.

> **Need advanced script options?** See [**`setup.md`**](setup.md) for running specific steps (`-Step 5`, `-Start 4 -End 6`, `-Reset`).

---

## 3. WordPress Website Integration

You can seamlessly embed the appointment booking portal into any WordPress page using either the **WordPress Block Editor (Gutenberg)** or **Elementor** — no extra plugins, shortcodes, or custom CSS required.

### Step 1: Whitelist Your Website Domain in Catalyst (Required)
Before embedding, authorize your website domain in the **Zoho Catalyst Console** to allow the portal to load inside an `<iframe>`:
1. Open the [Zoho Catalyst Console](https://console.catalyst.zoho.in) and select your project.
2. In the left navigation menu, navigate to:  
   **Cloud Scale** → **Authentication** → **Whitelisting** → **Authorized Domains**
3. Click **Add Domain** (or **+ Add**).
4. Enter your WordPress domain (e.g. `https://myclinic.com` and `https://www.myclinic.com`).
5. **Enable both permissions:**
   - ✅ **iFrame** — Allows the Catalyst portal to be safely embedded without being blocked by browser `X-Frame-Options`.
   - ✅ **CORS** — Allows browser API calls from your website to your Catalyst backend.
6. Click **Save**.

> **Tip:** If testing locally in WordPress (e.g. LocalWP or XAMPP), whitelist `http://localhost` and `http://127.0.0.1`.

---

### Step 2: Exact Steps to Embed in WordPress
1. **Log in** to your WordPress Admin Dashboard.
2. Go to **Pages** → **All Pages**.
3. Open the page where you want to display the booking form (for example, *Book Appointment*).
4. Click **Edit** to open the page editor.
5. **Choose your editor:**
   - **WordPress Block Editor (Gutenberg):** Click the **`+`** icon → search for **Custom HTML** → select it.
   - **Elementor:** Click **Edit with Elementor** → search for **HTML** or **Code Snippet** in the widget panel → drag the **HTML / Code Snippet** widget onto the page.
6. **Paste your Catalyst portal `<iframe>` code** into the HTML / Code Snippet block or widget:

```html
<iframe
  src="https://<your-project-domain>.catalystserverless.in/app/?hideHeader=true"
  width="100%"
  height="880"
  frameborder="0"
  style="width: 100%; min-height: 880px; border: none; display: block;"
  loading="lazy"
  scrolling="auto"
></iframe>
```
> *(Replace `https://<your-project-domain>.catalystserverless.in/app/` with your live Catalyst Web Client URL)*

7. Click **Preview** to check that the booking portal loads correctly.
8. Click **Publish** or **Update** to save the changes.
9. Open the live WordPress page and test the appointment booking form.

---

## 📁 Project Documentation Map

| File | Purpose |
| :--- | :--- |
| [**`README.md`**](README.md) | **Master Project Reference** — Architecture, quick start, prerequisites, and WordPress integration. |
| [**`SETUP.md`**](SETUP.md) | **Setup Wizard Guide** — Step breakdown, parameters (`-Start`, `-End`, `-Step`, `-Reset`), and CLI details. |
| [**`portal-config.json`**](portal-config.json) | **Runtime App Config** — Practice branding, features, doctor titles, and slot duration. |
