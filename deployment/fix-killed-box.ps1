#Requires -RunAsAdministrator
# ============================================================
# RAV Monitoring Agent - manual service recovery.
#
# Run in an ELEVATED PowerShell on a box whose agent service shows
# "Stopped" (the exe is still present). It simply (re)starts the
# service and confirms it stays up. Once running, the agent heartbeats
# and auto-updates itself - no MSI needed here.
#
# This script does NOT touch Microsoft Defender, Tamper Protection,
# Smart App Control, or any other security setting. The agent is
# code-signed and installs cleanly; we never disable protections. If
# the exe itself has been removed, the fix is a central redeploy via
# Intune/GPO (see deployment/GPO-SERVICE-RECOVERY.md), not re-enabling
# it by fighting the box's own security.
#
# Usage: right-click PowerShell > Run as administrator, then:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; .\fix-killed-box.ps1
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads a
# no-BOM script as ANSI, so any em-dash or smart-quote corrupts the
# parse. Plain hyphens and straight quotes only.
# ============================================================

# Internal SCM key (kept stable across the product rename); the service
# DisplayName shown in services.msc is "RAV Monitoring Agent".
$svc = "AssetTelemetryService"

Write-Host "`nRAV Monitoring Agent recovery on $env:COMPUTERNAME" -ForegroundColor Cyan

$existing = Get-Service $svc -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "  [INFO] No agent service on this computer - nothing to restart." -ForegroundColor Cyan
    Write-Host "         If this endpoint should be monitored, (re)deploy the agent" -ForegroundColor Gray
    Write-Host "         centrally via Intune/GPO. See deployment/GPO-SERVICE-RECOVERY.md." -ForegroundColor Gray
    return
}

try {
    Start-Service $svc -ErrorAction Stop
    Start-Sleep -Seconds 8
    $s = Get-Service $svc -ErrorAction Stop
    if ($s.Status -eq 'Running') {
        Write-Host "  [OK]  Service started." -ForegroundColor Green
        Start-Sleep -Seconds 20
        $s2 = Get-Service $svc
        if ($s2.Status -eq 'Running') {
            Write-Host "  [OK]  Service still running after 20s - it stuck." -ForegroundColor Green
            Write-Host "`nDone. It will auto-update on its next heartbeat." -ForegroundColor Cyan
        } else {
            Write-Host "  [WARN] Service stopped again ($($s2.Status))." -ForegroundColor Yellow
            Write-Host "         Check the agent log at C:\ProgramData\RAV\logs\agent.log for the" -ForegroundColor Yellow
            Write-Host "         reason. Do NOT disable Defender/Tamper Protection; if the agent" -ForegroundColor Yellow
            Write-Host "         is being blocked, confirm it is properly code-signed and, on a" -ForegroundColor Yellow
            Write-Host "         Smart App Control box, deploy it via Intune/GPO instead." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [WARN] Service state: $($s.Status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [FAIL] Could not start service: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "         If the exe is missing, redeploy the agent centrally (Intune/GPO)." -ForegroundColor Yellow
}
