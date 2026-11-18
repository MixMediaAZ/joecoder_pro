# tools/forgetastic/release_gate_engine.py — shippable release rule (final discipline)

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import load_json, save_json, utc_now_iso, sha256_dict
from .override_engine import active_overrides
from .truth_engine import has_prosecution_results

RELEASE_GATE_REPORT_PATH = Path("forge/reports/RELEASE_GATE_REPORT.json")


def _path(root: Path) -> Path:
    return root / RELEASE_GATE_REPORT_PATH


def run_release_gate(root: Path) -> dict[str, Any]:
    """
    Release allowed only if audit, truth, integrity, deployment-gate PASS;
    manifest still locked; no active overrides; prosecution complete;
    arbitration complete if needed; finalization artifacts present.
    """
    from .manifest_lint import load_manifest

    manifest = load_manifest(root / "forge/manifest/MANIFEST.json")
    audit = load_json(root / "forge/reports/AUDIT_REPORT.json", default={}) or {}
    truth = load_json(root / "forge/reports/TRUTH_REPORT.json", default={}) or {}
    integrity = load_json(root / "forge/reports/INTEGRITY_REPORT.json", default={}) or {}
    deployment = load_json(root / "forge/reports/DEPLOYMENT_GATE.json", default={}) or {}
    prosecution_cmp = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}
    prosecution_a = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_A.json", default={}) or {}
    prosecution_b = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_B.json", default={}) or {}
    arbitration = load_json(root / "forge/prosecution/ARBITRATION_RESULT.json", default={}) or {}

    blocking_items: list[dict[str, Any]] = []

    if manifest is None or not manifest.get("manifest_locked", False):
        blocking_items.append({"id": "MANIFEST", "message": "Manifest must be locked for release"})

    current_manifest_hash = sha256_dict(manifest) if manifest else None
    hash_checked_reports = [
        ("TRUTH", truth),
        ("INTEGRITY", integrity),
        ("DEPLOYMENT_GATE", deployment),
    ]
    for label, report_obj in hash_checked_reports:
        report_hash = report_obj.get("manifest_hash") if isinstance(report_obj, dict) else None
        if current_manifest_hash and report_hash and report_hash != current_manifest_hash:
            blocking_items.append({"id": label, "message": f"{label} manifest_hash is stale; re-run the gate"})

    audit_hashes = audit.get("manifest_hashes") if isinstance(audit, dict) else None
    if current_manifest_hash and isinstance(audit_hashes, dict):
        stale_audit_children = [name for name, h in audit_hashes.items() if h and h != current_manifest_hash]
        if stale_audit_children:
            blocking_items.append({"id": "AUDIT", "message": f"Audit contains stale child report hashes: {', '.join(stale_audit_children)}"})

    def _ts(report_obj: dict[str, Any]) -> str | None:
        value = report_obj.get("generated_utc") if isinstance(report_obj, dict) else None
        return value if isinstance(value, str) else None

    # Timestamp coherence: a report cannot be trusted if one of its inputs
    # was regenerated later. This blocks stale PASS artifacts.
    truth_inputs = [integrity, deployment]
    for dep in truth_inputs:
        if _ts(dep) and _ts(truth) and _ts(dep) > _ts(truth):
            blocking_items.append({"id": "TRUTH", "message": "TRUTH_REPORT is older than a dependency; re-run truth"})
            break

    audit_inputs = [truth, integrity, deployment]
    for dep in audit_inputs:
        if _ts(dep) and _ts(audit) and _ts(dep) > _ts(audit):
            blocking_items.append({"id": "AUDIT", "message": "AUDIT_REPORT is older than a dependency; re-run audit"})
            break

    if audit.get("system_verdict") != "PASS":
        blocking_items.append({"id": "AUDIT", "message": "AUDIT_REPORT system_verdict must be PASS"})
    if truth.get("verdict") != "PASS":
        blocking_items.append({"id": "TRUTH", "message": "TRUTH_REPORT verdict must be PASS"})
    if integrity.get("verdict") != "PASS":
        blocking_items.append({"id": "INTEGRITY", "message": "INTEGRITY_REPORT verdict must be PASS"})
    if deployment.get("verdict") != "PASS":
        blocking_items.append({"id": "DEPLOYMENT_GATE", "message": "DEPLOYMENT_GATE verdict must be PASS"})

    if active_overrides(root):
        blocking_items.append({"id": "OVERRIDES", "message": "Active overrides must be cleared for release"})

    if not has_prosecution_results(prosecution_a) or not has_prosecution_results(prosecution_b):
        blocking_items.append({"id": "PROSECUTION", "message": "Prosecution A and B results must both be present"})

    if prosecution_cmp.get("verdict") != "PASS":
        blocking_items.append({"id": "PROSECUTION_CMP", "message": "PROSECUTION_COMPARISON verdict must be PASS"})

    disputes = prosecution_cmp.get("disagreements") or []
    if isinstance(disputes, list) and len(disputes) > 0:
        if not arbitration.get("results"):
            blocking_items.append({"id": "ARBITRATION", "message": "Arbitration results required when prosecutors disagreed"})

    snapshot = load_json(root / "forge/final/FINAL_SNAPSHOT.json", default={}) or {}
    lock_exists = (root / "forge/final/LOCK").exists()
    if not snapshot:
        blocking_items.append({"id": "FINALIZE", "message": "FINAL_SNAPSHOT.json must exist (finalize succeeded)"})
    if not lock_exists:
        blocking_items.append({"id": "LOCK", "message": "forge/final/LOCK must exist"})

    report: dict[str, Any] = {
        "report_name": "RELEASE_GATE_REPORT",
        "generated_utc": utc_now_iso(),
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "summary": {
            "release_allowed": not blocking_items,
        },
    }
    save_json(_path(root), report)
    return report
