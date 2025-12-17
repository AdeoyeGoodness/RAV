# Windows Build Setup

## Current Issue
Rust needs a C/C++ linker to compile. On Windows, you have two options:

## Option 1: Visual Studio Build Tools (Recommended)

1. **Download Visual Studio Build Tools:**
   - Visit: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - Click "Download" under "Build Tools for Visual Studio 2022"

2. **Install:**
   - Run the installer
   - Select "C++ build tools" workload
   - Click "Install"
   - Wait for installation to complete (~3-5 GB)

3. **Restart your terminal/PowerShell**

4. **Switch back to MSVC toolchain:**
   ```powershell
   rustup default stable-x86_64-pc-windows-msvc
   ```

5. **Build:**
   ```powershell
   cd backend
   cargo build
   ```

## Option 2: MinGW-w64 (Alternative)

If you prefer not to install Visual Studio:

1. **Download MinGW-w64:**
   - Visit: https://www.mingw-w64.org/downloads/
   - Or use: https://winlibs.com/ (pre-built binaries)

2. **Extract and add to PATH:**
   - Extract to `C:\mingw64` (or your preferred location)
   - Add `C:\mingw64\bin` to your system PATH
   - Restart terminal

3. **Build:**
   ```powershell
   cd backend
   cargo build
   ```

## Quick Test

After installing either option, verify:
```powershell
cargo --version
rustc --version
```

Then try building:
```powershell
cd backend
cargo build
```

---

**Note:** Visual Studio Build Tools is the recommended approach for Windows Rust development and is required for many Rust crates.

