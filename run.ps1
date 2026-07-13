$ErrorActionPreference = "Stop"

$api = Start-Process -FilePath .\.venv\Scripts\python.exe -ArgumentList "-m", "uvicorn", "app:app", "--port", "8000" -PassThru
try {
  npm --prefix frontend run dev
} finally {
  Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
