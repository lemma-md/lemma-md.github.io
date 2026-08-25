@echo off
rem Stop the development server, wherever it was started from.
rem
rem ASCII only, deliberately: cmd.exe reads a batch file in the console's
rem one-byte codepage, so a stray dash from a word processor shreds the
rem parsing into unrelated error messages.
rem
rem Useful mainly when the server has no visible window - started by a tool, or
rem left over from a console that has since been closed. With a window in front
rem of you, Ctrl+C in it is quicker.

setlocal enabledelayedexpansion
set "PORT=8001"

rem Column five of netstat -ano is the owning PID. The second filter drops the
rem browser's own connections *to* the port, which are ESTABLISHED, and keeps
rem only the process holding it open.
rem
rem The same process appears twice, once for IPv4 and once for IPv6, so the
rem list is made unique first. Killing a pid twice merely reports a failure for
rem a process that is already gone.
set "PIDS= "
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo !PIDS! | findstr /c:" %%P " >nul || set "PIDS=!PIDS!%%P "
)

if "!PIDS!"==" " (
  echo.
  echo   Nothing is listening on port %PORT% - already stopped.
  echo.
  exit /b 0
)

for %%P in (!PIDS!) do (
  echo   Stopping pid %%P on port %PORT% ...
  taskkill /PID %%P /F >nul 2>&1
)

rem Judge by the port, not by taskkill's exit code: a process that died as part
rem of its parent's tree reports a failure while having done exactly what was
rem wanted.
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
  echo.
  echo   Port %PORT% is still held. Try again from an elevated prompt.
  echo.
  exit /b 1
)

echo.
echo   Port %PORT% is free.
echo.
