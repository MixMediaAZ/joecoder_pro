# tools/forgetastic/structure_engine.py

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

from .common import load_json, save_json, utc_now_iso, get_logger
from .structure_ast_engine import ast_structure_scan

log = get_logger("structure")

FORGETASTIC_PATTERN = re.compile(r"#\s*FORGETASTIC:\s*([A-Z]{3}-\d{3})")
SUSPICIOUS_PATTERN = re.compile(
    r"\b(mock|fake|placeholder|stub|todo|fixme)\b",
    re.IGNORECASE,
)


def scan_structure(root: Path, exclude_dirs: list[str] | None = None) -> List[dict[str, Any]]:
    """Scan source files for FORGETASTIC annotations."""
    if exclude_dirs is None:
        exclude_dirs = ["forge", ".git", "__pycache__", ".pytest_cache", "node_modules", ".venv"]

    entries = []

    for file_path in root.rglob("*"):
        # Skip excluded dirs
        if any(exc in file_path.parts for exc in exclude_dirs):
            continue

        # Only scan text files
        if not file_path.is_file() or file_path.suffix not in (".py", ".js", ".ts", ".jsx", ".tsx"):
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            log.warning(f"Cannot read {file_path}: {e}")
            continue

        # Find all FORGETASTIC annotations
        for line_no, line in enumerate(content.split("\n"), start=1):
            match = FORGETASTIC_PATTERN.search(line)
            if match:
                manifest_id = match.group(1)
                entries.append({
                    "file_path": str(file_path.relative_to(root)),
                    "line_number": line_no,
                    "manifest_id": manifest_id,
                    "confidence": "HIGH",  # Explicit annotation
                })

    return entries


def scan_undeclared_flags(root: Path, exclude_dirs: list[str] | None = None) -> List[dict[str, Any]]:
    """BUILD 6: suspicious tokens for enforcement_engine undeclared_code_flags."""
    if exclude_dirs is None:
        exclude_dirs = ["forge", ".git", "__pycache__", ".pytest_cache", "node_modules", ".venv", "tools/forgetastic", "tools\\forgetastic"]

    flags: List[dict[str, Any]] = []

    for file_path in root.rglob("*"):
        # Skip excluded dirs (handle both / and \ path separators)
        file_rel = str(file_path.relative_to(root)).replace("\\", "/")
        if any(exc.replace("\\", "/") in file_rel for exc in exclude_dirs):
            continue
        if any(exc in file_path.parts for exc in exclude_dirs):
            continue
        if not file_path.is_file() or file_path.suffix not in (".py", ".js", ".ts", ".jsx", ".tsx"):
            continue
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            log.warning(f"Cannot read {file_path}: {e}")
            continue
        rel = str(file_path.relative_to(root))
        for line_no, line in enumerate(content.split("\n"), start=1):
            m = SUSPICIOUS_PATTERN.search(line)
            if m:
                flags.append({
                    "pattern": m.group(1).lower(),
                    "file": rel,
                    "line": line_no,
                })
    return flags


def build_structure(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """
    Build structure report.

    Return:
    {
      "entries": [...],
      "summary": {
        "mapped_ids": [...],
        "unmapped_manifest_ids": [...],
      }
    }
    """
    comment_entries = scan_structure(root)
    ast_entries = ast_structure_scan(root)
    entries = comment_entries + ast_entries
    undeclared_code_flags = scan_undeclared_flags(root)

    # Get all manifest IDs
    all_manifest_ids = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            if item.get("id"):
                all_manifest_ids.add(item["id"])

    # Mapped IDs come only from FORGETASTIC comment rows (AST rows omit manifest_id)
    mapped_ids = {e["manifest_id"] for e in entries if e.get("manifest_id")}

    # Find unmapped manifest IDs
    unmapped = sorted(all_manifest_ids - mapped_ids)

    return {
        "entries": entries,
        "summary": {
            "total_files_scanned": len(list(root.rglob("*"))),
            "entry_count": len(entries),
            "forgetastic_entry_count": len(comment_entries),
            "ast_symbol_count": len(ast_entries),
            "mapped_ids": sorted(mapped_ids),
            "unmapped_manifest_ids": unmapped,
            "undeclared_code_flags": undeclared_code_flags,
            "generated_utc": utc_now_iso(),
        }
    }


def save_structure(root: Path, structure: dict[str, Any]) -> None:
    """Save structure JSON."""
    path = root / "forge" / "structure" / "STRUCTURE.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    save_json(path, structure)
