@echo off
setlocal
pushd "%~dp0."
if errorlevel 1 exit /b 1
set "PATH=%CD%\runtime\bin;%PATH%"
if exist "runtime\bin\node.exe" goto launch
if not exist "runtime\sdk\node.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\portable\bootstrap-windows.ps1"
  if errorlevel 1 goto failed
)
set "PATH=%CD%\runtime\sdk;%PATH%"
"runtime\sdk\node.exe" scripts\portable\bootstrap.mjs
if errorlevel 1 goto failed
"runtime\sdk\node.exe" server\start.mjs --open
goto finish
:launch
"runtime\bin\node.exe" server\start.mjs --open
:finish
if errorlevel 1 goto failed
popd
exit /b 0
:failed
echo Startup failed. See the message above.
if not defined STUDIO_NO_OPEN pause
popd
exit /b 1
