# ADD to tools/forgetastic/common/io.py (new file)

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional
import os
import sys

# Platform-specific locking
if sys.platform == "win32":
    import msvcrt
    def lock_file(handle):
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    def unlock_file(handle):
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl
    def lock_file(handle):
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    def unlock_file(handle):
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_json(path: Path, default: Any = None) -> Any:
    """Load JSON from file. Returns default if missing or corrupt."""
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        # LOG THIS: print(f"WARNING: Failed to load {path}: {e}", file=sys.stderr)
        return default


def save_json(path: Path, data: Any) -> None:
    """Atomically save JSON to file (write-to-temp, then rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)

    # Write to temp file first
    temp_fd, temp_path = tempfile.mkstemp(
        dir=path.parent,
        prefix=".tmp_",
        suffix=".json"
    )
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())  # Force disk write

        # Atomic rename
        if sys.platform == "win32":
            # Windows doesn't allow overwrite on rename, must delete first
            if path.exists():
                path.unlink()
        os.rename(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def ensure_json_file(path: Path, default: Any = None) -> Any:
    """Load JSON file, or create with default if missing."""
    if not path.exists():
        save_json(path, default or {})
        return default or {}
    return load_json(path, default=default)


def ensure_directory(path: Path) -> None:
    """Create directory (idempotent)."""
    path.mkdir(parents=True, exist_ok=True)
