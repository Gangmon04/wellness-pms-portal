# Setup Wizard Guide (`setup.ps1` & `setup.sh`)

This guide explains how to use the automated setup wizard to validate, configure, and deploy the **PMS Appointment Booking Portal** to **Zoho Catalyst**.

---

## 🚀 Quick Start

Open your terminal in this project root directory and run the command for your operating system:

### Windows (PowerShell)
```powershell
.\setup.ps1
```
> **Tip for Windows:** If PowerShell blocks script execution, run:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\setup.ps1
> ```

### macOS & Linux (Bash)
```bash
chmod +x setup.sh
./setup.sh
```

The interactive wizard will guide you through all 6 deployment steps.

---

## 📋 What the Wizard Does (6 Steps)

| Step | Name | What It Does |
| :---: | :--- | :--- |
| **1** | **File Validation** | Checks that all required project directories and configuration files exist. |
| **2** | **Prerequisites Check** | Verifies Node.js, installs Catalyst CLI globally if missing, and verifies your Zoho Catalyst login authentication. |
| **3** | **Catalyst Project Association** | Displays the active project or prompts you to link/select your Catalyst project. If no project exists yet, automatically opens the Catalyst Console in your browser so you can create one, then links it via `catalyst project:use`. |
| **4** | **Install Dependencies** | Runs `npm install` for both the backend function (`pms_appointment_service`) and frontend client (`client`). |
| **5** | **Deploy Backend Function** | Prompts to verify Zoho PMS environment variables and deploys `pms_appointment_service` to Catalyst cloud functions. |
| **6** | **Build & Deploy Frontend Client** | Syncs configurations, builds the production bundle with Vite, and deploys the web client to Catalyst Web Hosting. |

At completion, the wizard outputs your live **Portal URL** and **Backend API URL**.

---

## 🎯 Running Specific Steps (Parameters)

You can run individual steps or a range of steps without executing the entire wizard:

### 1. Run a Range of Steps (`-Start` & `-End`)
```powershell
# Run from Step 4 to Step 6 (Install & Deploy Everything)
.\setup.ps1 -Start 4 -End 6

# Or short aliases:
.\setup.ps1 -From 4 -To 6
.\setup.ps1 -s 4 -e 6
```
*(On macOS/Linux: `./setup.sh --start 4 --end 6`)*

### 2. Run from a Step to the End (`-Start`)
```powershell
# Starts at Step 3 and runs through Step 6
.\setup.ps1 -Start 3
```
*(On macOS/Linux: `./setup.sh --start 3`)*

### 3. Run Only One Specific Step (`-Step` or `-Only`)
```powershell
# Only deploy backend function (Step 5)
.\setup.ps1 -Step 5

# Only rebuild & redeploy frontend web client (Step 6)
.\setup.ps1 -Step 6

# Only install npm packages (Step 4)
.\setup.ps1 -Step 4
```
*(On macOS/Linux: `./setup.sh --step 6`)*

### 4. Run Setup from Scratch (`-Reset`)
Clears any previously saved progress and runs fresh from Step 1:
```powershell
.\setup.ps1 -Reset
```
*(On macOS/Linux: `./setup.sh --reset`)*

### 5. Stream Full Verbose Output (`-VerboseOutput` or `-v`)
By default, the setup wizard runs in **Clean Mode** — keeping the terminal output concise, quiet, and formatted with clean progress indicators, while recording all detailed logs in `setup.log`.

To stream live, raw output from internal commands (npm, vite, catalyst CLI) to the terminal:
```powershell
.\setup.ps1 -VerboseOutput

# Or shorthand:
.\setup.ps1 -v
```

---

## ⚡ Deploying Client Only or Function Only

If you made changes to only the backend or only the frontend, you don't need to redeploy the whole project:

### Option A: Using the Setup Wizard

| Task | Windows (PowerShell) | macOS & Linux (Bash) |
| :--- | :--- | :--- |
| **Deploy Backend Function Only** | `.\setup.ps1 -Step 5` | `./setup.sh --step 5` |
| **Build & Deploy Frontend Client Only** | `.\setup.ps1 -Step 6` | `./setup.sh --step 6` |
| **Install Dependencies & Deploy Backend** | `.\setup.ps1 -Start 4 -End 5` | `./setup.sh -s 4 -e 5` |

### Option B: Using Catalyst CLI Directly

If you prefer to run native Catalyst CLI commands in your terminal:

- **Deploy Function Only:**
  ```bash
  catalyst deploy --only functions
  ```
- **Deploy Client Only (Must build first):**
  ```bash
  npm run build --prefix client
  catalyst deploy --only client
  ```

### Option C: Running Locally for Development

- **Run Frontend Client locally:**
  ```bash
  npm run dev --prefix client
  ```
  *(Opens on `http://localhost:7002`)*
