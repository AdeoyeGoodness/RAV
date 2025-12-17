# Enterprise Deployment - TO-DO List

This document outlines all enterprise-grade features required for production deployment of the RAV Agent, including dual-mode operation, stealth capabilities, offline resilience, and service management.

---

## 1. Dual-Mode Operation (Development & Production)

### 1.1 Mode Detection & Configuration
- [ ] Implement command-line argument parsing
  - [ ] `--install` - Install as Windows Service
  - [ ] `--uninstall` - Remove Windows Service
  - [ ] `--service` - Run as service (called by Service Manager)
  - [ ] `--console` - Run in console mode (development)
  - [ ] Default: Auto-detect mode (console if run manually, service if called by Service Manager)
- [ ] Implement service detection function
  - [ ] Check if parent process is `services.exe`
  - [ ] Check for service-specific environment variables
  - [ ] Detect if running under Service Control Manager
- [ ] Add mode configuration to config file
  - [ ] `run_mode: "auto" | "console" | "service"`

### 1.2 Console Mode (Development)
- [ ] Console window visible
- [ ] Logging to stdout/stderr
- [ ] Ctrl+C signal handling
- [ ] Real-time log output for debugging
- [ ] Easy process termination

### 1.3 Service Mode (Production)
- [ ] No console window
- [ ] File-based logging (see section 2.2)
- [ ] Service control signal handling (stop, pause, continue)
- [ ] Background operation
- [ ] Auto-start on system boot

---

## 2. Windows Service Implementation

### 2.1 Service Installation
- [ ] Implement `install_service()` function
  - [ ] Create service entry in Windows Service Manager
  - [ ] Set service name: "RAV Agent" (or configurable generic name)
  - [ ] Set display name: "RAV Digital Forensics Agent"
  - [ ] Set description: "Enterprise endpoint monitoring and forensics agent"
  - [ ] Set startup type: Automatic (auto-start on boot)
  - [ ] Set service account: SYSTEM (or LocalSystem)
  - [ ] Configure service recovery:
    - [ ] First failure: Restart service
    - [ ] Second failure: Restart service
    - [ ] Subsequent failures: Restart service
    - [ ] Reset failure count after: 1 day
    - [ ] Restart service after: 1 minute
- [ ] Create service installation script/command
  - [ ] `rav-agent.exe --install`
  - [ ] Require administrator privileges
  - [ ] Verify installation success

### 2.2 Service Uninstallation
- [ ] Implement `uninstall_service()` function
  - [ ] Stop service if running
  - [ ] Remove service entry from Windows Service Manager
  - [ ] Clean up service registry entries
- [ ] Create service uninstallation command
  - [ ] `rav-agent.exe --uninstall`
  - [ ] Require administrator privileges

### 2.3 Service Execution
- [ ] Implement `run_as_service()` function
  - [ ] Register service control handler
  - [ ] Handle service control commands:
    - [ ] SERVICE_CONTROL_STOP - Graceful shutdown
    - [ ] SERVICE_CONTROL_PAUSE - Pause monitoring (optional)
    - [ ] SERVICE_CONTROL_CONTINUE - Resume monitoring (optional)
    - [ ] SERVICE_CONTROL_INTERROGATE - Report status
  - [ ] Report service status to Service Control Manager
  - [ ] Implement graceful shutdown on stop command

### 2.4 Service Management Commands
- [ ] Document service management commands:
  - [ ] `net start "RAV Agent"` - Start service
  - [ ] `net stop "RAV Agent"` - Stop service
  - [ ] `sc query "RAV Agent"` - Query service status
  - [ ] `sc config "RAV Agent" start=auto` - Set auto-start
  - [ ] `sc failure "RAV Agent" reset=86400 actions=restart/60000` - Configure recovery

---

## 3. File-Based Logging System

