# tools/forgetastic/state_engine.py

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from .common import load_json, save_json, utc_now_iso, get_logger
from .evidence_engine import build_evidence_index
from .override_engine import active_overrides

log = get_logger("state")

STATE_PATH = Path("forge/state/STATE.json")
SESSION_LOG_PATH = Path("forge/state/SESSION_LOG.jsonl")
ENFORCEMENT_REPORT_PATH = Path("forge/reports/ENFORCEMENT_REPORT.json")
DRIFT_REPORT_PATH = Path("forge/reports/DRIFT_REPORT.json")
DONE_GATE_REPORT_PATH = Path("forge/reports/DONE_GATE.json")
DEPLOYMENT_GATE_REPORT_PATH = Path("forge/reports/DEPLOYMENT_GATE.json")
PROSECUTION_RESULTS_A_PATH = Path("forge/prosecution/PROSECUTION_RESULTS_A.json")
PROSECUTION_RESULTS_B_PATH = Path("forge/prosecution/PROSECUTION_RESULTS_B.json")
PROSECUTION_COMPARISON_PATH = Path("forge/prosecution/PROSECUTION_COMPARISON.json")
ARBITRATION_RESULT_PATH = Path("forge/prosecution/ARBITRATION_RESULT.json")

DERIVED_KEYS = frozenset({
    "runtime_proof_ready",
    "manifest_lint_pass",
    "enforcement_pass",
    "drift_pass",
    "integrity_pass",
    "truth_pass",
    "audit_pass",
    "prosecution_ready",
    "prosecution_status",
    "arbitration_status",
    "done_gate_pass",
    "deployment_gate_pass",
    "project_complete",
    "active_overrides",
    "stale_proof_count",
    "critical_open_count",
    "major_open_count",
    "locked",
})


def load_state(root: Path) -> dict[str, Any]:
    """Load state file. Return default if missing."""
    state_path = root / STATE_PATH
    return load_json(state_path, default=default_state())


def default_state() -> dict[str, Any]:
    """Default state when none exists."""
    return {
        "project_id": str(uuid4()),
        "project_stage": "DECLARATION",
        "mode": "STANDARD",
        "manifest_locked": False,
        "operator_approved": False,
        "last_check_utc": utc_now_iso(),
        "next_legal_action": "manifest-lint",
        "generated_utc": utc_now_iso(),
    }


def update_state(root: Path, updates: dict[str, Any]) -> None:
    """
    Merge updates into state and save atomically.

    IMPORTANT: Only CLI commands should call this.
    """
    state = load_state(root)
    for key, value in updates.items():
        if key in DERIVED_KEYS:
            continue
        state[key] = value
    state["generated_utc"] = utc_now_iso()

    state_path = root / STATE_PATH
    state_path.parent.mkdir(parents=True, exist_ok=True)
    save_json(state_path, state)

    log.info(f"State updated: {updates}")


