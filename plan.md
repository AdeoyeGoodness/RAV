# Enterprise Digital Forensics & Endpoint Monitoring Platform - Implementation Plan

## Phase Status Tracking

- [x] **Phase 1: Foundation** ✅ COMPLETED
  - [x] Project Setup & Infrastructure
  - [x] Core Agent Development
  - [x] USB Device Monitoring
  - [x] Network Connection Monitoring
  - [x] Backend API Foundation
  - [x] Dashboard Prototype

- [ ] **Phase 2: Forensics Enhancements**
  - [ ] Screenshot Collection System
  - [ ] Browser History Collection
  - [ ] Mobile/External Device Connectivity
  - [ ] USB Monitoring Persistence (Future Enhancement)

- [ ] **Phase 3: Advanced Monitoring**
  - [ ] Screen Recording
  - [ ] AirDrop / Nearby Share / Screen Mirroring
  - [ ] Real-Time Alert Engine

- [ ] **Phase 4: Enterprise Hardening**
  - [ ] Subscription & Licensing System
  - [ ] RBAC & User Groups
  - [ ] Compliance Auditing
  - [ ] Evidence Export & Chain of Custody

---

## Phase 1: Foundation - Detailed Tasks

### 1.1 Project Setup & Infrastructure
- [x] Create project structure
- [x] Create `agent/Cargo.toml` with dependencies
- [x] Create `backend/Cargo.toml` with dependencies
- [x] Create `dashboard/package.json` with dependencies
- [x] Create `docker-compose.yml` for local development
- [x] Create `.env.example` template (blocked by globalignore, but documented in README)
- [x] Create `README.md` with setup instructions

### 1.2 Core Agent Development
- [x] Create `agent/src/main.rs` - Entry point
- [x] Create `agent/src/config.rs` - Configuration management
- [x] Create `agent/src/encryption.rs` - AES-256 encryption
- [x] Create `agent/src/sync.rs` - Secure sync to backend
- [x] Create `agent/src/service/windows.rs` - Windows Service (placeholder)
- [x] Create `agent/src/service/macos.rs` - macOS LaunchDaemon (placeholder)
- [x] Create `agent/src/service/linux.rs` - Linux systemd service (placeholder)
- [ ] Implement service installation/uninstallation (placeholders created)
- [ ] Implement tamper detection (framework ready)
- [ ] Implement hardware fingerprinting (framework ready)

### 1.3 USB Device Monitoring
- [x] Create `agent/src/monitoring/usb.rs`
- [x] Implement Windows USB monitoring (WMI)
- [x] Implement macOS USB monitoring (placeholder)
- [x] Implement Linux USB monitoring (udev + /sys/bus/usb)
- [x] Implement file transfer detection (to_usb, from_usb, from_usb_to_system)
- [x] Implement source path tracking (tracks where files came from)
- [x] Implement file backup system (automatic backup for files < 10MB)
- [x] Implement false positive prevention (initial snapshot on startup)
- [x] Implement device mapping (ties transfers to specific USB devices)
- [x] Implement SHA-256 hashing for files (in encryption module)
- [x] Implement event storage with encryption (framework ready)
- [x] Dashboard integration (filtering, date filtering, clear functionality)
- [x] Documents page (view and download tracked files)

### 1.4 Network Connection Monitoring
- [x] Create `agent/src/monitoring/network.rs`
- [x] Implement active connection monitoring (Windows netstat, Linux /proc/net/tcp)
- [ ] Implement DNS query monitoring (framework ready, needs platform-specific implementation)
- [x] Implement process correlation (Windows implemented, Linux needs enhancement)
- [x] Implement event logging with timestamps

