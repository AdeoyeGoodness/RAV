# RAV Agent Universal MSI Build Script
# Builds ONE universal MSI - never rebuilt per customer
# Enrollment happens at INSTALL-TIME via msiexec properties

$ErrorActionPreference = "Stop"

# Paths
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $ProjectRoot "agent"
$WixDir = $PSScriptRoot
$OutputDir = Join-Path $WixDir "output"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RAV Agent - Universal MSI Builder    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the Rust agent
Write-Host "[1/3] Building RAV Agent (release)..." -ForegroundColor Yellow
Push-Location $AgentDir
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cargo build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "OK: Agent compiled successfully" -ForegroundColor Green

# Step 2: Create output directory
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Step 3: Build MSI
Write-Host ""
Write-Host "[2/3] Building universal MSI installer..." -ForegroundColor Yellow
$AgentExePath = Join-Path $AgentDir "target\release"

Push-Location $WixDir
wix build Product.wxs -ext WixToolset.UI.wixext -d AgentPath="$AgentExePath" -o "$OutputDir\RAVAgent.msi"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: WiX build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SUCCESS: Universal MSI built!        " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $OutputDir\RAVAgent.msi" -ForegroundColor White
Write-Host ""
Write-Host "DEPLOYMENT COMMAND:" -ForegroundColor Yellow
Write-Host 'msiexec /i RAVAgent.msi BACKEND_URL="https://rav.handy.boats" ENROLLMENT_TOKEN="YOUR-TOKEN" /qn' -ForegroundColor Cyan
Write-Host ""
