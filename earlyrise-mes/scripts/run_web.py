#!/usr/bin/env python3
"""Run the web reporting server (REST API + dashboard).

Usage:
    python scripts/run_web.py                 # serve on 0.0.0.0:8000
    MES_RUN_COLLECTOR=1 python scripts/run_web.py   # also poll PLCs in-process
    MES_RELOAD=1 python scripts/run_web.py     # dev: auto-restart on code change

Open http://<this-pc-ip>:8000/ from any machine on the bakery network.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> None:
    host = os.getenv("MES_WEB_HOST", "0.0.0.0")
    port = int(os.getenv("MES_WEB_PORT", "8000"))
    reload = _truthy("MES_RELOAD")
    # In dev, watch the package and the web assets so backend edits restart the
    # server (frontend edits just need a browser refresh — no restart needed).
    uvicorn.run(
        "mes.api.app:app",
        host=host,
        port=port,
        log_level="info",
        reload=reload,
        reload_dirs=[str(ROOT / "mes"), str(ROOT / "web")] if reload else None,
    )


if __name__ == "__main__":
    main()