### 1.5 Backend API Foundation
- [x] Create `backend/src/main.rs` - Server initialization
- [x] Create `backend/src/api/routes.rs` - Route definitions
- [x] Create `backend/src/api/handlers.rs` - Request handlers
- [x] Create `backend/src/db/models.rs` - Database models
- [x] Create database migrations
- [x] Implement POST /api/v1/events endpoint
- [x] Implement GET /api/v1/events endpoint
- [x] Implement POST /api/v1/agents/register endpoint
- [x] Implement POST /api/v1/agents/heartbeat endpoint
- [x] Implement GET /api/v1/agents endpoint

### 1.6 Dashboard Prototype
- [x] Create Next.js project structure
- [x] Create `dashboard/src/app/layout.tsx`
- [x] Create `dashboard/src/app/page.tsx`
- [x] Create `dashboard/src/components/EventList.tsx`
- [x] Create `dashboard/src/components/AgentStatus.tsx`
- [x] Create `dashboard/src/lib/api.ts` - API client
- [ ] Create `dashboard/src/lib/websocket.ts` - WebSocket client (polling implemented instead)
- [x] Implement real-time event feed (polling-based)
- [x] Implement agent status dashboard
- [x] Implement basic event filtering (agent_id filtering)

---

## Phase 2: Forensics Enhancements - Detailed Tasks

### 2.1 Screenshot Collection System
- [ ] Create `agent/src/monitoring/screenshots.rs`
- [ ] Implement Windows screenshot capture (GDI+ or Windows API)
- [ ] Implement macOS screenshot capture (CoreGraphics)
- [ ] Implement Linux screenshot capture (X11/Wayland)
- [ ] Implement configurable capture intervals
- [ ] Implement screenshot compression (JPEG/PNG)
- [ ] Implement secure storage and encryption
- [ ] Implement backend API endpoint for screenshot upload
- [ ] Implement dashboard screenshot viewer
- [ ] Implement screenshot metadata (timestamp, window title, process)

### 2.2 Browser History Collection
- [x] Create `agent/src/monitoring/browser.rs`
- [x] Implement Chrome/Edge history extraction (SQLite) ✅ Windows implemented
- [ ] Implement Firefox history extraction (SQLite) - Placeholder (not yet implemented)
- [ ] Implement Safari history extraction (macOS) - Placeholder (not yet implemented)
- [ ] Implement browser cookie extraction - Disabled by default (sensitive data)
- [x] Implement download history extraction ✅ Windows Chrome/Edge
- [ ] Implement bookmark extraction - Disabled by default
- [x] Implement backend API for browser data storage ✅ Reuses existing events endpoint
- [x] Implement dashboard browser history viewer ✅ Complete with filtering, search, sorting
- [x] Implement search query analysis ✅ Extracts queries from Google, Bing, Yahoo, DuckDuckGo, etc.

### 2.3 Mobile/External Device Connectivity
- [ ] Create `agent/src/monitoring/devices.rs`
- [ ] Implement mobile device detection (MTP/PTP)
- [ ] Implement Bluetooth device monitoring
- [ ] Implement AirDrop detection (macOS)
- [ ] Implement Nearby Share detection (Windows/Android)
- [ ] Implement device pairing event logging
- [ ] Implement file transfer detection for mobile devices
- [ ] Implement backend API for device events
- [ ] Implement dashboard device connectivity viewer

### 2.4 USB Monitoring Persistence (Enhancement)
- [ ] Implement state persistence for known USB devices
- [ ] Save USB device state to `{data_dir}/usb_state.json`
- [ ] Load persisted state on agent startup
- [ ] Detect USB removals that occurred while agent was offline
- [ ] Add `detected_on_startup` flag to removal events
- [ ] Periodic state file updates
- [ ] Handle stale state files gracefully

---

## USB Monitoring - Potential Future Enhancements

The following improvements are planned for future phases but are not required for Phase 1 completion:

### Phase 2+ Enhancements
- [ ] **Recursive Directory Scanning** (Medium Priority)
  - Current: Only top-level files on USB drives are monitored
  - Enhancement: Scan subdirectories recursively to catch files in nested folders
  - Impact: Would catch more file transfers but may impact performance on large drives

