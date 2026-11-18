from __future__ import annotations
from datetime import datetime, UTC


def utc_now_iso() -> str:
    """Return current UTC time as ISO8601 string."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
