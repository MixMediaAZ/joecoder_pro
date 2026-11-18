# tools/forgetastic/finalization_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md BUILD 9 FILE 2)

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .common import load_json, save_json, utc_now_iso


FINAL_SNAPSHOT_PATH = Path("forge/final/FINAL_SNAPSHOT.json")
LOCK_FILE_PATH = Path("forge/final/LOCK")


def _hash_object(obj: dict) -> str:
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def build_final_snapshot(root: Path) -> dict:
    manifest = load_json(root / "forge/manifest/MANIFEST.json", default={}) or {}
    structure = load_json(root / "forge/structure/STRUCTURE.json", default={}) or {}
    evidence = load_json(root / "forge/evidence/EVIDENCE_INDEX.json", default={}) or {}
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    done_gate = load_json(root / "forge/reports/DONE_GATE.json", default={}) or {}
    deployment_gate = load_json(root / "forge/reports/DEPLOYMENT_GATE.json", default={}) or {}
    prosecution = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}
    arbitration = load_json(root / "forge/prosecution/ARBITRATION_RESULT.json", default={}) or {}
    production = load_json(root / "forge/policy/PRODUCTION.json", default={}) or {}

    snapshot = {
        "generated_utc": utc_now_iso(),
        "manifest_hash": _hash_object(manifest),
        "structure_hash": _hash_object(structure),
        "evidence_hash": _hash_object(evidence),
        "enforcement_hash": _hash_object(enforcement),
        "drift_hash": _hash_object(drift),
        "done_gate_hash": _hash_object(done_gate),
        "deployment_gate_hash": _hash_object(deployment_gate),
        "prosecution_hash": _hash_object(prosecution),
        "arbitration_hash": _hash_object(arbitration),
        "production_hash": _hash_object(production),
    }

    save_json(root / FINAL_SNAPSHOT_PATH, snapshot)
    return snapshot


def lock_project(root: Path) -> None:
    lock_path = root / LOCK_FILE_PATH
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text("LOCKED\n", encoding="utf-8", newline="\n")
