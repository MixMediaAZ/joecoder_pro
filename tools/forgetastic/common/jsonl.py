# tools/forgetastic/common/jsonl.py

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List, Tuple
from .logging import get_logger

log = get_logger(__name__)


def read_jsonl(path: Path) -> Tuple[List[dict[str, Any]], List[dict[str, Any]]]:
    """
    Read JSONL file. Return (valid_rows, error_rows).

    This NEVER silently drops bad lines. All errors are tracked and logged.
    """
    valid_rows: List[dict[str, Any]] = []
    error_rows: List[dict[str, Any]] = []

    if not path.exists():
        return valid_rows, error_rows

    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.rstrip("\n\r")

            # Skip empty lines
            if not line.strip():
                continue

            try:
                row = json.loads(line)
                valid_rows.append(row)
            except json.JSONDecodeError as e:
                log.warning(f"{path}:{line_no} - JSON decode error: {e}")
                error_rows.append({
                    "line_no": line_no,
                    "error": str(e),
                    "content_preview": line[:100],
                })

    if error_rows:
        log.warning(f"{path} had {len(error_rows)} corrupted lines out of {len(valid_rows) + len(error_rows)} total")

    return valid_rows, error_rows


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    """Append single JSON object to JSONL file (one line)."""
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
