# tools/forgetastic/structure_ast_engine.py (BUILD 10)

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

SUPPORTED_EXTENSIONS = {".py"}


def _should_skip(path: Path, root: Path, exclude_dirs: list[str]) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    return any(part in exclude_dirs for part in rel.parts)


def scan_python_file(file_path: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    try:
        source = file_path.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except (OSError, SyntaxError, UnicodeDecodeError):
        return results

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            results.append({"type": "function", "name": node.name, "line": node.lineno})
        elif isinstance(node, ast.ClassDef):
            results.append({"type": "class", "name": node.name, "line": node.lineno})

    return results


def ast_structure_scan(root: Path, exclude_dirs: list[str] | None = None) -> list[dict[str, Any]]:
    """AST-backed symbol list (Python only). Paths are relative to root."""
    if exclude_dirs is None:
        exclude_dirs = ["forge", ".git", "__pycache__", ".pytest_cache", "node_modules", ".venv"]

    entries: list[dict[str, Any]] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in SUPPORTED_EXTENSIONS:
            continue
        if _should_skip(path, root, exclude_dirs):
            continue

        rel = str(path.relative_to(root))
        for sym in scan_python_file(path):
            entries.append({
                "file_path": rel,
                "line_number": sym["line"],
                "manifest_id": None,
                "symbol_name": sym["name"],
                "symbol_type": sym["type"],
                "confidence": "HIGH",
            })

    return entries
