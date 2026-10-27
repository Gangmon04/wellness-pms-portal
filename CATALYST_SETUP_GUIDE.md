# Zoho Catalyst Project Setup & Deployment Guide

A comprehensive, step-by-step operational guide for creating, configuring, testing, and deploying the **Wellness PMS Appointment Booking Portal** application to **Zoho Catalyst**.

---

## Architecture Overview

The application is structured into two core Catalyst components:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Zoho Catalyst Project                           │
├───────────────────────────────────┬────────────────────────────────────┤
│         Web Client Hosting        │       Serverless Function          │
│            (Frontend)             │            (Backend)               │
├───────────────────────────────────┼────────────────────────────────────┤
│ • React 19 + Vite SPA             │ • Node.js 20 Advanced I/O Function │
│ • Static build output: client/dist│ • Directory: pms_appointment_service│
│ • Client manifest:                │ • Zoho OAuth Client Credentials    │
│   client-package.json             │ • Integrates with PMS Vertical CRM │
│ • Dynamic portal-config.json      │ • Endpoints: /hospital, /doctors,  │
│ • Hosted at: /app/                │   /services, /appointment, etc.    │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Step 1: Create Catalyst Project in Console](#step-1-create-catalyst-project-in-console)
3. [Step 2: Generate Zoho OAuth API Credentials](#step-2-generate-zoho-oauth-api-credentials)
4. [Step 3: Install & Authenticate Catalyst CLI](#step-3-install--authenticate-catalyst-cli)
5. [Step 4: Link Codebase to the Catalyst Project](#step-4-link-codebase-to-the-catalyst-project)
6. [Step 5: Backend Function Configuration & Environment Variables](#step-5-backend-function-configuration--environment-variables)
7. [Step 6: Frontend Client Setup & Portal Configuration](#step-6-frontend-client-setup--portal-configuration)
8. [Step 7: Local Development & Emulation](#step-7-local-development--emulation)
9. [Step 8: Deploy to Zoho Catalyst Cloud](#step-8-deploy-to-zoho-catalyst-cloud)
10. [Step 9: Post-Deployment & Production Setup](#step-9-post-deployment--production-setup)
11. [Troubleshooting & Verification Checklist](#11-troubleshooting--verification-checklist)

---

## 1. Prerequisites

Before setting up the project, make sure you have:

| Requirement | Supported Version / Details | Purpose |
| :--- | :--- | :--- |
| **Node.js** | v18.x or v20.x LTS | Runtime for function & build tools (`node -v`) |
| **npm** | v9+ or v10+ | Package manager (`npm -v`) |
| **Catalyst CLI** | `@zoho/catalyst-cli` / `zcatalyst-cli` | Command-line tool to manage, serve, and deploy |
| **Zoho Account** | Access to Zoho Catalyst Console | India (`catalyst.zoho.in`), US (`catalyst.zoho.com`), or EU (`catalyst.zoho.eu`) |
| **Zoho PMS CRM** | Admin / Developer access | For OAuth client registration & Solution Org ID (`SOID`) |

---

## Step 1: Create Catalyst Project in Console

1. Log in to the **Zoho Catalyst Console** for your data center:
   - **India (IN)**: [https://catalyst.zoho.in](https://catalyst.zoho.in)
   - **United States (US)**: [https://catalyst.zoho.com](https://catalyst.zoho.com)
   - **Europe (EU)**: [https://catalyst.zoho.eu](https://catalyst.zoho.eu)
2. Click **Create Project**.
3. Enter Project Name (e.g. `Wellness-PMS` or `Clinic-Booking-Portal`).
4. Select the default region and environment:
   - **Development** (default active environment for testing)
5. Once created, click on the **Settings** icon (gear icon) -> **General**:
   - Note down:
     - **Project ID** (e.g., `27312000000033012`)
     - **Project Domain Name** (e.g., `wellness-pms-60060142033.development.catalystserverless.in`)
     - **Environment ID** (e.g., `60060142033`)

---

## Step 2: Generate Zoho OAuth API Credentials (Self Client)

The backend service connects to Zoho Vertical PMS CRM using OAuth 2.0 Client Credentials Grant via a **Self Client**.

1. Open the [Zoho Developer API Console](https://api-console.zoho.in) (use the same DC as your PMS account, e.g. `.in`, `.com`, or `.eu`).
2. Click **Add Client** -> Select **Self Client** (recommended and used for our application).
3. Click **Create** (or view your existing Self Client):
   - You will directly get:
     - **Client ID** (`CLIENT_ID`)
     - **Client Secret** (`CLIENT_SECRET`)
   *(Self Client does not require setting up redirect URLs or web callback endpoints).*
4. Required API Scopes:
   ```text
   Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL
   ```
5. Obtain your **Solution Org ID (SOID)**:
   - Open your Zoho Vertical PMS portal in the browser.
   - Inspect the URL or look under **Setup > Developer Space / Organization**:
   - Format: `Solution.<ORG_ID>` (e.g. `Solution.60062949403` or `Solution.60087134054`).
6. How authentication works in code:
   - [`zohoAuth.js`](file:///d:/Employee%20Welness/wellness-pms/functions/pms_appointment_service/zohoAuth.js) sends a `POST` request to `https://accounts.zoho.in/oauth/v2/token` with:
     ```javascript
     {
       grant_type: 'client_credentials',
       client_id: CLIENT_ID,
       client_secret: CLIENT_SECRET,
       scope: SCOPES,
       soid: SOID
     }
     ```
   - Zoho Accounts returns an `access_token` which our function automatically caches and refreshes every 55 minutes.

---

## Step 3: Install & Authenticate Catalyst CLI

1. Install the Catalyst CLI globally on your development machine:
   ```bash
   npm install -g zcatalyst-cli
   ```
   *(Verify installation with `catalyst --version`)*

2. Log in to your Zoho Catalyst account:
   ```bash
   catalyst login
   ```
   - When prompted, choose the correct data center domain (**IN**, **US**, or **EU** matching your account).
   - A browser window will open for confirmation. Click **Accept**.
3. Verify your login status:
   ```bash
   catalyst whoami
   ```

---

## Step 4: Link Codebase to the Catalyst Project

1. Navigate to the root directory of this repository:
   ```bash
   cd "d:\Employee Welness\wellness-pms"
   ```

2. Associate this folder with your newly created Catalyst project:
   ```bash
   catalyst project:use
   ```
   - Select your project from the interactive list.
   - Select the target environment: **Development**.

3. Verify Project Configuration:
   - The CLI will generate or update [`.catalystrc`](file:///d:/Employee%20Welness/wellness-pms/.catalystrc) with your project ID and environment.
   - Check [`catalyst.json`](file:///d:/Employee%20Welness/wellness-pms/catalyst.json) at root to confirm component definitions:
     ```json
     {
       "client": {
         "source": "client/dist"
       },
       "functions": {
         "targets": [
           "pms_appointment_service"
         ],
         "ignore": [],
         "source": "functions"
       }
     }
     ```

---

## Step 5: Backend Function Configuration & Environment Variables

### A. Install Backend Dependencies
```bash
cd functions/pms_appointment_service
npm install
cd ../..
```

### B. Configure Local Environment File (`.env`)
Create or edit `functions/pms_appointment_service/.env`:
```env
# Zoho Vertical PMS OAuth Client Credentials
CLIENT_ID=1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SOID=Solution.600XXXXXXXX
SCOPES=Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL

# Regional Endpoints (defaults to .in; adjust if using .com or .eu)
PMS_BASE_URL=https://pms.zohovertical.in/crm
ZOHO_ACCOUNTS_URL=https://accounts.zoho.in

# Optional CORS Allowed Origins (comma-separated list for embedded iframes)
# ALLOWED_ORIGINS=https://myclinic.com,https://clinic.zohosites.in
```

### C. Configure Cloud Environment Variables in Catalyst Console
When running in production on the Catalyst Cloud, the function reads from Catalyst Console Environment Variables:
1. Open **Catalyst Console** > Select your project.
2. In the left navigation, go to **Serverless** > **Functions**.
3. Click on **`pms_appointment_service`** > Select the **Configuration** tab.
4. Under **Environment Variables**, add the keys:
   - `CLIENT_ID`
   - `CLIENT_SECRET`
   - `SOID`
   - `SCOPES`
   - `PMS_BASE_URL` (e.g. `https://pms.zohovertical.in/crm`)
   - `ZOHO_ACCOUNTS_URL` (e.g. `https://accounts.zoho.in`)
   - `ALLOWED_ORIGINS` (e.g. `*` or specific website domains)
5. Click **Save**.

---

## Step 6: Frontend Client Setup & Portal Configuration

### A. Install Client Dependencies
```bash
cd client
npm install
cd ..
```

### B. Customize Portal Settings (`portal-config.json`)
The application uses [`portal-config.json`](file:///d:/Employee%20Welness/wellness-pms/portal-config.json) at the root as the single source of truth for:
- Clinic Header, Address, Phone visibility
- Department selection step (enabled/disabled or default department)
- Doctor selection & photos
- Patient form fields (mandatory/optional email, visit reason, notes)
- Theme colors and corner radius

*Whenever you modify `portal-config.json`, run `npm run sync-config` (or it will automatically run before `dev` and `build`).*

### C. Verify Web Client Manifest
Ensure [`client/public/client-package.json`](file:///d:/Employee%20Welness/wellness-pms/client/public/client-package.json) contains:
```json
{
  "name": "pms-appointment-app",
  "version": "1.0.0",
  "homepage": "index.html"
}
```
*(This is copied into `client/dist/` at build time so Catalyst Web Client Hosting serves the SPA correctly).*

---

## Step 7: Local Development & Emulation

### Option A: Local Dev Server with Vite (Fastest Development Workflow)
Run backend and frontend independently for instant Hot Module Replacement (HMR):

1. **Terminal 1 — Backend Function Server**:
   ```bash
   cd functions/pms_appointment_service
   npm start
   ```
   *(Starts HTTP server on `http://127.0.0.1:3000` executing `index.js`)*

2. **Terminal 2 — Frontend Vite Server**:
   ```bash
   cd client
   npm run dev
   ```
   *(Starts Vite on `http://localhost:7002` with reverse proxy mapping `/server` -> `http://127.0.0.1:3000`)*

Open your browser at `http://localhost:7002`.

---

### Option B: Catalyst CLI Emulator (`catalyst serve`)
To test under exact Catalyst runtime behavior:

1. Build the frontend client:
   ```bash
   npm run build --prefix client
   ```
2. Run Catalyst emulator from project root:
   ```bash
   catalyst serve
   ```
3. Test URLs:
   - Client App: `http://localhost:3000/app/`
   - Backend API: `http://localhost:3000/server/pms_appointment_service/hospital`

---

## Step 8: Deploy to Zoho Catalyst Cloud

### 1. Build Client First
Catalyst deploys the static files compiled in `client/dist`. Always ensure a clean build:
```bash
npm run build --prefix client
```

### 2. Deploy Everything (Client + Function)
```bash
catalyst deploy
```

### 3. Or Deploy Selectively
- **Deploy only the Backend Function**:
  ```bash
  catalyst deploy --only functions
  ```
- **Deploy only the Frontend Web Client**:
  ```bash
  catalyst deploy --only client
  ```

Once deployment completes, the CLI outputs your live URLs:
- **Hosted Web App**: `https://<domain>.catalystserverless.in/app/`
- **Function Endpoint**: `https://<domain>.catalystserverless.in/server/pms_appointment_service/`

---

## Step 9: Post-Deployment & Production Setup

### 1. Promote to Production Environment
1. In the **Catalyst Console**, navigate to **Environments**.
2. Promote the build from **Development** to **Production**.
3. Re-verify the **Environment Variables** in the Production tab to ensure OAuth credentials are set.

### 2. Map Custom Domain & SSL (Optional)
1. Go to **Catalyst Console > Web Client Hosting > Custom Domain**.
2. Add your custom domain (e.g. `appointments.yourclinic.com`).
3. Add the generated CNAME record to your DNS provider (Cloudflare, GoDaddy, Route53, etc.).
4. Catalyst automatically provisions a free SSL certificate.

### 3. Embed into WordPress or Zoho Sites
You can embed the live portal anywhere using an `<iframe>`:

```html
<iframe
  src="https://<project-domain>.catalystserverless.in/app/?hideHeader=true&primaryColor=%230284c7"
  width="100%"
  height="880"
  frameborder="0"
  style="border: none; border-radius: 12px;"
></iframe>
```

---

## 11. Troubleshooting & Verification Checklist

| Symptom / Error | Root Cause | Solution |
| :--- | :--- | :--- |
| **`Missing required Zoho OAuth environment variable(s)`** | `CLIENT_ID`, `CLIENT_SECRET`, or `SOID` not found | Add values to `functions/pms_appointment_service/.env` (local) or **Catalyst Console > Functions > Configuration > Environment Variables** (cloud). |
| **`401 Unauthorized` or `invalid_client`** | Wrong OAuth Client ID/Secret or DC mismatch | Check whether the account is in `.in`, `.com`, or `.eu`. Match `ZOHO_ACCOUNTS_URL` to `https://accounts.zoho.in` (or `.com`). |
| **`SOID invalid or access denied`** | Solution Org ID does not match the vertical | Confirm your PMS URL org ID; verify scopes in API Console include `Solution.org.ALL` and `Solution.coql.READ`. |
| **`CORS blocked` error when embedding in iframe** | The host website domain is not in allowed origins | Add your website domain to `ALLOWED_ORIGINS` (or set `ALLOWED_ORIGINS=*`) in function environment variables. |
| **Blank page after deploying client** | `client/dist` was not built before `catalyst deploy` | Run `npm run build --prefix client` and redeploy using `catalyst deploy --only client`. |
| **Catalyst 404 on page reload** | Missing single-page app rewrite rule | Ensure [`client/public/client-package.json`](file:///d:/Employee%20Welness/wellness-pms/client/public/client-package.json) has `"homepage": "index.html"`. |

---

## Key CLI Commands Quick Reference

```bash
# Authenticate
catalyst login
catalyst whoami

# Select or switch project
catalyst project:use

# Run local development emulator
catalyst serve

# Deploy to Catalyst Cloud
catalyst deploy
catalyst deploy --only client
catalyst deploy --only functions

# Inspect function logs in real-time
catalyst logs
```
