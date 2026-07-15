$ErrorActionPreference = "Stop"

py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install -r requirements.txt
npm --prefix=frontend install
npm --prefix=opencode-analytics-plugin install
