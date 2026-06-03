#!/usr/bin/env bash
# Live development server (macOS / Linux).
#   - simulated PLCs + in-process collector (no hardware/SQL Server needed)
#   - auto-reloads the backend when you save a .py file
#   - frontend (web/*.html/.css/.js) is live on browser refresh — no restart
#
# Run from anywhere:  ./scripts/dev.sh   (then open http://localhost:8000)
set -e
cd "$(dirname "$0")/.."
export MES_SIMULATE=1
export MES_RUN_COLLECTOR=1
export MES_RELOAD=1
export MES_WEB_PORT="${MES_WEB_PORT:-8000}"
echo "Earlyrise MES dev server → http://localhost:${MES_WEB_PORT}  (Ctrl+C to stop)"
exec python scripts/run_web.py
