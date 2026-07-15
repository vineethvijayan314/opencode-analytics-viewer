$ErrorActionPreference = "Stop"

$api = Start-Process -FilePath .\.venv\Scripts\python.exe -ArgumentList "-m", "uvicorn", "app:app", "--port", "7123" -PassThru
try {
  Push-Location frontend
  try {
    npm run dev
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} finally {
  Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
