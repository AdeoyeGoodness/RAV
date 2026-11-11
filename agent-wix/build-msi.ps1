# RAV Monitoring Agent - Universal MSI Build Script
# Builds ONE universal MSI - never rebuilt per customer.
# Enrollment happens at INSTALL-TIME via msiexec properties / the GUI.
#
# Code signing (optional but STRONGLY recommended for a clean install):
#   Pass -CertThumbprint <sha1>  (or set env RAV_SIGN_THUMBPRINT) to Authenticode-sign
#   both the agent exe and the MSI. Signing is what lets the agent install cleanly
#   without anyone disabling Defender / SmartScreen / Smart App Control. If no
#   thumbprint is given, the build still runs but emits an UNSIGNED artifact and warns.
#   See deployment/SIGNING-AND-CLEAN-INSTALL.md.

param(
    [string]$CertThumbprint = $env:RAV_SIGN_THUMBPRINT,
    [string]$TimestampUrl   = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

# Paths
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $ProjectRoot "agent"
$ExtensionDir = Join-Path $ProjectRoot "extension"
$WixDir = $PSScriptRoot
$OutputDir = Join-Path $WixDir "output"

# ---- Signing helpers ---------------------------------------------------------
function Get-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # Fall back to the newest signtool shipped with the Windows 10/11 SDK.
    $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "${env:ProgramFiles}\Windows Kits\10\bin")
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $found = Get-ChildItem -Path $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                     Where-Object { $_.FullName -match 'x64' } |
                     Sort-Object FullName -Descending | Select-Object -First 1
            if ($found) { return $found.FullName }
        }
    }
    return $null
}

function Invoke-Sign {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($CertThumbprint)) {
        Write-Host "  WARNING: no signing cert (-CertThumbprint / RAV_SIGN_THUMBPRINT). Leaving UNSIGNED: $Path" -ForegroundColor Yellow
        Write-Host "           An unsigned agent will be flagged by Defender/SmartScreen and blocked by Smart App Control." -ForegroundColor Yellow
        return
    }
    $signtool = Get-SignTool
    if (-not $signtool) {
        Write-Host "ERROR: -CertThumbprint was given but signtool.exe was not found. Install the Windows SDK." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Signing $Path" -ForegroundColor Yellow
    & $signtool sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint $Path
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: signing failed for $Path" -ForegroundColor Red
        exit 1
    }
    & $signtool verify /pa /q $Path
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: signature verification failed for $Path" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: signed + verified $Path" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RAV Monitoring Agent - MSI Builder    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($CertThumbprint)) {
    Write-Host "  Signing: DISABLED (no cert) - artifacts will be UNSIGNED" -ForegroundColor Yellow
} else {
    Write-Host "  Signing: ENABLED (thumbprint $CertThumbprint)" -ForegroundColor Green
}
Write-Host ""

# Step 1: Build the Browser Extension
Write-Host "[1/5] Building Browser Extension..." -ForegroundColor Yellow
Push-Location $ExtensionDir
if (!(Test-Path "node_modules")) {
    Write-Host "Installing extension dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed!" -ForegroundColor Red
        exit 1
    }
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Extension build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "OK: Extension compiled successfully" -ForegroundColor Green

# Step 2: Build the Rust agent
Write-Host ""
Write-Host "[2/5] Building RAV Monitoring Agent (release)..." -ForegroundColor Yellow
Push-Location $AgentDir
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cargo build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "OK: Agent compiled successfully" -ForegroundColor Green

$AgentExePath = Join-Path $AgentDir "target\release"
$AgentExe = Join-Path $AgentExePath "RavMonitor.exe"

# Step 3: Sign the agent exe BEFORE packaging, so the copy embedded in the MSI cab is trusted.
Write-Host ""
Write-Host "[3/5] Signing agent executable..." -ForegroundColor Yellow
Invoke-Sign -Path $AgentExe

# Step 4: Build MSI
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
Write-Host ""
Write-Host "[4/5] Building universal MSI installer..." -ForegroundColor Yellow
$MsiPath = Join-Path $OutputDir "RAVAgent.msi"
Push-Location $WixDir
wix build Product.wxs -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -d AgentPath="$AgentExePath" -o "$MsiPath"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: WiX build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location

# Step 5: Sign the MSI itself (this is the artifact the auto-update signature check validates).
Write-Host ""
Write-Host "[5/5] Signing MSI..." -ForegroundColor Yellow
Invoke-Sign -Path $MsiPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SUCCESS: Universal MSI built!        " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $MsiPath" -ForegroundColor White
if (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
    Write-Host "Signed with thumbprint: $CertThumbprint" -ForegroundColor White
    Write-Host "Pin this thumbprint for auto-update enforcement: backend.update_signer_thumbprint (or DEFAULT_SIGNER_THUMBPRINT)." -ForegroundColor White
}
Write-Host ""
Write-Host "DEPLOYMENT COMMAND:" -ForegroundColor Yellow
Write-Host 'msiexec /i RAVAgent.msi BACKEND_URL="http://YOUR-SERVER" ENROLLMENT_TOKEN="YOUR-TOKEN" /qn' -ForegroundColor Cyan
Write-Host ""
