@echo off
REM Live development server (Windows).
REM   - simulated PLCs + in-process collector (no hardware/SQL Server needed)
REM   - auto-reloads the backend when you save a .py file
REM   - frontend (web\*.html/.css/.js) is live on browser refresh - no restart
REM
REM Double-click this file, or run:  scripts\dev.bat   (then open http://localhost:8000)
cd /d "%~dp0\.."
set MES_SIMULATE=1
set MES_RUN_COLLECTOR=1
set MES_RELOAD=1
if "%MES_WEB_PORT%"=="" set MES_WEB_PORT=8000
echo Earlyrise MES dev server -^> http://localhost:%MES_WEB_PORT%  (Ctrl+C to stop)
python scripts\run_web.py
