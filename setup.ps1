# ==============================================================================
# PMS - Catalyst Automated Setup & Deployment Wizard
#
# USAGE
#   .\Install-PMSAppointmentBooking.ps1                 Run / resume setup
#   .\Install-PMSAppointmentBooking.ps1 -Start 5        Run step 5 to the end
#   .\Install-PMSAppointmentBooking.ps1 -Step 6         Re-run only step 6
#   .\Install-PMSAppointmentBooking.ps1 -Reset          Clear progress and start fresh
#   .\Install-PMSAppointmentBooking.ps1 -Yes            Accept defaults, no Y/n prompts
#                                                       (login, project selection and
#                                                        missing credentials still ask)

# ==============================================================================
param(

    [switch]$Reset,   # Clear previous progress and run setup from scratch

    [Alias("From", "s", "Begin")]
    [int]$Start = 0,  # Starting step number (1 to 6)

    [Alias("To", "e")]
    [int]$End = 0,    # Ending step number (1 to 6)

    [Alias("Only")]
    [int]$Step = 0,   # Execute only a single designated step number

    [Alias("y")]
    [switch]$Yes,     # Accept default answers for Y/n prompts

    [Alias("v", "Debug")]
    [switch]$VerboseOutput  # Stream full raw command output to console
)

$ErrorActionPreference = "Stop"          # Native commands are handled inside Invoke-LoggedCommand
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

# ------------------------------------------------------------------------------
# Constants

# ------------------------------------------------------------------------------
$TotalSteps     = 6
$ScriptName     = $MyInvocation.MyCommand.Name
$MinNodeMajor   = 18                     # Raise to 20 if the client uses Vite 6 or later
$ProgressFile   = Join-Path $PSScriptRoot ".setup-progress.json"
$LogFile        = Join-Path $PSScriptRoot "setup.log"
$PortalConfig   = Join-Path $PSScriptRoot "portal-config.json"
# Credentials required by the backend function. Empty value = must be entered.

$RequiredEnvVariables = [ordered]@{
    CLIENT_ID     = ""
    CLIENT_SECRET = ""
    SOID          = ""
    SCOPES        = "Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL"
}

$SecretEnvVariables = @("CLIENT_SECRET")

$script:CurrentStep = 0
$script:progress    = $null
$script:resumeMode  = $false
$script:project     = $null

# ------------------------------------------------------------------------------
# Step range normalization

# ------------------------------------------------------------------------------
if ($Step -gt 0) {
    $Start = $Step
    $End   = $Step
}

if ($Start -gt 0 -and $End -le 0) { $End = $TotalSteps }
if ($End -gt 0 -and $Start -le 0) { $Start = 1 }
$script:StartStep = if ($Start -gt 0) { $Start } else { 1 }
$script:EndStep   = if ($End -gt 0)   { $End }   else { $TotalSteps }
if ($script:StartStep -lt 1)           { $script:StartStep = 1 }
if ($script:StartStep -gt $TotalSteps) { $script:StartStep = $TotalSteps }
if ($script:EndStep -lt 1)             { $script:EndStep = 1 }
if ($script:EndStep -gt $TotalSteps)   { $script:EndStep = $TotalSteps }
if ($script:EndStep -lt $script:StartStep) { $script:EndStep = $script:StartStep }
$hasExplicitRange = ($Start -gt 0 -or $End -gt 0 -or $Step -gt 0)

function Should-ExecuteStep ($stepNum) {
    return ($stepNum -ge $script:StartStep -and $stepNum -le $script:EndStep)
}

# ------------------------------------------------------------------------------
# Logging & console output

# ------------------------------------------------------------------------------
# Console-only filter. The log file always gets every line for troubleshooting.
function Test-IsNoiseLine ($line) {
    if ([string]::IsNullOrWhiteSpace($line)) { return $true }
    # Node warnings & trace deprecation
    if ($line -match "\[DEP\d+\]" -or
        $line -match "--trace-deprecation" -or
        $line -match "^\(node:\d+\)") { return $true }
    # npm run-script echoes
    if ($line -match "^\s*>\s*\S+@\S+\s" -or
        $line -match "^\s*>\s*vite build" -or
        $line -match "^\s*>\s*npm run" -or
        $line -match "^\s*>\s*node -e") { return $true }
    # Vite build progress, chunk stats & timings
    if ($line -match "^vite v\d+" -or
        $line -match "^transforming" -or
        $line -match "modules transformed" -or
        $line -match "^rendering chunks" -or
        $line -match "^computing gzip size" -or
        $line -match "^\s*dist/" -or
        $line -match "built in \d") { return $true }
    # npm audit, funding & package noise
    if ($line -match "packages are looking for funding" -or
        $line -match "npm fund" -or
        $line -match "severity vulnerabilit" -or
        $line -match "To address all issues" -or
        $line -match "npm audit" -or
        $line -match "up to date, audited" -or
        $line -match "found \d+ vulnerabilities" -or
        $line -match "added \d+ packages") { return $true }
    # Catalyst CLI update check notice box and borders
    if ($line -match "zcatalyst-cli update check" -or
        $line -match "Try running with sudo" -or
        $line -match "local update config store" -or
        $line -match "sudo chown -R" -or
        ($line.Contains([char]0x2500) -or $line.Contains([char]0x2502) -or $line.Contains([char]0x250C) -or $line.Contains([char]0x2514))) { return $true }
    return $false
}

# Extracts relevant error lines from command output for display in clean error box
function Get-RelevantErrorLines ($lines) {
    if (-not $lines -or $lines.Count -eq 0) { return @() }
    # 1. Look for lines with clear error markers (excluding the update check notice)
    $errs = @($lines | Where-Object {
        $_ -notmatch "zcatalyst-cli update check" -and
        $_ -notmatch "Try running with sudo" -and
        $_ -notmatch "local update config store" -and
        $_ -notmatch "sudo chown -R" -and
        ($_ -match "ERR!|Error:|FAILED|Fatal|Exception|ENOTFOUND|EACCES|EADDRINUSE|invalid|rejected|Unauthorized|401|403|404|500" -or
         $_.Contains([char]0x00D7))
    })
    if ($errs.Count -gt 0) {
        return ($errs | Select-Object -Last 6)
    }

    # 2. Fallback to last non-empty, non-noise lines
    $cleanLines = @($lines | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and -not (Test-IsNoiseLine $_)
    })
    if ($cleanLines.Count -gt 0) {
        return ($cleanLines | Select-Object -Last 4)
    }

    return @()
}

