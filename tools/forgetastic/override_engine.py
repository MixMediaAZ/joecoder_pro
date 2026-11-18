# tools/forgetastic/override_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md BUILD 7 FILE 2)

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

# Type alias for consistency
JSONDict = Dict[str, Any]

from .common import utc_now_iso


OVERRIDE_PATH = Path("forge/overrides/OVERRIDE_REQUESTS.jsonl")


def _path(root: Path) -> Path:
    return root / OVERRIDE_PATH


def append_override(root: Path, entry: dict) -> None:
    p = _path(root)
    p.parent.mkdir(parents=True, exist_ok=True)

    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_overrides(root: Path) -> List[dict]:
    """
    Read override requests from JSONL file.

    Enforces fail-closed behavior: raises exception on malformed JSON.
    No silent skipping of invalid entries allowed.

    Args:
        root: Project root

    Returns:
        List of parsed override dicts

    Raises:
        ValueError: If any line is malformed JSON
    """
    p = _path(root)
    if not p.exists():
        return []

    rows = []
    errors: List[dict[str, Any]] = []

    with p.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                errors.append({
                    "line_number": line_num,
                    "content_preview": line[:100],
                    "error": str(e),
                })
                raise ValueError(
                    f"Malformed JSON in OVERRIDE_REQUESTS.jsonl at line {line_num}: {e}"
                ) from e

    return rows


def active_overrides(root: Path) -> List[dict]:
    return [o for o in read_overrides(root) if o.get("status") == "ACTIVE"]


def create_override(
    root: Path,
    reason: str,
    manifest_ids: List[str],
    expires_utc: str,
    created_by: str,
) -> dict:

    entry = {
        "override_id": f"OVR-{utc_now_iso().replace(':','').replace('-','')}",
        "created_utc": utc_now_iso(),
        "created_by": created_by,
        "reason": reason,
        "manifest_ids": manifest_ids,
        "expires_utc": expires_utc,
        "status": "ACTIVE",
    }

    append_override(root, entry)
    return entry
