# tools/forgetastic/integrity_engine.py — structural / file integrity (release validation)

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .artifact_verifier import verify_artifacts
from .common import read_jsonl, save_json, utc_now_iso, sha256_dict
from .ledger_engine import verify_event_chain

INTEGRITY_REPORT_PATH = Path("forge/reports/INTEGRITY_REPORT.json")

_JSONL_PATHS = [
    Path("forge/evidence/RUNTIME_PROOF.jsonl"),
    Path("forge/overrides/OVERRIDE_REQUESTS.jsonl"),
    Path("forge/state/SESSION_LOG.jsonl"),
    Path("forge/ledger/STANDARD_EVENTS.jsonl"),
]


def _report_path(root: Path) -> Path:
    return root / INTEGRITY_REPORT_PATH


def _jsonl_corruption_count(root: Path) -> tuple[int, list[str]]:
    total_errors = 0
    paths_with_errors: list[str] = []
    for rel in _JSONL_PATHS:
        path = root / rel
        if not path.exists():
            continue
        _valid, errors = read_jsonl(path)
        if errors:
            total_errors += len(errors)
            paths_with_errors.append(str(rel))
    return total_errors, paths_with_errors


def _scan_forge_json(root: Path) -> list[str]:
    """Return list of forge/**/*.json paths that fail to parse."""
    bad: list[str] = []
    forge = root / "forge"
    if not forge.exists():
        return bad
    for path in forge.rglob("*.json"):
        try:
            text = path.read_text(encoding="utf-8")
            json.loads(text)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
            bad.append(f"{path.relative_to(root)}: {e}")
    return bad


def run_integrity(root: Path) -> dict[str, Any]:
    from .manifest_lint import load_manifest

    manifest = load_manifest(root / "forge/manifest/MANIFEST.json")
    blocking_items: list[dict[str, Any]] = []

    bad_json = _scan_forge_json(root)
    for msg in bad_json[:50]:
        blocking_items.append({"id": "JSON", "message": msg})
    if len(bad_json) > 50:
        blocking_items.append({"id": "JSON", "message": f"... and {len(bad_json) - 50} more JSON parse errors"})

    corrupt_n, paths_err = _jsonl_corruption_count(root)
    if corrupt_n:
        blocking_items.append(
            {
                "id": "JSONL",
                "message": f"{corrupt_n} corrupt line(s) in JSONL: {', '.join(paths_err)}",
            }
        )

    art = verify_artifacts(root)
    if art.get("verdict") != "PASS":
        blocking_items.append(
            {"id": "ARTIFACTS", "message": f"{art.get('missing_count', 0)} proof artifact path(s) missing on disk"}
        )

    chain = verify_event_chain(root)
    if chain.get("verdict") != "PASS":
        blocking_items.append({"id": "EVENT_CHAIN", "message": str(chain.get("message", "event chain failed"))})

    report: dict[str, Any] = {
        "report_name": "INTEGRITY_REPORT",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest) if manifest else None,
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "summary": {
            "invalid_json_files": len(bad_json),
            "jsonl_corrupt_lines": corrupt_n,
            "artifact_verification": art.get("verdict"),
            "event_chain": chain.get("verdict"),
        },
    }
    save_json(_report_path(root), report)
    return report
