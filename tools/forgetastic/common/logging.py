# tools/forgetastic/common/logging.py

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from datetime import datetime


class ForgetasticLogger:
    """Simple structured logger."""

    def __init__(self, name: str):
        self.name = name

    def _log(self, level: str, msg: str) -> None:
        ts = datetime.utcnow().isoformat() + "Z"
        print(f"[{ts}] [{self.name}] {level:8s} {msg}", file=sys.stderr)

    def debug(self, msg: str) -> None:
        self._log("DEBUG", msg)

    def info(self, msg: str) -> None:
        self._log("INFO", msg)

    def warning(self, msg: str) -> None:
        self._log("WARNING", msg)

    def error(self, msg: str) -> None:
        self._log("ERROR", msg)

    def critical(self, msg: str) -> None:
        self._log("CRITICAL", msg)


def get_logger(name: str) -> ForgetasticLogger:
    return ForgetasticLogger(name)