# ANSI sanitizer: converts terminal color sequences to plain text
function Format-CleanLogText ($text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    $cleaned = $text -replace "\x1B(?:\[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", ""
    $cleaned = $cleaned -replace "\[[0-9;]*m", ""
    $cleaned = $cleaned -replace "`r", ""
    return $cleaned.TrimEnd()
}

# Console and log formatting with timestamps and step counts
function Get-ConsolePrefix {
    return ""
}

# No empty line break after steps in log file
function Write-LogLineBreak {
}

# Log writer: Local timestamp + step number on every line (skips blank lines)
function Write-LogLine ($text = "") {
    if ([string]::IsNullOrWhiteSpace($text)) { return }
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $stepTag = if ($script:CurrentStep -gt 0) { "[Step $($script:CurrentStep)]" } else { "[General]" }

    try {
        foreach ($line in ("$text" -split "\r?\n")) {
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                Add-Content -Path $LogFile -Value "$stamp $stepTag $line" -Encoding UTF8
            }

        }
    } catch {}
}

function Write-Banner ($text) {
    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host " $text" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-LogLine "================================================================="
    Write-LogLine " $text"
    Write-LogLine "================================================================="
}

function Write-StepHeader ($stepNumber, $title) {
    $script:CurrentStep = [int]$stepNumber
    Write-Banner "STEP $stepNumber : $title"
}

function Write-Success ($text, [switch]$ConsoleOnly) {
    $tick = [char]0x2714
    Write-Host "[$tick] $text" -ForegroundColor Green
    if (-not $ConsoleOnly -or $VerboseOutput) {
        Write-LogLine "[OK] $text"
    }
}

function Write-Warn ($text) {
    Write-Host "[!] $text" -ForegroundColor Yellow
    Write-LogLine "[!] $text"
}

function Write-Err ($text) {
    Write-Host "[x] $text" -ForegroundColor Red
    Write-LogLine "[x] $text"
}

function Write-Info ($text, $color = "Gray", [switch]$ConsoleOnly) {
    if ([string]::IsNullOrWhiteSpace($text)) {
        Write-Host ""
        if (-not $ConsoleOnly -or $VerboseOutput) { Write-LogLine "" }
        return
    }

    Write-Host $text -ForegroundColor $color
    if (-not $ConsoleOnly -or $VerboseOutput) {
        Write-LogLine $text
    }
}

function Write-Activity ($text) {
    Write-Host "  -> $text" -ForegroundColor DarkGray
    if ($VerboseOutput) {
        Write-LogLine "  -> $text"
    }
}

# Single exit point: logs exit code, pauses window if interactive
function Exit-Setup ([int]$code = 0) {
    if (-not $Yes -and $Host.Name -eq "ConsoleHost") {
        try { Read-Host "Press ENTER to close" | Out-Null } catch {}
    }

    exit $code
}

function Stop-Setup ($message, $errorDetails = $null, [string]$suggestedFix = "") {
    $timeStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $stepInfo = if ($script:CurrentStep -gt 0) { "Step $($script:CurrentStep)" } else { "Pre-check" }
    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host " SETUP FAILED : $message" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Red
    Write-LogLine "================================================================="
    Write-LogLine " SETUP FAILED : $message ($stepInfo at $timeStr)"
    Write-LogLine "================================================================="
    if ($errorDetails) {
        Write-Host ""
        Write-Host "  Error Details:" -ForegroundColor Yellow
        Write-LogLine "  Error Details:"
        $detailList = @($errorDetails)
        foreach ($d in ($detailList | Select-Object -Last 6)) {
            $trimmed = "$d".Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                Write-Host "    $trimmed" -ForegroundColor Red
                Write-LogLine "    $trimmed"
            }

        }

    }

    if (-not [string]::IsNullOrWhiteSpace($suggestedFix)) {
        Write-Host ""
        Write-Host "  Suggested Action:" -ForegroundColor Cyan
        Write-Host "    $suggestedFix" -ForegroundColor White
        Write-LogLine "  Suggested Action: $suggestedFix"
    }

    Write-Host ""
    Write-Host "  To resume after fixing:" -ForegroundColor DarkGray
    Write-Host "    .\$ScriptName" -ForegroundColor Yellow
    Write-Host "  Full troubleshooting log:" -ForegroundColor DarkGray
    Write-Host "    $LogFile" -ForegroundColor Gray
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host ""
    Exit-Setup 1
}

function Prompt-Confirm ($question, [bool]$default = $true) {
    $defPrompt = if ($default) { "(Y/n)" } else { "(y/N)" }
    if ($Yes) {
        Write-LogLine "$question $defPrompt -> default (-Yes)"
        return $default
    }

    while ($true) {
        $reply = Read-Host "$question $defPrompt"
        if ([string]::IsNullOrWhiteSpace($reply)) { $answer = $default; break }
        if ($reply -match "^(y|yes)$") { $answer = $true;  break }
        if ($reply -match "^(n|no)$")  { $answer = $false; break }
        Write-Warn "Please answer y or n."
    }

    Write-LogLine "$question $defPrompt -> $answer"
    return $answer
}

# Runs a native command; console shows clean progress by default, log gets all lines.
# Returns @{ ExitCode; Output } so callers can parse URLs or inspect errors.
function Invoke-LoggedCommand (
    [scriptblock]$scriptBlock,
    [string]$description,
    [switch]$Quiet
) {
    if ($VerboseOutput) { Write-LogLine "> $description" }
    $lines = New-Object System.Collections.Generic.List[string]
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"          # stderr warnings must not abort
    $global:LASTEXITCODE = 0
    $shouldShowOutput = $VerboseOutput -or (-not $Quiet)

    try {
        & $scriptBlock 2>&1 | ForEach-Object {
            $clean = Format-CleanLogText ($_.ToString())
            if ($clean -eq "") { return }
            $lines.Add($clean)
            if ($VerboseOutput) { Write-LogLine "    $clean" }
            if (-not $shouldShowOutput) { return }
            if (Test-IsNoiseLine $clean) { return }
            if ($clean -match "DEPLOYMENT SUCCESSFUL|deploy complete") {
                Write-Host $clean -ForegroundColor Green
            } elseif ($clean -match "https?://") {
                Write-Host $clean -ForegroundColor Cyan
            } elseif ($clean -match "ERR!|Error:|FAILED") {
                Write-Host $clean -ForegroundColor Red
            } else {
                Write-Host $clean
            }

        }

        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPref
    }

    if ($null -eq $exitCode) { $exitCode = 0 }
    if ($exitCode -ne 0 -and -not $VerboseOutput) {
        Write-LogLine "> $description (failed with exit code $exitCode)"
        foreach ($errLine in (Get-RelevantErrorLines $lines)) {
            Write-LogLine "    $errLine"
        }
    } elseif ($VerboseOutput) {
        Write-LogLine "  exit code $exitCode"
    }

    return [PSCustomObject]@{ ExitCode = [int]$exitCode; Output = $lines.ToArray() }
}

