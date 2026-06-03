#!/usr/bin/env python3
"""Create the MES database schema (idempotent).

Usage:
    python scripts/init_db.py

Works against whatever backend is configured (SQLite by default, or SQL Server
when the MES_DB_BACKEND / MES_SQLSERVER_* variables are set).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mes.database import describe_backend, init_db  # noqa: E402


def main() -> None:
    init_db()
    print(f"Schema ready on backend: {describe_backend()}")


if __name__ == "__main__":
    main()
