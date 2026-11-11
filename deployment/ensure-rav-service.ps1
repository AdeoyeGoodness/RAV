# ============================================================
# ensure-rav-service.ps1  -  central, IT-managed service keeper
#
# Deployed fleet-wide via Group Policy (or Intune) as a Scheduled
# Task that runs every few minutes as SYSTEM. If the RAV Monitoring
# Agent service exists and is Stopped, it starts it and logs the
# action to the Windows event log. See GPO-SERVICE-RECOVERY.md.
#
# This is service-reliability only. It does NOT touch Defender,
# Tamper Protection, Smart App Control, or any AV setting, it does
# NOT re-create a removed binary, and it takes no action if the
# service is absent (a removed agent is recovered by redeploying the
# signed MSI through the same management channel, not by this script).
#
# Keep this file ASCII-only (Windows PowerShell 5.1 reads a no-BOM
# script as ANSI). Plain hyphens and straight quotes only.
# ============================================================

# Internal SCM key, stable across the product rename. DisplayName is
# "RAV Monitoring Agent".
$svc = "AssetTelemetryService"
$source = "RAV Monitoring Agent"

function Write-RavLog {
    param([string]$Message, [string]$EntryType = "Information")
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists($source)) {
            New-EventLog -LogName Application -Source $source -ErrorAction SilentlyContinue
        }
        Write-EventLog -LogName Application -Source $source -EntryType $EntryType -EventId 1000 -Message $Message -ErrorAction SilentlyContinue
    } catch { }
}

$s = Get-Service $svc -ErrorAction SilentlyContinue
if (-not $s) {
    # Agent not installed on this box. Do nothing: central redeploy (Intune/GPO
    # required app) handles reinstating a removed agent.
    exit 0
}

if ($s.Status -eq 'Stopped') {
    try {
        Start-Service $svc -ErrorAction Stop
        Start-Sleep -Seconds 5
        $s2 = Get-Service $svc
        if ($s2.Status -eq 'Running') {
            Write-RavLog "ensure-rav-service: service was Stopped; started successfully."
        } else {
            Write-RavLog "ensure-rav-service: start issued but state is $($s2.Status)." "Warning"
        }
    } catch {
        Write-RavLog "ensure-rav-service: failed to start service: $($_.Exception.Message)" "Error"
    }
}

exit 0