# Runs an interactive native command (login / project selection prompts)
function Invoke-InteractiveCommand ([scriptblock]$scriptBlock, [string]$description) {
    if ($VerboseOutput) { Write-LogLine "> $description (interactive)" }
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    try { & $scriptBlock } finally { $ErrorActionPreference = $savedPref }
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($VerboseOutput -or $exitCode -ne 0) { Write-LogLine "  exit code $exitCode" }
    return $exitCode
}

# First URL in command output containing $contains (null when not found)
function Find-UrlInOutput ([string[]]$output, [string]$contains) {
    foreach ($line in $output) {
        foreach ($m in [regex]::Matches($line, "https?://[^\s'`"<>]+")) {
            if ($m.Value -like "*$contains*") { return $m.Value.TrimEnd('.', ',', ')') }
        }

    }

    return $null
}

# ------------------------------------------------------------------------------
# JSON helpers

# ------------------------------------------------------------------------------
function Read-JsonFile ($path) {
    if (-not (Test-Path $path)) { throw "File not found: $path" }

    try {
        return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        throw "Invalid JSON in $path : $($_.Exception.Message)"
    }

}

function Write-JsonFile ($path, $object) {
    $json = $object | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText((Resolve-Path $path), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-JsonValue ($object, [string[]]$pathParts) {
    $cur = $object
    foreach ($p in $pathParts) {
        if ($null -eq $cur -or -not $cur.PSObject.Properties[$p]) { return $null }
        $cur = $cur.$p
    }

    return $cur
}

# ------------------------------------------------------------------------------
# Catalyst helpers

# ------------------------------------------------------------------------------
# Exit code based; output text only used to catch "not logged in" on exit code 0
function Test-CatalystLogin {
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
        $global:LASTEXITCODE = 0
        $output = (& catalyst whoami 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
        return (($LASTEXITCODE -eq 0) -and ($output -notmatch "not logged in"))
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $savedPref
    }

}

function Get-CatalystUserEmail {
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
        $output = (& catalyst whoami 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
        $cleaned = Format-CleanLogText $output
        if ($cleaned -match "Logged as:\s*([^\r\n]+)") {
            return $Matches[1].Trim()
        }

        return $null
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $savedPref
    }

}

function Get-ActiveProjectInfo {
    if (-not (Test-Path ".catalystrc")) { return $null }

    try {
        $rc = Get-Content ".catalystrc" -Raw -Encoding UTF8 | ConvertFrom-Json
        $activeIdx  = Get-JsonValue $rc @("actives", "project")
        $projects   = @(Get-JsonValue $rc @("projects"))
        $activeProj = $projects | Where-Object { $_ -and $_.idx -eq $activeIdx } | Select-Object -First 1
        if (-not $activeProj -and $projects.Count -gt 0) { $activeProj = $projects[0] }
        if (-not $activeProj) { return $null }
        $activeEnvIdx = Get-JsonValue $rc @("actives", "env")
        $envs         = @(Get-JsonValue $activeProj @("env"))
        $activeEnv    = $envs | Where-Object { $_ -and $_.idx -eq $activeEnvIdx } | Select-Object -First 1
        if (-not $activeEnv -and $envs.Count -gt 0) { $activeEnv = $envs[0] }
        return @{
            Name        = $activeProj.name
            Id          = "$($activeProj.id)"
            Domain      = Get-JsonValue $activeProj @("domain", "name")
            Environment = if ($activeEnv) { $activeEnv.name } else { "Unknown" }
        }
    } catch {
        return $null
    }

}

function Ensure-ProjectInfo {
    if (-not $script:project) {
        $script:project = Get-ActiveProjectInfo
    }

    if (-not $script:project) {
        Stop-Setup "No Catalyst project is linked to this folder. Run: .\$ScriptName -Start 3"
    }

    return $script:project
}

# Ensures the function's catalyst-config.json carries the required env variables.
# Values are deployed with the function, so the Catalyst Console is not needed.
function Set-FunctionEnvVariables ($functionDir) {
    $cfgPath = Join-Path $functionDir "catalyst-config.json"
    $cfg = Read-JsonFile $cfgPath
    if (-not $cfg.PSObject.Properties["deployment"]) {
        throw "$cfgPath has no 'deployment' section."
    }

    if (-not $cfg.deployment.PSObject.Properties["env_variables"] -or $null -eq $cfg.deployment.env_variables) {
        $cfg.deployment | Add-Member -NotePropertyName env_variables -NotePropertyValue ([PSCustomObject]@{}) -Force
    }

    $envVars = $cfg.deployment.env_variables
    # Automatically prefill default SCOPES so users never have to enter it manually
    if (-not $envVars.PSObject.Properties["SCOPES"] -or [string]::IsNullOrWhiteSpace("$($envVars.SCOPES)")) {
        $envVars | Add-Member -NotePropertyName "SCOPES" -NotePropertyValue $RequiredEnvVariables["SCOPES"] -Force
        Write-JsonFile $cfgPath $cfg
    }

    $missing = @($RequiredEnvVariables.Keys | Where-Object {
        $val = "$($envVars.$_)"
        -not $envVars.PSObject.Properties[$_] -or [string]::IsNullOrWhiteSpace($val)
    })
    if ($missing.Count -eq 0) {
        Write-Success "Environment variables present in catalyst-config.json ($($RequiredEnvVariables.Keys -join ', '))."
        return
    }

    $box = @"
=================================================================
 ACTION REQUIRED: Zoho PMS credentials
=================================================================
The backend function needs these values to connect with Zoho PMS CRM:

  CLIENT_ID     : Zoho OAuth Client ID
  CLIENT_SECRET : Zoho OAuth Client Secret
  SOID          : Solution Org ID (e.g. Solution.600xxxxxxx)
  SCOPES        : Pre-filled (Zoho PMS Solution scopes)

(Tip: In Windows PowerShell, right-click with mouse to paste text)

They are saved in:
  $cfgPath
and deployed with the function. Keep this folder private.
=================================================================
"@
    Write-Host $box -ForegroundColor Yellow
    Write-LogLine $box
    Write-LogLine "Missing: $($missing -join ', ')"
    foreach ($key in $missing) {
        $default = $RequiredEnvVariables[$key]
        $value = ""
        while ([string]::IsNullOrWhiteSpace($value)) {
            if ($SecretEnvVariables -contains $key) {
                $secure = Read-Host "  $key" -AsSecureString
                $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
                try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
                finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
            } elseif ($default) {
                $value = Read-Host "  $key [default]"
                if ([string]::IsNullOrWhiteSpace($value)) { $value = $default }
            } else {
                $value = Read-Host "  $key"
            }

            $value = "$value".Trim()
            if ([string]::IsNullOrWhiteSpace($value)) { Write-Warn "$key cannot be empty." }
        }

        $envVars | Add-Member -NotePropertyName $key -NotePropertyValue $value -Force
        Write-LogLine "  $key entered (value not logged)"
    }

    if ($envVars.PSObject.Properties["SCOPES"] -and -not [string]::IsNullOrWhiteSpace("$($envVars.SCOPES)")) {
        Write-Host "  SCOPES: $($envVars.SCOPES) (pre-filled)" -ForegroundColor Cyan
        Write-LogLine "  SCOPES: $($envVars.SCOPES) (pre-filled)"
    }

    Write-JsonFile $cfgPath $cfg
    Write-Success "Credentials saved to catalyst-config.json."
}

# ------------------------------------------------------------------------------
# Progress management

# ------------------------------------------------------------------------------
function Get-SetupProgress {
    if (Test-Path $ProgressFile) {
        try {
            return (Get-Content $ProgressFile -Raw -Encoding UTF8 | ConvertFrom-Json)
        } catch {
            Write-Warn "Progress file is unreadable. Starting fresh."
            return $null
        }

    }

    return $null
}

function New-SetupProgress {
    return [PSCustomObject]@{
        version        = "1.1"
        startedAt      = (Get-Date).ToString("o")
        updatedAt      = (Get-Date).ToString("o")
        status         = "IN_PROGRESS"
        completedSteps = @()
        data           = [PSCustomObject]@{}
    }

}

function Save-SetupProgress ($prog) {
    try {
        $prog.updatedAt = (Get-Date).ToString("o")
        $prog | ConvertTo-Json -Depth 10 | Set-Content -Path $ProgressFile -Encoding UTF8
    } catch {
        Write-Warn "Unable to save progress file: $_"
    }

}

function Mark-StepCompleted ($stepKey, $stepData = $null) {
    if (@($script:progress.completedSteps) -notcontains $stepKey) {
        $script:progress.completedSteps = @(@($script:progress.completedSteps) + $stepKey)
    }

    if ($stepData) {
        if (-not $script:progress.PSObject.Properties["data"] -or $null -eq $script:progress.data) {
            $script:progress | Add-Member -NotePropertyName data -NotePropertyValue ([PSCustomObject]@{}) -Force
        }

        $script:progress.data | Add-Member -NotePropertyName $stepKey -NotePropertyValue ([PSCustomObject]$stepData) -Force
    }

    Save-SetupProgress $script:progress
    Write-LogLineBreak
}

function Test-StepRecorded ($stepKey) {
    return (@($script:progress.completedSteps) -contains $stepKey)
}

# Skip a step only when resuming and it already completed
function Test-StepCompleted ($stepKey) {
    return ($script:resumeMode -and (Test-StepRecorded $stepKey))
}

function Get-StepData ($stepKey, $field) {
    return (Get-JsonValue $script:progress @("data", $stepKey, $field))
}

# ==============================================================================
# Execution starts here

# ==============================================================================
try {
$bannerText = @"
=================================================================
 PMS Appointment Booking Portal - Automated Setup
=================================================================
"@
Write-Host $bannerText -ForegroundColor Cyan
Write-Host "This wizard will validate your environment and deploy the portal to Zoho Catalyst." -ForegroundColor Gray
Write-Host "Logging output to: setup.log" -ForegroundColor DarkGray
if ($hasExplicitRange) {
    Write-Info "Designated Step Range: Step $script:StartStep to Step $script:EndStep" "Cyan"
}

# ------------------------------------------------------------------------------
# Portal configuration (single source of the function name)

# ------------------------------------------------------------------------------
$portalConfigJson = Read-JsonFile $PortalConfig
$FunctionName = Get-JsonValue $portalConfigJson @("catalyst", "functionName")
if ([string]::IsNullOrWhiteSpace($FunctionName)) {
    Stop-Setup "portal-config.json is missing 'catalyst.functionName'."
}

$FunctionDir = "functions/$FunctionName"

# ------------------------------------------------------------------------------
# -Reset / resume detection

# ------------------------------------------------------------------------------
if ($Reset) {
    if (Test-Path $ProgressFile) { Remove-Item $ProgressFile -Force }
    if (Test-Path $LogFile)      { Remove-Item $LogFile -Force }
    Write-Info "Previous setup progress and logs have been cleared (-Reset). Starting fresh." "Yellow"
    $script:progress = New-SetupProgress
    $script:resumeMode = $false
} elseif ($hasExplicitRange) {
    $existing = Get-SetupProgress
    $script:progress = if ($existing) { $existing } else { New-SetupProgress }
    $script:resumeMode = $false                 # Explicit range always re-runs those steps
} else {
    $existingProgress = Get-SetupProgress
    if ($existingProgress -and (@($existingProgress.completedSteps).Count -gt 0)) {
        Write-Host ""
        Write-Host "=================================================================" -ForegroundColor Cyan
        Write-Host " PREVIOUS PROGRESS DETECTED" -ForegroundColor Cyan
        Write-Host "=================================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Setup was previously started on $($existingProgress.startedAt)" -ForegroundColor Gray
        $stepLabels = [ordered]@{
            "step1" = "1. File Validation"
            "step2" = "2. Prerequisites Check (Node.js, Catalyst CLI, Login)"
            "step3" = "3. Catalyst Project Association"
            "step4" = "4. Install Dependencies"
            "step5" = "5. Deploy Backend Function"
            "step6" = "6. Build & Deploy Frontend Client"
        }

        $firstPending = 0
        $idx = 0
        foreach ($k in $stepLabels.Keys) {
            $idx++
            if (@($existingProgress.completedSteps) -contains $k) {
                Write-Host "  [$([char]0x2714)] $($stepLabels[$k]) (Completed)" -ForegroundColor Green
            } else {
                Write-Host "  [ ] $($stepLabels[$k]) (Pending)" -ForegroundColor DarkGray
                if ($firstPending -eq 0) { $firstPending = $idx }
            }

        }

        Write-Host ""
        if ($firstPending -eq 0) {
            Write-Success "All setup steps were already completed."
            if (Prompt-Confirm "Re-run the entire setup from scratch?" $false) {
                Remove-Item $ProgressFile -Force
                $script:progress = New-SetupProgress
                $script:resumeMode = $false
                $script:StartStep = 1
                $script:EndStep = $TotalSteps
                Write-Info "Cleared previous progress. Restarting setup..." "Yellow"
            } else {
                Write-Info "Setup is already complete. To re-run specific steps: .\$ScriptName -Start 5" "Cyan"
                Exit-Setup 0
            }
        } elseif ($Yes) {
            $script:progress = $existingProgress
            $script:resumeMode = $true
            $script:StartStep = $firstPending
            Write-Success "Resuming setup from Step $firstPending (-Yes)."
        } else {
            while ($true) {
                $reply = Read-Host "Resume from Step $firstPending? [Y = resume, 1-$TotalSteps = start from step, R = reset]"
                $reply = "$reply".Trim()
                if ($reply -eq "" -or $reply -match "^(y|yes)$") {
                    $script:StartStep = $firstPending; $script:resumeMode = $true; break
                } elseif ($reply -match "^[1-6]$") {
                    $script:StartStep = [int]$reply;   $script:resumeMode = $true; break
                } elseif ($reply -match "^(r|reset)$") {
                    $script:StartStep = 1;             $script:resumeMode = $false; break
                }

                Write-Warn "Invalid choice '$reply'."
            }

            Write-LogLine "Resume choice: '$reply'"
            if ($script:resumeMode) {
                $script:progress = $existingProgress
                Write-Success "Resuming setup from Step $script:StartStep to Step $script:EndStep..."
            } else {
                Remove-Item $ProgressFile -Force
                $script:progress = New-SetupProgress
                $script:EndStep = $TotalSteps
                Write-Info "Starting fresh setup from Step 1..." "Yellow"
            }

        }
    } else {
        $script:progress = New-SetupProgress
        $script:resumeMode = $false
    }

}

if (-not $script:resumeMode -and $script:StartStep -eq 1) {
    Write-LogLine " PMS Appointment Booking Portal - Automated Setup"
}

# ------------------------------------------------------------------------------
# STEP 1: File Validation

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 1) {
    Write-StepHeader "1" "File Validation"
    if (Test-StepCompleted "step1") {
        Write-Success "All required project files were previously verified (resumed)."
        Write-LogLineBreak
    } else {
        $requiredItems = @(
            "client",
            "client/public/client-package.json",
            "client/package.json",
            "functions",
            "$FunctionDir/index.js",
            "$FunctionDir/package.json",
            "$FunctionDir/catalyst-config.json",
            "catalyst.json",
            "portal-config.json",
            "package.json"
        )
        $missingItems = @()
        foreach ($item in $requiredItems) {
            if (Test-Path $item) {
                Write-Success "Found: $item"
            } else {
                Write-Err "Missing required file or directory: $item"
                $missingItems += $item
            }

        }

        if ($missingItems.Count -gt 0) {
            Stop-Setup "Required files are missing from the setup package." `
                       ($missingItems | ForEach-Object { "Missing: $_" }) `
                       "Make sure the repository was cloned or extracted completely."
        }

        # Content checks
        $catalystJson = Read-JsonFile "catalyst.json"
        $targets = @(Get-JsonValue $catalystJson @("functions", "targets"))
        if ($targets -notcontains $FunctionName) {
            Stop-Setup "catalyst.json functions.targets does not contain '$FunctionName'." `
                       @("Function in portal-config.json: $FunctionName", "Targets in catalyst.json: $($targets -join ', ')") `
                       "Verify that the function name in portal-config.json matches catalyst.json."
        }

        $clientPkg = Read-JsonFile "client/package.json"
        if (-not (Get-JsonValue $clientPkg @("scripts", "build"))) {
            Stop-Setup "client/package.json has no 'build' script." `
                       @("Missing 'build' command in client/package.json scripts") `
                       "Ensure client/package.json contains a 'build' script (e.g. 'vite build')."
        }

        [void](Read-JsonFile "$FunctionDir/catalyst-config.json")
        Write-Success "All required project files and folders verified ($($requiredItems.Count) items)."
        Mark-StepCompleted "step1"
    }

}

# ------------------------------------------------------------------------------
# STEP 2: Prerequisites Check

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 2) {
    Write-StepHeader "2" "Prerequisites Check (Node.js, Catalyst CLI, Login)"
    if ((Test-StepCompleted "step2") -and (Test-CatalystLogin)) {
        Write-Success "Node.js, Catalyst CLI, and authentication previously verified (resumed)."
        Write-LogLineBreak
    } else {
        # 2.1 Node.js
        Write-Info "Checking Node.js..." -ConsoleOnly
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Warn "Node.js is NOT installed on this system."
            $installNode = Prompt-Confirm "Do you want to install Node.js LTS now directly in this terminal?" $true
            if ($installNode) {
                $installed = $false
                # Attempt 1: winget (Windows Package Manager built into Windows 10/11)
                if (Get-Command winget -ErrorAction SilentlyContinue) {
                    Write-Info "Installing Node.js LTS via Windows Package Manager (winget)..." "Cyan"
                    $instResult = Invoke-LoggedCommand { winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements } "winget install OpenJS.NodeJS.LTS"
                    if ($instResult.ExitCode -eq 0) { $installed = $true }
                }

                # Attempt 2: Fallback to official MSI installer if winget is unavailable or failed
                if (-not $installed) {
                    Write-Info "Downloading official Node.js 20 LTS installer from nodejs.org..." "Cyan"
                    $msiUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
                    $tempMsi = Join-Path $env:TEMP "node-v20-lts-x64.msi"

                    try {
                        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
                        Invoke-WebRequest -Uri $msiUrl -OutFile $tempMsi -UseBasicParsing
                        Write-Info "Running Node.js installer..." "Cyan"
                        $msiProc = Start-Process msiexec.exe -ArgumentList "/i", "`"$tempMsi`"", "/passive", "/norestart" -Wait -PassThru
                        if ($msiProc.ExitCode -eq 0) { $installed = $true }
                    } catch {
                        Write-Warn "Node.js MSI download failed: $_"
                    } finally {
                        if (Test-Path $tempMsi) { Remove-Item $tempMsi -Force -ErrorAction SilentlyContinue }
                    }

                }

                # Refresh environment PATH in the current running PowerShell session
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
                if (Test-Path "C:\Program Files\nodejs") {
                    if ($env:Path -notlike "*C:\Program Files\nodejs*") {
                        $env:Path = "C:\Program Files\nodejs;" + $env:Path
                    }

                }

                if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
                    Stop-Setup "Node.js was installed, but this terminal needs to reload the system PATH. Please close this window, open a new PowerShell terminal, and re-run .\$ScriptName."
                }

                Write-Success "Node.js installed successfully."
            } else {
                Stop-Setup "Node.js LTS is required to run the setup and deploy. Install it from https://nodejs.org and re-run."
            }

        }

        $nodeVersion = "$(& node -v)".Trim()
        $nodeMajor = if ($nodeVersion -match "^v?(\d+)") { [int]$Matches[1] } else { 0 }
        if ($nodeMajor -lt $MinNodeMajor) {
            Stop-Setup "Node.js $nodeVersion is too old. Install Node.js LTS v$MinNodeMajor or later from https://nodejs.org."
        }

        Write-Success "Node.js is installed ($nodeVersion)"
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Stop-Setup "npm is not available. Re-install Node.js from https://nodejs.org."
        }

        # 2.2 Catalyst CLI
        Write-Info "Checking Catalyst CLI..." -ConsoleOnly
        if (-not (Get-Command catalyst -ErrorAction SilentlyContinue)) {
            Write-Warn "Catalyst CLI is not installed."
            if (-not (Prompt-Confirm "Install Catalyst CLI now via npm?" $true)) {
                Stop-Setup "Catalyst CLI is required to deploy this project."
            }

            Write-Info "Installing zcatalyst-cli globally via npm..." "Cyan"
            $inst = Invoke-LoggedCommand { npm install -g zcatalyst-cli } "npm install -g zcatalyst-cli"
            if ($inst.ExitCode -ne 0) {
                Stop-Setup "Failed to install Catalyst CLI. Run 'npm install -g zcatalyst-cli' manually (macOS/Linux may need sudo)."
            }

            if (-not (Get-Command catalyst -ErrorAction SilentlyContinue)) {
                Stop-Setup "Catalyst CLI installed, but not found in PATH yet. Open a new terminal and re-run."
            }

            Write-Success "Catalyst CLI installed successfully."
        }

        $verRes = Invoke-LoggedCommand { catalyst --version } "catalyst --version" -Quiet
        $catalystVer = ($verRes.Output | Where-Object { $_ -match "^\s*(\d+\.\d+\.\d+)" } | ForEach-Object { $matches[1] } | Select-Object -First 1)
        if (-not $catalystVer) { $catalystVer = "ready" } else { $catalystVer = "v$catalystVer" }
        Write-Success "Catalyst CLI is ready ($catalystVer)"
        # 2.3 Catalyst login
        Write-Info "Checking Catalyst login status..." "DarkGray" -ConsoleOnly
        if (Test-CatalystLogin) {
            $userEmail = Get-CatalystUserEmail
            if ($userEmail) {
                Write-Success "Authenticated with Zoho Catalyst ($userEmail)"
            } else {
                Write-Success "Authenticated with Zoho Catalyst."
            }
        } else {
            Write-Warn "You are not logged in to Catalyst. A browser window will open for Zoho login."
            if ($VerboseOutput) { Write-LogLine "> catalyst login (interactive)" }
            catalyst login
            if (-not (Test-CatalystLogin)) {
                Stop-Setup "Catalyst login was cancelled or failed." @("Not authenticated") "Run 'catalyst login' to authenticate with your Zoho account."
            }

            $userEmail = Get-CatalystUserEmail
            if ($userEmail) {
                Write-Success "Successfully logged in to Zoho Catalyst ($userEmail)"
            } else {
                Write-Success "Successfully logged in to Zoho Catalyst."
            }

        }

        Mark-StepCompleted "step2"
    }

}

# ------------------------------------------------------------------------------
# STEP 3: Project Association
#   A project counts as confirmed only if it was selected on this machine
#   (recorded in the progress file). A .catalystrc shipped in the package
#   would otherwise silently point to the developer's project.

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 3) {
    Write-StepHeader "3" "Catalyst Project Association"
    $script:project = Get-ActiveProjectInfo
    $confirmedId = Get-StepData "step3" "Id"
    if ($script:project -and $confirmedId -and ($confirmedId -eq $script:project.Id) -and -not $hasExplicitRange) {
        Write-Success "Connected to project: $($script:project.Name) (ID: $($script:project.Id)) [$($script:project.Environment)] (resumed)"
        Write-LogLineBreak
    } else {
        $mustSelect = $true
        if ($script:project) {
            Write-Success "Active project detected: $($script:project.Name) (ID: $($script:project.Id)) [$($script:project.Environment)]"
            $keep = Prompt-Confirm "Continue with project '$($script:project.Name)'?" $true
            if ($keep) {
                $mustSelect = $false
            } else {
                Write-Info "Select a different Catalyst project:" "Cyan"
            }
        } else {
            Write-Warn "No Catalyst project is associated with this folder yet."
            $hasProject = Prompt-Confirm "Do you already have a Catalyst project created in your Zoho account?" $true
            if (-not $hasProject) {
                Write-Host ""
                Write-Info "Creating a new Catalyst Project:" "Cyan"
                Write-Host "  Note: Zoho Catalyst projects must be created in the Web Console." -ForegroundColor Gray
                Write-Host "  1. Opening Zoho Catalyst Console in your default browser..." -ForegroundColor Yellow
                Write-Host "  2. In the console, click '+ Create Project' (e.g. name it ' PMS Appointment Booking')." -ForegroundColor Yellow
                Write-Host "  3. Once created, return to this terminal and press ENTER to link it!" -ForegroundColor Yellow
                Write-Host ""
                $consoleUrl = "https://console.catalyst.zoho.in"
                Write-Host "  Opening: $consoleUrl (or https://console.catalyst.zoho.com for US accounts)..." -ForegroundColor DarkGray

                try {
                    Start-Process $consoleUrl
                } catch {
                    Write-Warn "Could not open browser automatically. Please visit: $consoleUrl"
                }

                if (-not $Yes) {
                    Write-Host ""
                    $null = Read-Host "Press ENTER after creating your project in the Catalyst Console"
                }

                Write-Host ""
                Write-Info "Now select your newly created project from the list below:" "Cyan"
            } else {
                Write-Info "Select the Catalyst project to deploy into:" "Cyan"
            }

        }

        if ($mustSelect) {
            if ($VerboseOutput) { Write-LogLine "> catalyst project:use (interactive)" }
            catalyst project:use
            $script:project = Get-ActiveProjectInfo
            while (-not $script:project) {
                Write-Warn "No Catalyst project was selected."
                if ($Yes) { break }
                $retry = Prompt-Confirm "Would you like to try selecting a project again?" $true
                if ($retry) {
                    if ($VerboseOutput) { Write-LogLine "> catalyst project:use (interactive retry)" }
                    catalyst project:use
                    $script:project = Get-ActiveProjectInfo
                } else {
                    break
                }

            }

        }

        if (-not $script:project) {
            $noProjectHelp = @"
No Catalyst project was selected.

To create or link a Catalyst project:
  1. Open your Zoho Catalyst Console:
     - India DC : https://console.catalyst.zoho.in
     - US/Global: https://console.catalyst.zoho.com
  2. Click '+ Create Project' and enter a name (e.g. Appointment-Portal).
  3. Run .\$ScriptName again to resume.
"@
            Write-Host $noProjectHelp -ForegroundColor Yellow
            Write-LogLine $noProjectHelp
            Stop-Setup "No Catalyst project selected."
        }

    }

    Write-Info "    Project     : $($script:project.Name) (ID: $($script:project.Id))" "Cyan"
    Write-Info "    Environment : $($script:project.Environment)" "Cyan"
    Write-Success "Active project confirmed."
    Mark-StepCompleted "step3" @{
        Name        = $script:project.Name
        Id          = $script:project.Id
        Domain      = $script:project.Domain
        Environment = $script:project.Environment
    }

}

# ------------------------------------------------------------------------------
# STEP 4: Install Dependencies

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 4) {
    Write-StepHeader "4" "Install Dependencies (Backend & Frontend)"
    $funcModules   = Test-Path "$FunctionDir/node_modules"
    $clientModules = Test-Path "client/node_modules"
    if ((Test-StepCompleted "step4") -and $funcModules -and $clientModules) {
        Write-Success "Dependencies already installed in a previous run (resumed)."
        Write-LogLineBreak
    } else {
        Write-Info "Installing dependencies..." "Cyan" -ConsoleOnly
        Write-Activity "Installing backend dependencies ($FunctionDir)..."
        $r = Invoke-LoggedCommand { npm install --prefix $FunctionDir } "npm install --prefix $FunctionDir" -Quiet
        if ($r.ExitCode -ne 0) {
            Stop-Setup "Failed to install backend function dependencies." `
                       (Get-RelevantErrorLines $r.Output) `
                       "Check your internet connection and try running 'npm install' inside '$FunctionDir'."
        }

        Write-Success "Backend dependencies installed successfully."
        Write-Activity "Installing frontend dependencies (client)..."
        $r = Invoke-LoggedCommand { npm install --prefix client } "npm install --prefix client" -Quiet
        if ($r.ExitCode -ne 0) {
            Stop-Setup "Failed to install frontend client dependencies." `
                       (Get-RelevantErrorLines $r.Output) `
                       "Check your internet connection and try running 'npm install' inside 'client'."
        }

        Write-Success "Frontend dependencies installed successfully."
        Mark-StepCompleted "step4"
    }

}

# ------------------------------------------------------------------------------
# STEP 5: Deploy Backend Function

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 5) {
    Write-StepHeader "5" "Deploy Backend Function"
    $null = Ensure-ProjectInfo
    if (Test-StepCompleted "step5") {
        Write-Success "Backend function was previously deployed (resumed)."
        Write-LogLineBreak
    } else {
        # 5.1 Credentials (deployed with the function via catalyst-config.json)
        Set-FunctionEnvVariables $FunctionDir
        # 5.2 Deploy
        Write-Info "Deploying backend function '$FunctionName' to Catalyst..." "Cyan" -ConsoleOnly
        Write-Activity "Packaging and uploading function to Catalyst serverless..."
        $r = Invoke-LoggedCommand { catalyst deploy --only "functions:$FunctionName" } "catalyst deploy --only functions:$FunctionName" -Quiet
        if ($r.ExitCode -ne 0) {
            Stop-Setup "Backend function deployment failed." `
                       (Get-RelevantErrorLines $r.Output) `
                       "Verify your Catalyst project permissions and check credentials in catalyst-config.json."
        }

        $functionUrl = Find-UrlInOutput $r.Output "/server/$FunctionName"
        if ($functionUrl) {
            Write-Success "Backend function deployed successfully."
            Write-Info "    API Endpoint: $functionUrl" "Cyan"
        } else {
            Write-Warn "Function deployed, but its URL was not found in the deploy output. Check Catalyst Console -> Functions."
        }

        Mark-StepCompleted "step5" @{ FunctionUrl = $functionUrl }
    }

}

# ------------------------------------------------------------------------------
# STEP 6: Build & Deploy Frontend Client

# ------------------------------------------------------------------------------
if (Should-ExecuteStep 6) {
    Write-StepHeader "6" "Build & Deploy Frontend Client"
    $null = Ensure-ProjectInfo
    if (-not (Test-StepRecorded "step5")) {
        Stop-Setup "The backend function is not deployed yet." @("Missing Step 5 deployment") "Run: .\$ScriptName -Start 5"
    }

    if (Test-StepCompleted "step6") {
        Write-Success "Frontend client was previously built and deployed (resumed)."
        Write-LogLineBreak
    } else {
        # 6.1 Build
        $functionUrl = Get-StepData "step5" "FunctionUrl"
        if ($functionUrl) { $env:VITE_API_URL = $functionUrl }
        if (Test-Path "client/dist") { Remove-Item "client/dist" -Recurse -Force }   # No stale build
        Write-Info "Building frontend production bundle (Vite)..." "Cyan" -ConsoleOnly
        Write-Activity "Compiling React application..."
        $r = Invoke-LoggedCommand { npm run build --prefix client } "npm run build --prefix client" -Quiet
        if ($r.ExitCode -ne 0 -or -not (Test-Path "client/dist")) {
            Stop-Setup "Frontend client build failed." `
                       (Get-RelevantErrorLines $r.Output) `
                       "Check for syntax or JSX errors in 'client/src' and try running 'npm run build' inside 'client'."
        }

        if (-not (Test-Path "client/dist/client-package.json")) {
            Stop-Setup "client/dist/client-package.json is missing." `
                       @("client/dist/client-package.json not found") `
                       "Keep client-package.json in client/public so Vite copies it into client/dist during build."
        }

        Write-Success "Frontend production bundle built successfully."
        # 6.2 Deploy
        Write-Info "Deploying web client to Catalyst hosting..." "Cyan" -ConsoleOnly
        Write-Activity "Uploading static assets to Catalyst Web Client Hosting..."
        $r = Invoke-LoggedCommand { catalyst deploy --only client } "catalyst deploy --only client" -Quiet
        if ($r.ExitCode -ne 0) {
            Stop-Setup "Frontend client deployment failed." `
                       (Get-RelevantErrorLines $r.Output) `
                       "Verify your Catalyst project quota and hosting configuration in Catalyst Console."
        }

        $portalUrl = Find-UrlInOutput $r.Output "/app"
        if ($portalUrl) {
            Write-Success "Frontend client deployed successfully."
            Write-Info "    Booking Portal URL : $portalUrl" "Cyan"
        } else {
            Write-Warn "Client deployed, but its URL was not found in the deploy output. Check Catalyst Console -> Web Client Hosting."
        }

        Mark-StepCompleted "step6" @{ PortalUrl = $portalUrl }
    }

}

# ------------------------------------------------------------------------------
# SUMMARY - success only when every step is recorded as completed

# ------------------------------------------------------------------------------
$script:CurrentStep = 0
$allKeys = 1..$TotalSteps | ForEach-Object { "step$_" }
$pending = @($allKeys | Where-Object { -not (Test-StepRecorded $_) })
$notFound = "(not detected - see Catalyst Console)"
$portalUrlOut = Get-StepData "step6" "PortalUrl";   if (-not $portalUrlOut)   { $portalUrlOut = $notFound }
$functionUrlOut = Get-StepData "step5" "FunctionUrl"; if (-not $functionUrlOut) { $functionUrlOut = $notFound }
if ($pending.Count -eq 0) {
    $script:progress.status = "COMPLETED"
    $script:progress | Add-Member -NotePropertyName completedAt -NotePropertyValue ((Get-Date).ToString("o")) -Force
    Save-SetupProgress $script:progress
    $finalSummaryPlain = @"
=================================================================
 SETUP & DEPLOYMENT COMPLETED SUCCESSFULLY!
=================================================================

  Project Name       : $($script:project.Name) [$($script:project.Environment)]
  Booking Portal URL : $portalUrlOut
  Setup Log          : setup.log

To re-run setup from scratch: .\$ScriptName -Reset
"@
    Write-LogLine $finalSummaryPlain
    try { Add-Content -Path $LogFile -Value ("=" * 164) -Encoding UTF8 } catch {}
    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host " SETUP & DEPLOYMENT COMPLETED SUCCESSFULLY!" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Project Name       : " -NoNewline -ForegroundColor White
    Write-Host "$($script:project.Name) " -NoNewline -ForegroundColor Yellow
    Write-Host "[$($script:project.Environment)]" -ForegroundColor DarkGray
    Write-Host "  Booking Portal URL : " -NoNewline -ForegroundColor White
    Write-Host "$portalUrlOut" -ForegroundColor Cyan
    Write-Host "  Setup Log          : " -NoNewline -ForegroundColor White
    Write-Host "setup.log" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To re-run setup from scratch: " -NoNewline -ForegroundColor DarkGray
    Write-Host ".\$ScriptName -Reset" -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""
    Exit-Setup 0
} else {
    $nextStep = [int]($pending[0] -replace "step", "")
    $partialSummaryPlain = @"
=================================================================
 STEPS $script:StartStep TO $script:EndStep FINISHED - SETUP NOT COMPLETE YET
=================================================================

  Pending steps : $($pending -join ', ')
  Setup Log     : setup.log

To continue, run:
  .\$ScriptName -Start $nextStep
"@
    Write-LogLine $partialSummaryPlain
    try { Add-Content -Path $LogFile -Value ("=" * 164) -Encoding UTF8 } catch {}
    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host " STEPS $script:StartStep TO $script:EndStep FINISHED - SETUP NOT COMPLETE YET" -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Pending steps : " -NoNewline -ForegroundColor White
    Write-Host "$($pending -join ', ')" -ForegroundColor Yellow
    Write-Host "  Setup Log     : " -NoNewline -ForegroundColor White
    Write-Host "setup.log" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To continue, run:" -ForegroundColor White
    Write-Host "  .\$ScriptName -Start $nextStep" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host ""
    Exit-Setup 0
}
} catch {
    # Any unexpected PowerShell error: log it with location, keep progress, pause
    Write-LogLine "$($_.InvocationInfo.PositionMessage)"
    if ($script:progress) { Save-SetupProgress $script:progress }
    Stop-Setup "Setup stopped unexpectedly at Step $script:CurrentStep." `
               @($_.Exception.Message) `
               "Check setup.log for full script stack trace."
}