def append_session_log(root: Path, entry: dict[str, Any]) -> None:
    """Append an operator/session event with hash-chain continuity.

    Older builds wrote plain JSONL rows. New rows include previous_hash so
    integrity verification can prove continuity from the preceding row.
    """
    log_path = root / SESSION_LOG_PATH
    log_path.parent.mkdir(parents=True, exist_ok=True)

    previous_hash = None
    if log_path.exists():
        valid_rows = []
        with log_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    valid_rows.append(json.loads(line))
                except json.JSONDecodeError:
                    # Leave corruption for integrity_engine to catch; do not hide it here.
                    valid_rows = []
                    break
        if valid_rows:
            from .common import sha256_dict
            previous_hash = sha256_dict(valid_rows[-1])

    row = dict(entry)
    row["timestamp_utc"] = utc_now_iso()
    row["previous_hash"] = previous_hash
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _severity_map(manifest: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id")
            if item_id:
                out[item_id] = str(item.get("severity", "MINOR")).upper()
    return out


def derive_state(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """BUILD 11: Derive workflow fields from manifest and forge artifacts."""
    state = dict(load_state(root))

    lock_exists = (root / "forge/final/LOCK").exists()
    state["locked"] = lock_exists
    state["manifest_locked"] = bool(manifest.get("manifest_locked", False))
    state["operator_approved"] = bool(manifest.get("operator_approved", False))
    state["mode"] = manifest.get("mode", "STANDARD")

    evidence_index = build_evidence_index(root, manifest)
    manifest_lint = load_json(root / "forge/reports/MANIFEST_LINT_REPORT.json", default={}) or {}
    enforcement = load_json(root / ENFORCEMENT_REPORT_PATH, default={}) or {}
    drift = load_json(root / DRIFT_REPORT_PATH, default={}) or {}
    done_gate = load_json(root / DONE_GATE_REPORT_PATH, default={}) or {}
    integrity = load_json(root / "forge/reports/INTEGRITY_REPORT.json", default={}) or {}
    truth = load_json(root / "forge/reports/TRUTH_REPORT.json", default={}) or {}
    audit = load_json(root / "forge/reports/AUDIT_REPORT.json", default={}) or {}
    deployment_gate = load_json(root / DEPLOYMENT_GATE_REPORT_PATH, default={}) or {}

    prosecution_a = load_json(root / PROSECUTION_RESULTS_A_PATH, default={}) or {}
    prosecution_b = load_json(root / PROSECUTION_RESULTS_B_PATH, default={}) or {}
    prosecution_comparison = load_json(root / PROSECUTION_COMPARISON_PATH, default={}) or {}
    arbitration = load_json(root / ARBITRATION_RESULT_PATH, default={}) or {}

    missing_req = evidence_index.get("missing_required_ids", []) or []
    state["runtime_proof_ready"] = len(missing_req) == 0
    state["manifest_lint_pass"] = manifest_lint.get("verdict") == "PASS"
    state["enforcement_pass"] = enforcement.get("verdict") == "PASS"
    state["drift_pass"] = drift.get("verdict") == "PASS"
    state["done_gate_pass"] = done_gate.get("verdict") == "PASS"
    state["integrity_pass"] = integrity.get("verdict") == "PASS"
    state["truth_pass"] = truth.get("verdict") == "PASS"
    state["audit_pass"] = audit.get("system_verdict") == "PASS"
    state["deployment_gate_pass"] = deployment_gate.get("verdict") == "PASS"

    overrides = active_overrides(root)
    state["active_overrides"] = len(overrides)

    if prosecution_comparison:
        if prosecution_comparison.get("verdict") == "PASS":
            state["prosecution_status"] = "PASS"
        else:
            state["prosecution_status"] = "DISPUTED"
    elif prosecution_a or prosecution_b:
        state["prosecution_status"] = "PARTIAL"
    else:
        state["prosecution_status"] = "NOT_STARTED"

    arbitration_complete = bool(arbitration.get("results"))
    if arbitration_complete:
        state["arbitration_status"] = "COMPLETE"
    elif state["prosecution_status"] == "DISPUTED":
        state["arbitration_status"] = "REQUIRED"
    else:
        state["arbitration_status"] = "NOT_STARTED"

    # A project is only complete when every release-critical gate has passed.
    # Earlier builds allowed finalize after done/deployment/prosecution only,
    # which could lock a project that would immediately fail release-gate.
    state["project_complete"] = bool(
        state["done_gate_pass"]
        and state["deployment_gate_pass"]
        and state["integrity_pass"]
        and state["truth_pass"]
        and state["audit_pass"]
        and len(overrides) == 0
        and state["prosecution_status"] == "PASS"
        and arbitration_complete
        and not lock_exists
    )

    state["prosecution_ready"] = bool(
        state["manifest_locked"]
        and state["runtime_proof_ready"]
        and state["enforcement_pass"]
        and state["drift_pass"]
    )

    severity_map = _severity_map(manifest)
    by_manifest_id = evidence_index.get("by_manifest_id", {}) or {}
    state["critical_open_count"] = 0
    state["major_open_count"] = 0
    for manifest_id, severity in severity_map.items():
        latest_status = (by_manifest_id.get(manifest_id, {}) or {}).get("latest_status")
        if severity == "CRITICAL" and latest_status != "PASS":
            state["critical_open_count"] += 1
        if severity == "MAJOR" and latest_status != "PASS":
            state["major_open_count"] += 1

    state["stale_proof_count"] = int((drift.get("summary", {}) or {}).get("stale_proof_count", 0))

    if lock_exists:
        state["project_stage"] = "LOCKED"
        state["next_legal_action"] = "none"
    elif not state.get("manifest_locked"):
        state["project_stage"] = "DECLARATION"
        state["next_legal_action"] = "edit_manifest"
    elif not state["runtime_proof_ready"]:
        state["project_stage"] = "EVIDENCE"
        state["next_legal_action"] = "record_runtime_proof"
    elif not state["enforcement_pass"] or not state["drift_pass"]:
        state["project_stage"] = "ENFORCEMENT"
        state["next_legal_action"] = "resolve_enforcement_and_drift"
    elif state["prosecution_ready"] and state["prosecution_status"] == "NOT_STARTED":
        state["project_stage"] = "PROSECUTION"
        state["next_legal_action"] = "generate_prosecution_bundle"
    elif state["prosecution_status"] == "PARTIAL":
        state["project_stage"] = "PROSECUTION"
        state["next_legal_action"] = "import_missing_prosecution_results"
    elif state["prosecution_status"] == "DISPUTED":
        state["project_stage"] = "ARBITRATION"
        state["next_legal_action"] = "resolve_prosecution_disputes"
    elif not state["done_gate_pass"]:
        state["project_stage"] = "DONE_GATE"
        state["next_legal_action"] = "run_done_gate"
    elif not state["deployment_gate_pass"]:
        state["project_stage"] = "DEPLOYMENT"
        state["next_legal_action"] = "verify_live_deployment"
    elif not state["integrity_pass"]:
        state["project_stage"] = "INTEGRITY"
        state["next_legal_action"] = "run_integrity"
    elif not state["truth_pass"]:
        state["project_stage"] = "TRUTH"
        state["next_legal_action"] = "run_truth"
    elif not state["audit_pass"]:
        state["project_stage"] = "AUDIT"
        state["next_legal_action"] = "run_audit"
    elif state["project_complete"]:
        state["project_stage"] = "FINALIZING"
        state["next_legal_action"] = "finalize_project"
    else:
        state["project_stage"] = "CONSTRUCTION"
        state["next_legal_action"] = "build_against_manifest"

    state["last_check_utc"] = utc_now_iso()
    state["generated_utc"] = utc_now_iso()

    return state


def recompute_and_save(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    new_state = derive_state(root, manifest)
    state_path = root / STATE_PATH
    state_path.parent.mkdir(parents=True, exist_ok=True)
    save_json(state_path, new_state)
    return new_state


def guarded_state_update(root: Path, updates: dict[str, Any]) -> None:
    state = load_state(root)
    for key, value in updates.items():
        if key in DERIVED_KEYS:
            continue
        state[key] = value
    state["last_status_utc"] = utc_now_iso()
    save_json(root / STATE_PATH, state)
