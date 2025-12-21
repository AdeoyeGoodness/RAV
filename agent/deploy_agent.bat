@echo off
setlocal
cd /d "%~dp0"

:: RAV Agent Deployment Script
:: Usage: deploy_agent.bat [SERVER_URL] [ENROLLMENT_TOKEN]

set SERVER_URL=%1
set TOKEN=%2

:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Run as Administrator required.
    pause
    exit /b 1
)

:: --- DEFAULTS ---
if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:8080
if "%TOKEN%"=="" set TOKEN=RAV-451P-7C6E-2YZK-QZCP
:: ----------------

echo.
echo ==========================================
echo      RAV Agent Enterprise Installer
echo ==========================================
echo.
echo Target: C:\Program Files\RAV\rav-agent.exe
echo Server: %SERVER_URL%
echo Token:  %TOKEN%
echo.

:: 1. Create Installation Directory & Harden Permissions
if not exist "C:\Program Files\RAV" (
    mkdir "C:\Program Files\RAV"
)
:: Protection: Remove inheritance, Grant System/Admins Full Control, Remove Users
echo [Security] Hardening Program Files Directory...
icacls "C:\Program Files\RAV" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM":(OI)(CI)F "BUILTIN\Administrators":(OI)(CI)F /q >nul

:: 2. Copy Binary
if not exist "rav-agent.exe" (
    echo [ERROR] rav-agent.exe not found in source directory!
    pause
    exit /b 1
)
copy /Y "rav-agent.exe" "C:\Program Files\RAV\rav-agent.exe" >nul
if %ERRORLEVEL% NEQ 0 (
    echo [FAILURE] Failed to copy binary to Program Files.
    pause
    exit /b 1
)

:: 3. Run Agent (Enroll & Install Service) from Target Location
echo [1/3] Enrolling and Installing Service...
"C:\Program Files\RAV\rav-agent.exe" --server "%SERVER_URL%" --enroll "%TOKEN%" --install

if %ERRORLEVEL% NEQ 0 (
    echo [FAILURE] Enrollment or Installation failed.
    echo Please check the output above.
    pause
    exit /b 1
)

:: 4. Harden Config Directory (Post-Install)
echo [Security] Hardening Config Directory...
if exist "C:\ProgramData\RAV" (
    icacls "C:\ProgramData\RAV" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM":(OI)(CI)F "BUILTIN\Administrators":(OI)(CI)F /q >nul
)

echo.
echo [2/3] Verifying Persistence...
:: Set dependency just in case rust code missed it, though agent usually handles retries.
sc config "RAV Agent" depend= Tcpip/Dhcp start= auto
sc query "RAV Agent"

echo.
echo [SUCCESS] Agent is installed and running as a service!
echo You can close this window.
pause
