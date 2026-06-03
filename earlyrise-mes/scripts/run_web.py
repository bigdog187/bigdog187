#!/usr/bin/env python3
"""Run the web reporting server (REST API + dashboard).

Usage:
    python scripts/run_web.py                 # serve on 0.0.0.0:8000
    MES_RUN_COLLECTOR=1 python scripts/run_web.py   # also poll PLCs in-process

Open http://<this-pc-ip>:8000/ from any machine on the bakery network.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402


def main() -> None:
    host = os.getenv("MES_WEB_HOST", "0.0.0.0")
    port = int(os.getenv("MES_WEB_PORT", "8000"))
    uvicorn.run("mes.api.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