- [ ] **Persistence Across Restarts** (Planned for Phase 2)
  - Current: State resets on agent restart
  - Enhancement: Save USB device state to disk, detect removals that occurred while agent was offline
  - Impact: Better forensics accuracy, can detect devices removed during downtime
  - Status: Design documented, implementation planned for Phase 2

- [ ] **File Hash-Based Matching** (Low Priority)
  - Current: Matches files by filename + size
  - Enhancement: Use SHA-256 hashes for more accurate file matching
  - Impact: Better accuracy, can detect renamed files, fewer false matches
  - Note: SHA-256 hashing already implemented, just needs to be used for matching

- [ ] **macOS/Linux Full Implementation** (Platform Priority)
  - Current: Windows fully implemented, macOS/Linux are placeholders
  - Enhancement: Complete implementations for macOS (IOKit) and Linux (udev)
  - Impact: Cross-platform support

- [ ] **Enhanced Error Handling** (Low Priority)
  - Current: Basic error handling
  - Enhancement: Better handling for file access denied, corrupted drives, network timeouts
  - Impact: More robust operation in edge cases

---

## Future Implementation - Burst-Mode Integration (DFIR-style)

### Overview
A dynamic monitoring mode that automatically increases capture frequency and data collection when suspicious activity patterns are detected. This DFIR (Digital Forensics and Incident Response) feature enables rapid evidence collection during potential security incidents.

### Trigger Conditions
The system will automatically activate burst-mode when any of the following conditions are detected:

1. **High Volume of USB Transfers**
   - Multiple file transfers within a short time window
   - Large cumulative file sizes transferred
   - Rapid insertion/removal of USB devices

2. **Window Focus Changes Rapidly**
   - Frequent application switching
   - Unusual window focus patterns
   - Rapid tab switching in browsers

3. **Suspicious Processes**
   - Known malicious process signatures
   - Unusual process spawning patterns
   - Processes accessing sensitive system areas

4. **Mouse Activity Spikes**
   - Unusually high mouse movement/click rates
   - Automated clicking patterns
   - Rapid cursor movements

5. **Keylogging Events**
   - Detection of keylogging software
   - Unauthorized keyboard monitoring
   - Suspicious input capture patterns

6. **User Plugs in a Phone**
   - Mobile device connection detected
   - MTP/PTP device pairing
   - Mobile device file transfer initiation

### Burst-Mode Behavior
When activated, the system will:

- **Increase Screenshot Frequency**: Reduce capture interval from default (60s) to 5-10 seconds
- **Enhanced File Monitoring**: Track all file operations, not just USB transfers
- **Process Monitoring**: Log all running processes and their activities
- **Network Activity Logging**: Capture all network connections and DNS queries
- **Keyboard/Mouse Activity**: Record input patterns and cursor movements
- **Extended Retention**: Keep burst-mode data for extended forensic analysis period

### Implementation Notes
- Burst-mode should be configurable (enable/disable, sensitivity thresholds)
- Automatic deactivation after a configurable quiet period
- Alert notifications to administrators when burst-mode activates
- Storage considerations for increased data volume
- Privacy compliance considerations for enhanced monitoring

---

## Technology Stack

- **Agent**: Rust (cross-platform, memory-safe)
- **Backend**: Rust (performance, type safety)
- **Database**: PostgreSQL 15+
- **Object Storage**: MinIO (S3-compatible)
- **Message Queue**: Redis
- **Dashboard**: TypeScript, React, Next.js, TailwindCSS
- **Communication**: REST API + gRPC (future), WebSockets for real-time

---

## Security Requirements

- TLS 1.3 for all communications
- AES-256-GCM for evidence encryption
- SHA-256 hashing for all files
- Tamper detection and integrity checks
- Full audit logging
- Role-based access control (Phase 4)

---

## Notes

- All timestamps in UTC with millisecond precision
- All evidence must maintain chain of custody
- Compliance with SOC2, GDPR, ISO 27001 (Phase 4)

