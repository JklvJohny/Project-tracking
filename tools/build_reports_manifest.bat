@echo off
rem Double-click to rebuild reports\manifest.js after adding or removing PDFs.
cd /d "%~dp0.."
python tools\build_reports_manifest.py
if errorlevel 1 (
  echo.
  echo Failed. Is Python installed and on PATH?
)
pause
