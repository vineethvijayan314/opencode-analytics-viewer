$ErrorActionPreference = "Stop"

py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install -r requirements.txt
Push-Location frontend
try {
  npm install
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location opencode-analytics-plugin
try {
  npm install
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
