# tools/forgetastic/audit_engine.py — system-wide verdict aggregation (release validation)

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import load_json, save_json, utc_now_iso
from .override_engine import active_overrides

AUDIT_REPORT_PATH = Path("forge/reports/AUDIT_REPORT.json")


def _path(root: Path) -> Path:
    return root / AUDIT_REPORT_PATH


def _v(report: dict[str, Any]) -> str | None:
    return report.get("verdict") if isinstance(report, dict) else None


def run_audit(root: Path) -> dict[str, Any]:
    """
    Aggregate gate verdicts. system_verdict is PASS only when every required
    component is present and PASS, and there are no active overrides.
    """
    manifest_lint = load_json(root / "forge/reports/MANIFEST_LINT_REPORT.json", default={}) or {}
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    done_gate = load_json(root / "forge/reports/DONE_GATE.json", default={}) or {}
    integrity = load_json(root / "forge/reports/INTEGRITY_REPORT.json", default={}) or {}
    truth = load_json(root / "forge/reports/TRUTH_REPORT.json", default={}) or {}
    deployment = load_json(root / "forge/reports/DEPLOYMENT_GATE.json", default={}) or {}

    checks: dict[str, Any] = {
        "manifest_lint": _v(manifest_lint),
        "enforcement": _v(enforcement),
        "drift": _v(drift),
        "done_gate": _v(done_gate),
        "integrity": _v(integrity),
        "truth": _v(truth),
        "deployment_gate": _v(deployment),
    }

    missing = [name for name, v in checks.items() if v is None]
    failed = [name for name, v in checks.items() if v is not None and v != "PASS"]

    overrides = active_overrides(root)
    override_block = len(overrides) > 0

    reasons: list[str] = []
    if missing:
        reasons.append(f"reports missing or no verdict: {', '.join(missing)}")
    if failed:
        reasons.append(f"non-PASS verdicts: {', '.join(failed)}")
    if override_block:
        reasons.append(f"active overrides: {len(overrides)}")

    system_verdict = "PASS" if not missing and not failed and not override_block else "FAIL"

    # Capture report freshness (timestamps when each report was generated)
    report_timestamps: dict[str, str | None] = {}
    for report_name, report_obj in [
        ("manifest_lint", manifest_lint),
        ("enforcement", enforcement),
        ("drift", drift),
        ("done_gate", done_gate),
        ("integrity", integrity),
        ("truth", truth),
        ("deployment_gate", deployment),
    ]:
        report_timestamps[report_name] = report_obj.get("generated_utc") if isinstance(report_obj, dict) else None

    # Check that all reports were generated from the same manifest (manifest_hash consistency).
    # All 7 reports now include manifest_hash: manifest_lint, enforcement, drift, done_gate,
    # integrity, truth, deployment_gate. Mismatch = coherence breach (manifest edited between runs).
    manifest_hashes: dict[str, str | None] = {}
    for report_name, report_obj in [
        ("manifest_lint", manifest_lint),
        ("enforcement", enforcement),
        ("drift", drift),
        ("done_gate", done_gate),
        ("integrity", integrity),
        ("truth", truth),
        ("deployment_gate", deployment),
    ]:
        manifest_hashes[report_name] = report_obj.get("manifest_hash") if isinstance(report_obj, dict) else None

    unique_hashes = {h for h in manifest_hashes.values() if h is not None}
    manifest_hash_mismatch = len(unique_hashes) > 1
    if manifest_hash_mismatch:
        reasons.append(f"manifest_hash mismatch across reports: {unique_hashes}")
        system_verdict = "FAIL"

    report: dict[str, Any] = {
        "report_name": "AUDIT_REPORT",
        "generated_utc": utc_now_iso(),
        "system_verdict": system_verdict,
        "checks": checks,
        "report_timestamps": report_timestamps,
        "manifest_hashes": manifest_hashes,
        "active_override_count": len(overrides),
        "failure_reasons": reasons,
    }
    save_json(_path(root), report)
    return report
