@echo off
rem Start the development server. Double-click it, or run it from a terminal.
rem
rem ASCII only, deliberately: cmd.exe reads a batch file in the console's
rem one-byte codepage, so a stray dash or quotation mark from a word processor
rem shreds the parsing into unrelated error messages.
rem
rem Port 8001 is not a preference. It is registered with Google as an
rem authorised JavaScript origin and as an API-key referrer, and an origin is
rem matched exactly, so from any other port every cloud feature fails. Changing
rem it means editing the Google Cloud console too - see docs/CLOUD-SETUP.md.

setlocal enabledelayedexpansion
set "PORT=8001"
rem This script lives in _tools, one below the site root, which is what gets
rem served. %~dp0 already ends in a backslash.
cd /d "%~dp0.."

rem Pick an interpreter that can actually do the job. On one machine here
rem `python` resolved to a 32-bit Python 3.6 from 2017, which has no
rem --directory and failed in a way that looked like a network fault rather
rem than a wrong interpreter. So the version is checked, not assumed.
set "PY="
for %%C in ("py -3" "python" "python3") do (
  if not defined PY (
    %%~C -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>&1
    if !errorlevel! equ 0 set "PY=%%~C"
  )
)

if not defined PY (
  echo.
  echo   No Python 3.7 or newer was found on PATH.
  echo   Install it from https://www.python.org/downloads/ and try again.
  echo.
  exit /b 1
)

netstat -an | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
  echo.
  echo   Something already listens on port %PORT%.
  echo   If that is an older copy of this server, stop it first - otherwise the
  echo   browser keeps talking to whatever that is.
  echo.
  echo   To find it:  netstat -ano ^| findstr :%PORT%
  echo.
  exit /b 1
)

echo.
echo   Serving %CD%
echo   Front page  http://localhost:%PORT%/
echo   Editor      http://localhost:%PORT%/editor/
echo.
echo   Press Ctrl+C to stop.
echo.

%PY% -m http.server %PORT% --directory "%CD%"
