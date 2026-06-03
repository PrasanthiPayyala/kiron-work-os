# Starts the POC backend: isolated Postgres (port 5433) + FastAPI (port 8787).
# Usage:  powershell -ExecutionPolicy Bypass -File backend\run-dev.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pgbin = "C:\Program Files\PostgreSQL\18\bin"
$data  = Join-Path $root ".pgdata"
$py    = Join-Path $root ".venv\Scripts\python.exe"

Write-Host "Starting Postgres on :5433 ..."
& "$pgbin\pg_ctl.exe" -D $data -l "$data\server.log" -o "-p 5433" start | Out-Null
Start-Sleep -Seconds 2

Write-Host "Starting FastAPI on :8787 ..."
Push-Location $root
& $py -m uvicorn app.main:app --port 8787 --reload
Pop-Location
