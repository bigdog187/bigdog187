"""Database engine / session management.

Defaults to a local SQLite file so the system runs anywhere with zero setup
(demo, CI, off-site dev). On-site at Earlyrise it connects to Microsoft SQL
Server — just set the environment variables below and the same code logs
straight into SQL Server with no changes.

Environment variables
---------------------
MES_DATABASE_URL      Full SQLAlchemy URL. If set, used verbatim (highest priority).
MES_DB_BACKEND        "sqlite" (default) or "sqlserver".
MES_SQLITE_PATH       SQLite file path (default: <root>/data/earlyrise_mes.db).

For MES_DB_BACKEND=sqlserver:
MES_SQLSERVER_HOST    e.g. "BAKERY-SQL\\SQLEXPRESS" or "10.0.0.5,1433"
MES_SQLSERVER_DB      database name (default: EarlyriseMES)
MES_SQLSERVER_USER    SQL login (omit for Windows/trusted auth)
MES_SQLSERVER_PASSWORD
MES_SQLSERVER_DRIVER  ODBC driver name (default: "ODBC Driver 17 for SQL Server")
MES_SQLSERVER_TRUSTED set "1" to use Windows integrated auth.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, URL
from sqlalchemy.orm import Session, sessionmaker

from .config import PACKAGE_ROOT
from .models import Base


def _sqlite_url() -> str:
    default_path = PACKAGE_ROOT / "data" / "earlyrise_mes.db"
    db_path = Path(os.getenv("MES_SQLITE_PATH", str(default_path)))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path}"


def _sqlserver_url() -> URL:
    driver = os.getenv("MES_SQLSERVER_DRIVER", "ODBC Driver 17 for SQL Server")
    host = os.getenv("MES_SQLSERVER_HOST", "localhost")
    database = os.getenv("MES_SQLSERVER_DB", "EarlyriseMES")
    trusted = os.getenv("MES_SQLSERVER_TRUSTED", "").lower() in {"1", "true", "yes"}

    odbc_parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={host}",
        f"DATABASE={database}",
    ]
    if trusted:
        odbc_parts.append("Trusted_Connection=yes")
    else:
        odbc_parts.append(f"UID={os.getenv('MES_SQLSERVER_USER', '')}")
        odbc_parts.append(f"PWD={os.getenv('MES_SQLSERVER_PASSWORD', '')}")
    odbc_parts.append("TrustServerCertificate=yes")

    odbc_str = ";".join(odbc_parts)
    return URL.create(
        "mssql+pyodbc",
        query={"odbc_connect": odbc_str},
    )


def database_url() -> str | URL:
    explicit = os.getenv("MES_DATABASE_URL")
    if explicit:
        return explicit
    backend = os.getenv("MES_DB_BACKEND", "sqlite").lower()
    if backend in {"sqlserver", "mssql"}:
        return _sqlserver_url()
    return _sqlite_url()


# Build the engine lazily-ish at import; cheap and lets the API/collector share it.
_url = database_url()
_is_sqlite = str(_url).startswith("sqlite")

engine: Engine = create_engine(
    _url,
    pool_pre_ping=True,
    future=True,
    # SQLite + threads (FastAPI workers / collector thread) need this flag.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    """Create all tables if they don't exist."""
    Base.metadata.create_all(engine)


def new_session() -> Session:
    return SessionLocal()


def describe_backend() -> str:
    return "sqlite" if _is_sqlite else "sqlserver"
