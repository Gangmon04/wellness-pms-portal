<#
.SYNOPSIS
    Builds a clean, production-ready Appointment-Booking.zip for customer distribution.

.DESCRIPTION
    Packages all source code, deployment scripts, and configuration files into Appointment-Booking.zip.
    Strictly excludes:
      - .git/ (entire commit history and repository metadata)
      - node_modules/ (at all directory levels)
      - dist/ (compiled artifacts; customer builds fresh on deployment)
      - .env files (except template .env.example)
      - .catalystrc (local project linking artifacts)
      - Logs (*.log) and temporary files (*.tmp)
      - IDE configs (.vscode, .idea)
      - Existing .zip files
      - Packaging scripts (build.ps1)
#>

[CmdletBinding()]
param(
    [string]$OutputFile = "Appointment-Booking.zip"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

$ZipPath = Join-Path $ProjectRoot $OutputFile
$TempZipPath = "$ZipPath.tmp"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Building Clean Distribution Archive: $OutputFile" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify catalyst-config.json has no hardcoded secret credentials
$configPath = Join-Path $ProjectRoot "functions\pms_appointment_service\catalyst-config.json"
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $envVars = $cfg.deployment.env_variables
        if ($envVars -and ($envVars | Get-Member -MemberType NoteProperty).Count -gt 0) {
            $sensitiveKeys = @("CLIENT_ID", "CLIENT_SECRET", "SOID")
            $removed = $false
            foreach ($sKey in $sensitiveKeys) {
                if ($envVars.PSObject.Properties[$sKey]) {
                    $envVars.PSObject.Properties.Remove($sKey)
                    $removed = $true
                }
            }
            if ($removed) {
                Write-Host "  -> Removed sensitive API credentials from catalyst-config.json for distribution." -ForegroundColor Green
            }
            $cfg | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
        }
    } catch {
        Write-Host "[WARN] Could not parse catalyst-config.json: $_" -ForegroundColor Yellow
    }
}

# 2. Collect all files while filtering exclusions
$ExcludedDirNames = @(".git", "node_modules", "dist", ".vscode", ".idea", "scratch", "test", ".gemini")

$allFiles = Get-ChildItem -Path $ProjectRoot -Recurse -File -Force

$filesToZip = @()
foreach ($file in $allFiles) {
    # Check if any parent folder is in the excluded directory list
    $relPath = $file.FullName.Substring($ProjectRoot.Length).TrimStart("\", "/")
    $parts = $relPath -split "[\\/]"
    
    $isDirExcluded = $false
    foreach ($part in $parts[0..($parts.Length - 2)]) {
        if ($ExcludedDirNames -contains $part) {
            $isDirExcluded = $true
            break
        }
    }
    if ($isDirExcluded) { continue }

    $fileName = $file.Name

    # Check file exclusions
    if ($fileName -like "*.zip" -or 
        $fileName -like "*.tmp" -or 
        $fileName -like "*.log" -or 
        $fileName -like ".catalystrc*" -or 
        $fileName -like ".setup-progress*" -or 
        $fileName -eq ".DS_Store" -or 
        $fileName -eq "Thumbs.db" -or 
        $fileName -eq "build.ps1") {
        continue
    }

    # Exclude all .env files EXCEPT .env.example
    if ($fileName.StartsWith(".env") -and $fileName -ne ".env.example") {
        continue
    }

    $filesToZip += [PSCustomObject]@{
        FullName = $file.FullName
        RelPath  = $relPath
    }
}

Write-Host "Files selected for packaging: $($filesToZip.Count)" -ForegroundColor Green

# 3. Create ZIP archive using .NET
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $TempZipPath) { Remove-Item $TempZipPath -Force }

$archive = [System.IO.Compression.ZipFile]::Open($TempZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $filesToZip) {
        # Normalize entry path with forward slashes inside zip under root folder Appointment-Booking/
        $entryName = "Appointment-Booking/" + $item.RelPath.Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $item.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}

# 4. Replace output ZIP
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}
Move-Item -Path $TempZipPath -Destination $ZipPath -Force

$finalSizeKb = [math]::Round((Get-Item $ZipPath).Length / 1KB, 1)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Distribution ZIP Created Successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Path:          $ZipPath" -ForegroundColor White
Write-Host "  Archive Size:  $finalSizeKb KB" -ForegroundColor White
Write-Host "  Total Files:   $($filesToZip.Count)" -ForegroundColor White
Write-Host "  Excluded:      .git, node_modules, dist, .catalystrc, .env, build.ps1, credentials" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