- **Run Backend Function locally:**
  ```bash
  node functions/pms_appointment_service/server.js
  ```
  *(Runs on `http://localhost:3000`)*
- **Or run both via Catalyst local emulator:**
  ```bash
  catalyst serve
  ```

---

## 🔧 How to Change / Rename the Backend Function

By default, the backend function is named **`pms_appointment_service`**.  
If you want to rename it (e.g. to `appointment_booking_api`), update these 4 places:

1. **Rename the Function Folder:**
   Rename the directory:
   `functions/pms_appointment_service/` ➔ `functions/<new_function_name>/`

2. **Update `catalyst.json`:**
   Change the function target name:
   ```json
   "functions": {
     "targets": [
       "<new_function_name>"
     ]
   }
   ```

3. **Update `portal-config.json`:**
   Update the function name so the client routes API requests to the new endpoint:
   ```json
   "catalyst": {
     "functionName": "<new_function_name>"
   }
   ```

4. **Update `catalyst-config.json` (inside the function folder):**
   In `functions/<new_function_name>/catalyst-config.json`:
   ```json
   {
     "name": "<new_function_name>",
     "type": "advancedio"
   }
   ```
   *(Also update `"name": "<new_function_name>"` in `functions/<new_function_name>/package.json` if desired).*

After making these changes, run the setup wizard to build and deploy with the new function name:
```powershell
.\setup.ps1 -Start 4 -End 6
```

---

## ⏯️ Pause and Resume Capability

If the setup wizard is stopped at any point (e.g. terminal closed or connection interrupted), your progress is automatically saved to `.setup-progress.json`.

When you run `.\setup.ps1` again:
- The script detects completed steps.
- Displays a checklist of completed vs pending steps.
- Prompts you to **Resume** from where you left off, start from a chosen step, or restart from scratch.

---

## 🔑 Zoho PMS Environment Variables

The backend function requires 4 credentials to connect with your Zoho Healthcare PMS CRM.

During **Step 5**, the setup wizard will check your credentials. If any are missing, it prompts you directly in the terminal (with hidden password input for `CLIENT_SECRET`), saves them to `functions/pms_appointment_service/catalyst-config.json`, and deploys them automatically with the function.

You do **not** need to manually enter them in the Catalyst Web Console. However, if you ever wish to view or update them later in the console:

### Where to View in Catalyst Console (Optional):
1. Open your browser and go to [Zoho Catalyst Console](https://console.catalyst.zoho.in) (or `.com` for US accounts).
2. Navigate to:
   ```text
   Serverless -> Functions -> pms_appointment_service -> Configuration -> Environment Variables
   ```
3. Add the following 4 keys:

| Key | Description | Example |
| :--- | :--- | :--- |
| **`CLIENT_ID`** | Zoho OAuth Client ID | `1000.XXXXXX` |
| **`CLIENT_SECRET`** | Zoho OAuth Client Secret | `xxxxxxxxxxxxxxxx` |
| **`SOID`** | Solution Org ID from PMS URL | `Solution.600xxxxxxx` |
| **`SCOPES`** | Zoho CRM & PMS Scopes | `Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL` |

---

## 🎨 Customizing Portal Settings

To change clinic branding, theme colors, doctor selection, or form fields before deploying:

1. Open **[`portal-config.json`](./portal-config.json)** in the project root.
2. Customize your preferred options:
   ```json
   {
     "theme": {
       "primaryColor": "#0284c7",
       "borderRadius": "16px"
     },
     "patientForm": {
       "requireEmail": false,
       "showPriority": true
     }
   }
   ```
3. Run Step 6 to rebuild and deploy the client:
   ```powershell
   .\setup.ps1 -Step 6
   ```

---

## 📝 Checking Logs & Troubleshooting

- **Log File:** All execution details, status checks, and errors are saved to **`setup.log`**.
- **Noisy warnings:** Low-level Node deprecation warnings and funding advertisements are automatically filtered out to keep `setup.log` clean and human-readable.
- **Reporting Issues:** If any step fails, open `setup.log` to view the exact error details and line numbers.

---

## ❓ Frequently Asked Questions

#### Q: Do I need to create any file before running setup?
**No.** All project files, configuration manifests, and scripts are pre-packaged. You do not need to create any files manually.

#### Q: Can I run this script multiple times?
**Yes.** You can run `.\setup.ps1` whenever you want to update packages, re-deploy backend functions, or re-build and deploy your frontend client.

---

## 🌐 Embedding in WordPress & Websites

Once deployed, you can embed your live portal into any website:
- See **[`WORDPRESS_INTEGRATION_GUIDE.md`](./WORDPRESS_INTEGRATION_GUIDE.md)** for complete embedding instructions, Gutenberg blocks, Elementor widgets, reusable shortcodes, and dynamic URL query parameters.


