"""Allen Bradley ControlLogix / CompactLogix driver (EtherNet/IP via pycomm3).

``pycomm3`` is imported lazily so the rest of the system (simulator, API,
analytics, tests) runs on machines without it installed. Install it on the
on-site data-collection PC:

    pip install pycomm3

Reference: https://docs.pycomm3.dev/
"""

from __future__ import annotations

from typing import Any

from .base import LineReading, PLCDriver


class LogixDriver(PLCDriver):
    """Reads tags from a Logix-family PLC by name.

    The connection path is ``<host>/<slot>`` (slot 0 for CompactLogix). Tag
    names come from the line's ``tags`` map in ``config/lines.yaml``.
    """

    def __init__(self, key: str, name: str, tags: dict[str, str], host: str, slot: int = 0, **kw: Any):
        super().__init__(key, name, tags, **kw)
        if not host:
            raise ValueError(f"Line '{key}' uses the logix driver but has no PLC host configured")
        self.host = host
        self.slot = slot
        self._plc = None  # lazily created pycomm3.LogixDriver

    @property
    def path(self) -> str:
        return f"{self.host}/{self.slot}"

    def connect(self) -> None:
        if self._plc is not None:
            return
        try:
            from pycomm3 import LogixDriver as _PycommLogix  # noqa: N811
        except ImportError as exc:  # pragma: no cover - depends on host
            raise RuntimeError(
                "pycomm3 is required for the logix driver. Install it with "
                "'pip install pycomm3' on the data-collection PC."
            ) from exc
        self._plc = _PycommLogix(self.path)
        self._plc.open()

    def close(self) -> None:
        if self._plc is not None:
            try:
                self._plc.close()
            finally:
                self._plc = None

    def read(self) -> LineReading:
        try:
            if self._plc is None or not getattr(self._plc, "connected", False):
                self.connect()
        except Exception as exc:  # noqa: BLE001 - never let comms kill the loop
            return LineReading.offline(f"connect failed: {exc}")

        # Read every configured tag in one batched request for efficiency.
        wanted = {field: tag for field, tag in self.tags.items() if tag}
        tag_names = list(wanted.values())
        try:
            results = self._plc.read(*tag_names)
        except Exception as exc:  # noqa: BLE001
            self.close()  # force reconnect next cycle
            return LineReading.offline(f"read failed: {exc}")

        # pycomm3 returns a single Tag for one read, or a list for many.
        if not isinstance(results, list):
            results = [results]
        by_tag = {r.tag: r for r in results}

        raw: dict[str, Any] = {}
        values: dict[str, Any] = {}
        for field, tag in wanted.items():
            res = by_tag.get(tag)
            if res is not None and res.error is None:
                raw[tag] = res.value
                values[field] = res.value

        return LineReading(
            operator=_as_str(values.get("operator")),
            recipe=_as_str(values.get("recipe")),
            count=_as_int(values.get("count")),
            running=_as_bool(values.get("running")),
            fault=_as_bool(values.get("fault")),
            reject=_as_int(values.get("reject")),
            rate=_as_float(values.get("rate")),
            online=True,
            raw=raw,
        )


def _as_str(v: Any) -> str | None:
    if v is None:
        return None
    return str(v).strip() or None


def _as_int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _as_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _as_bool(v: Any) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    return str(v).strip().lower() in {"1", "true", "on", "yes"}
