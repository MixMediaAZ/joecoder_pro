# tools/forgetastic/done_gate_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md BUILD 7 FILE 1)

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from .common import load_json, save_json, utc_now_iso, sha256_dict


DONE_GATE_PATH = Path("forge/reports/DONE_GATE.json")


def _path(root: Path) -> Path:
    return root / DONE_GATE_PATH


def run_done_gate(root: Path, manifest: dict, policy: dict) -> dict:
    _ = policy
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    evidence_index = load_json(root / "forge/evidence/EVIDENCE_INDEX.json", default={}) or {}

    blocking_items: List[dict] = []
    warnings: List[dict] = []

    if not manifest.get("manifest_locked"):
        blocking_items.append({"id": "MANIFEST", "message": "Manifest not locked"})

    if not manifest.get("operator_approved"):
        blocking_items.append({"id": "MANIFEST", "message": "Operator not approved"})

    if enforcement.get("verdict") != "PASS":
        blocking_items.append({"id": "ENFORCEMENT", "message": "Enforcement failing"})

    if drift.get("verdict") != "PASS":
        blocking_items.append({"id": "DRIFT", "message": "Drift failing"})

    missing_required_ids = evidence_index.get("missing_required_ids", []) or []
    if missing_required_ids:
        blocking_items.append({
            "id": "EVIDENCE",
            "message": f"{len(missing_required_ids)} required items missing proof"
        })

    report = {
        "report_name": "DONE_GATE",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest),
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "summary": {
            "missing_required_proof_count": len(missing_required_ids),
            "enforcement_status": enforcement.get("verdict"),
            "drift_status": drift.get("verdict"),
        },
    }

    save_json(_path(root), report)
    return report
