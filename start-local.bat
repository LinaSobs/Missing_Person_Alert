@echo off
setlocal
cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing frontend packages for Missing Person Alert...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dev
