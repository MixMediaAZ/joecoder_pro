# tools/forgetastic/manifest_lint.py

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .common import get_logger, load_json, save_json, utc_now_iso, sha256_dict

log = get_logger("manifest_lint")


def load_manifest(path: Path) -> dict[str, Any] | None:
    """Load manifest JSON. Log error but don't raise."""
    data = load_json(path, default=None)
    if data is None:
        log.error(f"Manifest not found or invalid JSON: {path}")
    return data


def save_manifest(path: Path, manifest: dict[str, Any]) -> None:
    """Save manifest JSON atomically."""
    manifest["updated_utc"] = utc_now_iso()
    save_json(path, manifest)
    log.info(f"Manifest saved: {path}")


def lint_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """
    Run all lint checks. Return report.

    Report format:
    {
      "verdict": "PASS" | "FAIL",
      "blocking_items": [{id, message}, ...],
      "warnings": [{id, message}, ...],
      "generated_utc": "...",
    }
    """
    blocking_items: List[dict[str, str]] = []
    warnings: List[dict[str, str]] = []

    # Check 1: Required fields
    errors = check_required_fields(manifest)
    for error in errors:
        blocking_items.append({"id": "MANIFEST", "message": error})

    # Check 2: ID format
    errors = check_id_format(manifest)
    for error in errors:
        blocking_items.append({"id": "MANIFEST", "message": error})

    # Check 3: Unique IDs
    errors = check_unique_ids(manifest)
    for error in errors:
        blocking_items.append({"id": "MANIFEST", "message": error})

    # Check 4: Mode is valid
    mode = manifest.get("mode", "").upper().strip()
    if mode not in ("LITE", "STANDARD", "FULL", "REGULATED"):
        blocking_items.append({
            "id": "MANIFEST",
            "message": f"mode must be LITE|STANDARD|FULL|REGULATED, got: {mode}"
        })

    return {
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest),
    }


def render_manifest_markdown(root: Path, manifest: dict[str, Any]) -> str:
    """Render manifest as markdown (human-readable)."""
    lines = []

    lines.append("# PROJECT MANIFEST")
    lines.append("")
    lines.append(f"**Project:** {manifest.get('project', 'UNKNOWN')}")
    lines.append(f"**Mode:** {manifest.get('mode', 'UNKNOWN')}")
    lines.append(f"**Purpose:** {manifest.get('purpose', 'UNKNOWN')}")
    lines.append(f"**Locked:** {manifest.get('manifest_locked', False)}")
    lines.append("")

    # Behaviors
    behaviors = manifest.get("behaviors", []) or []
    lines.append(f"## Behaviors ({len(behaviors)})")
    lines.append("")
    for bhv in behaviors:
        required = "**REQUIRED**" if bhv.get("required", False) else "optional"
        lines.append(f"### {bhv.get('id', 'UNKNOWN')} — {bhv.get('title', 'UNKNOWN')} ({required})")
        lines.append(f"{bhv.get('description', '')}")
        lines.append("")

    # Failures
    failures = manifest.get("failures", []) or []
    lines.append(f"## Failures ({len(failures)})")
    lines.append("")
    for fail in failures:
        lines.append(f"### {fail.get('id', 'UNKNOWN')} — {fail.get('title', 'UNKNOWN')}")
        lines.append(f"{fail.get('description', '')}")
        if fail.get("mitigation"):
            lines.append(f"**Mitigation:** {fail.get('mitigation')}")
        lines.append("")

    # Integrations
    integrations = manifest.get("integrations", []) or []
    lines.append(f"## Integrations ({len(integrations)})")
    lines.append("")
    for intg in integrations:
        lines.append(f"### {intg.get('id', 'UNKNOWN')} — {intg.get('title', 'UNKNOWN')}")
        lines.append(f"**Service:** {intg.get('service', 'UNKNOWN')}")
        lines.append(f"**Endpoint:** {intg.get('endpoint', 'UNKNOWN')}")
        lines.append("")

    return "\n".join(lines)


def check_required_fields(manifest: dict[str, Any]) -> List[str]:
    errors = []
    if not manifest.get("project", "").strip():
        errors.append("manifest.project is required")
    if not manifest.get("mode", "").strip():
        errors.append("manifest.mode is required")
    if not manifest.get("purpose", "").strip():
        errors.append("manifest.purpose is required")
    return errors


def check_id_format(manifest: dict[str, Any]) -> List[str]:
    import re
    id_pattern = re.compile(r"^[A-Z]{3}-\d{3}$")
    errors = []

    for section in ("users", "behaviors", "failures", "integrations", "assumptions", "out_of_scope"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id", "").strip()
            if item_id and not id_pattern.match(item_id):
                errors.append(f"{section}[{item_id}]: invalid ID format, must be XXX-### (e.g., BHV-001)")
    return errors


def check_unique_ids(manifest: dict[str, Any]) -> List[str]:
    all_ids = set()
    errors = []

    for section in ("users", "behaviors", "failures", "integrations", "assumptions", "out_of_scope"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id", "").strip()
            if not item_id:
                errors.append(f"{section}[]: item missing 'id' field")
                continue
            if item_id in all_ids:
                errors.append(f"Duplicate ID across manifest: {item_id}")
            all_ids.add(item_id)

    return errors
