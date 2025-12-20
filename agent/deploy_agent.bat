@echo off
setlocal
cd /d "%~dp0"

:: RAV Agent Deployment Script
:: Usage: deploy_agent.bat [SERVER_URL] [ENROLLMENT_TOKEN]

set SERVER_URL=%1
set TOKEN=%2

:: --- DEFAULTS (Baked-in) ---
if "%SERVER_URL%"=="" set SERVER_URL=http://10.245.212.213:8080
if "%TOKEN%"=="" set TOKEN=RAV-451P-7C6E-2YZK-QZCP
:: ---------------------------

if "%SERVER_URL%"=="" (
    echo [ERROR] No Server URL provided.
    goto :EOF
)

echo.
echo ==========================================
echo      RAV Agent Enterprise Installer
echo ==========================================
echo.
echo Server: %SERVER_URL%
echo Token:  %TOKEN%
echo.

:: Check if rav-agent.exe exists
if not exist "rav-agent.exe" (
    echo [ERROR] rav-agent.exe not found in current directory!
    pause
    exit /b 1
)

echo [1/3] Enrolling and Configuring Agent...
rav-agent.exe --server "%SERVER_URL%" --enroll "%TOKEN%" --install

if %ERRORLEVEL% NEQ 0 (
    echo [FAILURE] Enrollment or Installation failed.
    echo Please check the output above.
    pause
    exit /b 1
)

echo.
echo [2/3] Verifying Service Status...
sc query "RAV Agent"

echo.
echo [SUCCESS] Agent is installed and running as a service!
echo You can close this window.
pause