### 3.1 Log Configuration
- [ ] Implement log file configuration
  - [ ] Log directory: `{data_dir}/logs/` (e.g., `C:\ProgramData\RAV\logs\`)
  - [ ] Log file name: `rav-agent.log` (or configurable)
  - [ ] Log format: JSON (structured) or plain text
  - [ ] Log level: Configurable (trace, debug, info, warn, error)
- [ ] Add logging config to `Config` struct
  - [ ] `log_file_path: PathBuf`
  - [ ] `log_level: String`
  - [ ] `log_format: "json" | "text"`
  - [ ] `log_rotation: LogRotationConfig`

### 3.2 Log Rotation
- [ ] Implement log rotation
  - [ ] Daily rotation: New log file each day
  - [ ] Size-based rotation: Rotate when file exceeds size limit (e.g., 10MB)
  - [ ] Retention policy: Keep logs for N days (e.g., 30 days)
  - [ ] Compress old logs (optional)
  - [ ] Log file naming: `rav-agent.YYYY-MM-DD.log` or `rav-agent.YYYY-MM-DD.N.log`
- [ ] Implement log cleanup
  - [ ] Remove logs older than retention period
  - [ ] Run cleanup on startup and periodically

### 3.3 Logging Implementation
- [ ] Replace console logging with file logging in service mode
  - [ ] Use `tracing-subscriber` with file writer
  - [ ] Use `tracing-appender` for log rotation
  - [ ] Configure log format (JSON for structured, text for readability)
- [ ] Keep console logging for console mode
- [ ] Add log level filtering
- [ ] Add timestamp formatting
- [ ] Add thread/process ID to logs (for debugging)

### 3.4 Log File Permissions
- [ ] Set appropriate file permissions
  - [ ] Log files: Readable by SYSTEM, Administrators
  - [ ] Prevent regular users from reading logs (security)
  - [ ] Use Windows ACLs to restrict access

---

## 4. Persistent Event Queue (Offline Resilience)

### 4.1 SQLite Event Storage
- [ ] Add SQLite dependency to `Cargo.toml`
  - [ ] `rusqlite = { version = "0.30", features = ["bundled"] }`
- [ ] Create event queue database schema
  - [ ] Table: `pending_events`
    - [ ] `id` - INTEGER PRIMARY KEY AUTOINCREMENT
    - [ ] `event_type` - TEXT NOT NULL
    - [ ] `timestamp` - TEXT NOT NULL (ISO 8601)
    - [ ] `agent_id` - TEXT NOT NULL
    - [ ] `metadata` - TEXT NOT NULL (JSON)
    - [ ] `created_at` - TEXT NOT NULL
    - [ ] `sync_attempts` - INTEGER DEFAULT 0
    - [ ] `last_sync_attempt` - TEXT
    - [ ] `synced` - INTEGER DEFAULT 0 (0 = pending, 1 = synced)
- [ ] Create database initialization function
  - [ ] Database path: `{data_dir}/events.db`
  - [ ] Create tables if not exist
  - [ ] Create indexes for performance

### 4.2 Event Queue Manager
- [ ] Create `EventQueueManager` struct
  - [ ] SQLite connection management
  - [ ] Event insertion (queue_event)
  - [ ] Event retrieval (get_pending_events)
  - [ ] Event marking as synced (mark_synced)
  - [ ] Event cleanup (remove old synced events)
- [ ] Integrate with existing `SyncManager`
  - [ ] Queue events to both memory and SQLite
  - [ ] Load pending events from SQLite on startup
  - [ ] Only remove events from SQLite after successful sync

### 4.3 Retry Logic with Exponential Backoff
- [ ] Implement retry mechanism
  - [ ] Initial retry delay: 30 seconds
  - [ ] Exponential backoff: 2x delay on each retry
  - [ ] Maximum retry delay: 5 minutes
  - [ ] Maximum retry attempts: Unlimited (or configurable)
- [ ] Track sync attempts per event
- [ ] Implement retry scheduling
  - [ ] Retry failed events on next sync cycle
  - [ ] Respect backoff delays
  - [ ] Prioritize older events

### 4.4 Connection Status Detection
- [ ] Implement connectivity detection
  - [ ] Check if backend is reachable (HTTP health check)
  - [ ] Track connection status (online/offline)
  - [ ] Detect connection restoration
- [ ] Add connection status to logs
- [ ] Implement connection retry with backoff
- [ ] Alert on extended offline periods (optional)

### 4.5 Event Cleanup
- [ ] Implement cleanup of synced events
  - [ ] Remove events older than N days after successful sync
  - [ ] Configurable retention period (e.g., 7 days)
- [ ] Implement database maintenance
  - [ ] VACUUM database periodically
  - [ ] Optimize indexes
  - [ ] Monitor database size

---

## 5. Enterprise Stealth Features

### 5.1 Process Name Obfuscation
- [ ] Implement configurable process naming
  - [ ] Default: `rav-agent.exe`
  - [ ] Enterprise: Generic system name (e.g., `SystemSecurity.exe`, `WindowsUpdateService.exe`)
  - [ ] Add to config: `stealth.process_name: Option<String>`
- [ ] Validate process name doesn't conflict with system processes
- [ ] Document naming recommendations

### 5.2 Service Name Obfuscation
- [ ] Implement configurable service naming
  - [ ] Service name: "RAV Agent" (internal, not visible)
  - [ ] Display name: "Windows Security Service" (visible in Services)
  - [ ] Description: "Provides system security and monitoring services"
  - [ ] Add to config: `stealth.service_display_name: Option<String>`
- [ ] Use generic, legitimate-sounding names
- [ ] Avoid obvious names like "Monitoring Agent" or "Forensics Tool"

### 5.3 File Location Stealth
- [ ] Implement configurable installation paths
  - [ ] Default: `C:\ProgramData\RAV\`
  - [ ] Enterprise: `C:\Program Files\Common Files\Microsoft Shared\SystemSecurity\`
  - [ ] Or: `C:\Windows\System32\Security\` (requires admin)
- [ ] Set hidden/system file attributes
  - [ ] Use `SetFileAttributes` Windows API
  - [ ] Mark files as hidden and system files
- [ ] Encrypt/obfuscate config files
  - [ ] Encrypt sensitive config values
  - [ ] Use Windows DPAPI for encryption

### 5.4 Registry Stealth
- [ ] Minimize registry footprint
  - [ ] Store only essential service entries
  - [ ] Use generic registry key names
  - [ ] Encrypt registry values if sensitive
- [ ] Use standard Windows service registry locations
  - [ ] `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\`
- [ ] Avoid custom registry keys in obvious locations

### 5.5 Network Traffic Obfuscation
- [ ] Ensure all traffic is encrypted (HTTPS/TLS)
- [ ] Use standard ports (443 for HTTPS)
- [ ] Use legitimate TLS certificates
- [ ] Randomize sync intervals slightly (30-60 seconds with jitter)
- [ ] Use standard HTTP headers
- [ ] Avoid suspicious user agent strings
- [ ] Blend with normal network traffic patterns

### 5.6 Process Protection
- [ ] Run as SYSTEM account (highest privilege)
- [ ] Set process priority to normal (not high priority)
- [ ] Use Windows process protection APIs (if available)
- [ ] Implement anti-debugging techniques (optional, advanced)
  - [ ] Check for debugger attachment
  - [ ] Detect common debugging tools
  - [ ] Exit or alert if debugging detected

### 5.7 Tamper Detection
- [ ] Implement tamper detection
  - [ ] Monitor service stop attempts
  - [ ] Detect process termination
  - [ ] Detect file modification
  - [ ] Detect config file changes
- [ ] Auto-recovery on tampering
  - [ ] Auto-restart service if stopped
  - [ ] Alert backend on tampering attempts
  - [ ] Log all tampering events
- [ ] Implement tamper alerts
  - [ ] Send alert to backend immediately
  - [ ] Include tampering details in alert
  - [ ] Log tampering attempts locally

### 5.8 Stealth Configuration
- [ ] Add `StealthConfig` to `Config` struct
  - [ ] `enabled: bool` - Enable/disable stealth features
  - [ ] `process_name: Option<String>` - Custom process name
  - [ ] `service_display_name: Option<String>` - Custom service name
  - [ ] `installation_path: Option<PathBuf>` - Custom installation path
  - [ ] `hide_files: bool` - Set hidden/system attributes
  - [ ] `encrypt_config: bool` - Encrypt config files
  - [ ] `tamper_detection: bool` - Enable tamper detection
- [ ] Document stealth configuration options
- [ ] Provide stealth configuration template

---

## 6. Graceful Shutdown & State Persistence

### 6.1 Graceful Shutdown
- [ ] Implement graceful shutdown handler
  - [ ] Save queued events to SQLite before exit
  - [ ] Complete current sync operations
  - [ ] Save monitoring state (USB device snapshots, etc.)
  - [ ] Close database connections properly
  - [ ] Flush log buffers
- [ ] Handle shutdown signals
  - [ ] SIGTERM (Unix) / SERVICE_CONTROL_STOP (Windows)
  - [ ] SIGINT (Ctrl+C in console mode)
  - [ ] System shutdown notifications

### 6.2 State Persistence
- [ ] Save monitoring state on shutdown
  - [ ] USB device state (known devices, snapshots)
  - [ ] Network monitoring state
  - [ ] File transfer tracking state
- [ ] Load state on startup
  - [ ] Restore USB device state
  - [ ] Restore monitoring snapshots
  - [ ] Continue from where agent left off
- [ ] Periodic state saves
  - [ ] Save state every N minutes (e.g., 5 minutes)
  - [ ] Save state on significant events
  - [ ] Prevent data loss on unexpected crashes

### 6.3 State File Management
- [ ] State file location: `{data_dir}/state/`
- [ ] State file format: JSON or binary (encrypted)
- [ ] State file cleanup
  - [ ] Remove stale state files
  - [ ] Validate state file integrity
  - [ ] Handle corrupted state files gracefully

---

## 7. Local Data Export & Retrieval

### 7.1 Command-Line Export Tool
- [ ] Implement export command
  - [ ] `rav-agent.exe --export <output_file>`
  - [ ] Export all pending events to JSON/CSV
  - [ ] Export event history from SQLite
  - [ ] Include metadata and timestamps
- [ ] Implement filtered export
  - [ ] `--export --since <date>` - Export events since date
  - [ ] `--export --type <event_type>` - Export specific event types
  - [ ] `--export --agent <agent_id>` - Export specific agent events

### 7.2 Data Retrieval API (Local)
- [ ] Implement local HTTP server (optional)
  - [ ] Listen on localhost only (127.0.0.1)
  - [ ] Provide REST API for data retrieval
  - [ ] Require authentication (API key or local auth)
  - [ ] Endpoints:
    - [ ] `GET /local/events` - Get pending events
    - [ ] `GET /local/status` - Get agent status
    - [ ] `GET /local/stats` - Get statistics
- [ ] Document local API usage
- [ ] Add security considerations (localhost only)

### 7.3 Encrypted Local Storage
- [ ] Implement encrypted local storage option
  - [ ] Encrypt SQLite database
  - [ ] Use Windows DPAPI for key management
  - [ ] Encrypt exported files
- [ ] Add encryption configuration
  - [ ] `local_storage.encrypted: bool`
  - [ ] `local_storage.encryption_key_path: PathBuf`

---

## 8. Service Recovery & Resilience

### 8.1 Service Recovery Configuration
- [ ] Configure Windows Service recovery
  - [ ] First failure: Restart service (after 1 minute)
  - [ ] Second failure: Restart service (after 1 minute)
  - [ ] Subsequent failures: Restart service (after 1 minute)
  - [ ] Reset failure count: After 1 day
- [ ] Implement service health checks
  - [ ] Periodic health check (every 5 minutes)
  - [ ] Detect if service is hung
  - [ ] Auto-restart if unresponsive

### 8.2 Process Monitoring
- [ ] Implement watchdog mechanism (optional)
  - [ ] Separate watchdog process
  - [ ] Monitor main agent process
  - [ ] Restart agent if crashed
- [ ] Implement self-healing
  - [ ] Detect and recover from common errors
  - [ ] Auto-restart failed monitoring modules
  - [ ] Log recovery actions

### 8.3 Error Recovery
- [ ] Implement error recovery strategies
  - [ ] Database connection errors: Retry with backoff
  - [ ] Network errors: Queue events, retry later
  - [ ] File system errors: Log and continue
  - [ ] Permission errors: Alert and continue
- [ ] Implement circuit breaker pattern
  - [ ] Stop retrying if backend is consistently unavailable
  - [ ] Resume when backend becomes available
  - [ ] Configurable failure threshold

---

## 9. Installation & Deployment

### 9.1 Installation Scripts
- [ ] Create Windows installation script
  - [ ] `install.ps1` - PowerShell installation script
  - [ ] Check administrator privileges
  - [ ] Copy files to installation directory
  - [ ] Install Windows Service
  - [ ] Configure service recovery
  - [ ] Set file permissions
  - [ ] Create data directories
  - [ ] Initialize database
- [ ] Create uninstallation script
  - [ ] `uninstall.ps1` - PowerShell uninstallation script
  - [ ] Stop service
  - [ ] Uninstall service
  - [ ] Remove files (optional, with confirmation)
  - [ ] Clean up registry entries

### 9.2 MSI Installer (Optional)
- [ ] Create MSI installer using WiX or cargo-wix
  - [ ] Include agent executable
  - [ ] Include configuration files
  - [ ] Install Windows Service
  - [ ] Create Start Menu shortcuts (optional)
  - [ ] Add uninstaller
- [ ] Configure installer properties
  - [ ] Product name, version, manufacturer
  - [ ] Installation directory
  - [ ] Service configuration

### 9.3 Deployment Documentation
- [ ] Create deployment guide
  - [ ] Prerequisites
  - [ ] Installation steps
  - [ ] Configuration options
  - [ ] Service management
  - [ ] Troubleshooting
- [ ] Create administrator guide
  - [ ] Service management commands
  - [ ] Log file locations
  - [ ] Configuration file locations
  - [ ] Data export procedures

---

## 10. Security & Compliance

### 10.1 Access Control
- [ ] Implement file system permissions
  - [ ] Executable: Read/Execute for SYSTEM, Administrators
  - [ ] Config files: Read for SYSTEM only
  - [ ] Log files: Read for SYSTEM, Administrators
  - [ ] Data files: Read/Write for SYSTEM only
- [ ] Use Windows ACLs for fine-grained control
- [ ] Document permission requirements

### 10.2 Encryption
- [ ] Encrypt sensitive configuration
  - [ ] API keys
  - [ ] Backend URLs (optional)
  - [ ] Agent credentials
- [ ] Use Windows DPAPI for encryption
- [ ] Implement key management
  - [ ] Key generation
  - [ ] Key storage
  - [ ] Key rotation (optional)

### 10.3 Audit Logging
- [ ] Implement audit logging
  - [ ] Log all service start/stop events
  - [ ] Log configuration changes
  - [ ] Log tampering attempts
  - [ ] Log access attempts
- [ ] Store audit logs separately
- [ ] Implement audit log retention

### 10.4 Compliance Considerations
- [ ] Document legal/ethical requirements
  - [ ] Employee notification requirements
  - [ ] Privacy law compliance (GDPR, etc.)
  - [ ] Company policy requirements
- [ ] Create compliance checklist
- [ ] Document data retention policies

---

## 11. Testing & Validation

### 11.1 Service Mode Testing
- [ ] Test service installation
- [ ] Test service startup
- [ ] Test service stop/start
- [ ] Test service recovery on failure
- [ ] Test auto-start on boot
- [ ] Test graceful shutdown

### 11.2 Offline Mode Testing
- [ ] Test event queuing when offline
- [ ] Test event persistence across restarts
- [ ] Test event sync when connection restored
- [ ] Test retry logic with backoff
- [ ] Test database cleanup

### 11.3 Stealth Testing
- [ ] Verify process name obfuscation
- [ ] Verify service name obfuscation
- [ ] Verify file hiding
- [ ] Test tamper detection
- [ ] Test auto-recovery

### 11.4 Performance Testing
- [ ] Test with large event queues (10,000+ events)
- [ ] Test database performance
- [ ] Test log rotation performance
- [ ] Test memory usage
- [ ] Test CPU usage

---

## 12. Documentation

### 12.1 Enterprise Deployment Guide
- [ ] Create comprehensive deployment guide
  - [ ] Installation procedures
  - [ ] Configuration options
  - [ ] Service management
  - [ ] Troubleshooting
- [ ] Include examples and screenshots

### 12.2 Administrator Manual
- [ ] Service management commands
- [ ] Configuration file reference
- [ ] Log file locations and formats
- [ ] Data export procedures
- [ ] Maintenance procedures

### 12.3 Security Documentation
- [ ] Security considerations
- [ ] Access control requirements
- [ ] Encryption configuration
- [ ] Compliance requirements
- [ ] Best practices

---

## Implementation Priority

### Phase 1: Critical (Must Have)
1. ✅ Dual-mode operation (console/service)
2. ✅ Windows Service implementation
3. ✅ File-based logging
4. ✅ Persistent event queue (SQLite)
5. ✅ Retry logic with backoff

### Phase 2: Important (Should Have)
6. ✅ Graceful shutdown
7. ✅ State persistence
8. ✅ Service recovery configuration
9. ✅ Basic stealth (process/service naming)
10. ✅ Local data export

### Phase 3: Enhanced (Nice to Have)
11. ✅ Advanced stealth features
12. ✅ Tamper detection
13. ✅ Process protection
14. ✅ Encrypted local storage
15. ✅ MSI installer

---

## Notes

- **Legal Compliance**: Ensure all monitoring complies with local laws and company policies. Employee notification may be required.
- **Security**: Stealth features should be used responsibly and ethically. The agent should be detectable by authorized IT/security personnel.
- **Testing**: Thoroughly test all features in both console and service modes before enterprise deployment.
- **Documentation**: Maintain comprehensive documentation for administrators and security teams.

---

## Related Files

- `plan.md` - Main implementation plan
- `SETUP_GUIDE.md` - Development setup guide
- `WINDOWS_BUILD_SETUP.md` - Windows build requirements
- `TESTING_USB_MONITORING.md` - USB monitoring testing guide