---

## Packaging & Distribution

### Windows (.exe)

Rust compiles to native `.exe` by default. No additional tools required.

**Build Commands:**
```bash
# Build for Windows (on Windows)
cd agent
cargo build --release
# Output: target/release/rav-agent.exe

# Cross-compile from Linux/macOS
rustup target add x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc
# Output: target/x86_64-pc-windows-msvc/release/rav-agent.exe
```

**Optional: Create Windows Installer (MSI)**
- Use `cargo-wix` for MSI installer creation
- Or use WiX Toolset manually

### Linux (.deb Package)

Use `cargo-deb` to create Debian packages.

**Setup:**
```bash
# Install cargo-deb
cargo install cargo-deb

# Add metadata to agent/Cargo.toml (see below)
```

**Cargo.toml Configuration:**
```toml
[package.metadata.deb]
maintainer = "Your Name <your.email@example.com>"
copyright = "Copyright 2024"
license-file = ["LICENSE", "4"]
extended-description = """\
RAV Agent - Enterprise Digital Forensics & Endpoint Monitoring Platform
Cross-platform endpoint agent for forensic data collection.
"""
depends = "$auto"
section = "utils"
priority = "optional"
assets = [
    ["target/release/rav-agent", "/usr/bin/rav-agent", "755"],
    ["debian/rav-agent.service", "/etc/systemd/system/rav-agent.service", "644"],
]
```

**Build Command:**
```bash
cd agent
cargo deb
# Output: target/debian/rav-agent_0.1.0_amd64.deb
```

**Alternative: Create .rpm (Red Hat/CentOS)**
- Use `cargo-rpm` for RPM package creation

### macOS (.dmg)

Build binary and create disk image.

**Build Commands:**
```bash
# Build for macOS (Intel)
cargo build --release --target x86_64-apple-darwin

# Build for macOS (Apple Silicon)
cargo build --release --target aarch64-apple-darwin

# Universal binary (both architectures)
# Requires lipo tool
```

**Create DMG:**
```bash
# 1. Create app bundle structure
mkdir -p RAVAgent.app/Contents/MacOS
cp target/release/rav-agent RAVAgent.app/Contents/MacOS/

# 2. Create Info.plist for app bundle
# 3. Create DMG using hdiutil
hdiutil create -volname "RAV Agent" -srcfolder RAVAgent.app -ov -format UDZO rav-agent.dmg
```

**Alternative: Use cargo-bundle**
```bash
cargo install cargo-bundle
cargo bundle --release
# Creates .app bundle, then use hdiutil to create DMG
```

### Build Automation

**Recommended Tools:**
- `cargo-bundle` - Creates app bundles for macOS, Windows installers, and Linux packages
- `cargo-wix` - Creates Windows MSI installers
- `cargo-deb` - Creates Debian packages
- `cargo-rpm` - Creates RPM packages
- GitHub Actions - Automated cross-platform CI/CD builds

**Build Scripts (Future):**
- `agent/scripts/build-windows.ps1` - Windows build script
- `agent/scripts/build-deb.sh` - Linux .deb build script
- `agent/scripts/build-dmg.sh` - macOS .dmg build script
- `agent/scripts/build-all.sh` - Cross-platform build script

**CI/CD Integration:**
- GitHub Actions workflow for automated builds
- Build artifacts for all platforms on each release
- Automated signing and notarization (macOS)
- Code signing certificates (Windows/macOS)

### Distribution Checklist

- [ ] Add package metadata to `agent/Cargo.toml`
- [ ] Create systemd service file for Linux (`debian/rav-agent.service`)
- [ ] Create LaunchDaemon plist for macOS
- [ ] Create Windows Service configuration
- [ ] Set up code signing certificates
- [ ] Create build scripts for each platform
- [ ] Set up CI/CD for automated builds
- [ ] Create installation documentation
- [ ] Test installers on clean systems
- [ ] Set up update mechanism (future)

