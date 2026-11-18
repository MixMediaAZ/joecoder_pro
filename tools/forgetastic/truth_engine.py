# tools/forgetastic/truth_engine.py (BUILD 13 — Truth Enforcement Layer)

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .common import load_json, save_json, utc_now_iso, sha256_dict, get_logger
from .evidence_engine import proof_age_days, read_runtime_proof_rows, auto_prove_from_beta_test
from .ledger_engine import verify_event_chain
from .beta_engine import load_beta_config, run_determinism_test, generate_proof_record
from .regression_detector import load_baseline, save_baseline, detect_regressions
from .beta_reporter import generate_json_report, generate_html_report

log = get_logger("truth")


def _run_determinism_check(root: Path) -> dict[str, Any]:
    """
    Run enforcement, drift, done_gate, deployment_gate, integrity in sequence determinism_runs times.
    Compare verdicts and verdict hashes across runs. Fail if signatures diverge.
    Returns dict with verdict, signature_hashes, and issues.
    """
    from .enforcement_engine import run_enforcement
    from .drift_engine import run_drift
    from .done_gate_engine import run_done_gate
    from .production_engine import run_deployment_gate
    from .integrity_engine import run_integrity

    policy = load_json(root / "forge/policy/POLICY.json", default={}) or {}
    manifest = load_json(root / "forge/manifest/MANIFEST.json", default={}) or {}

    determinism_runs = int(policy.get("truth_policy", {}).get("determinism_runs", 3))
    if determinism_runs < 1:
        determinism_runs = 3

    run_signatures: list[dict[str, Any]] = []
    issues: list[str] = []

    for run_num in range(1, determinism_runs + 1):
        # Run all engines in sequence
        enforcement = run_enforcement(root, manifest, policy)
        drift = run_drift(root, manifest, policy)
        done = run_done_gate(root, manifest, policy)
        deployment = run_deployment_gate(root)
        integrity = run_integrity(root)

        # Capture verdict signature for this run
        sig = {
            "run": run_num,
            "enforcement_verdict": enforcement.get("verdict"),
            "drift_verdict": drift.get("verdict"),
            "done_gate_verdict": done.get("verdict"),
            "deployment_gate_verdict": deployment.get("verdict"),
            "integrity_verdict": integrity.get("verdict"),
            "hash": sha256_dict({
                "enforcement": enforcement.get("verdict"),
                "drift": drift.get("verdict"),
                "done_gate": done.get("verdict"),
                "deployment_gate": deployment.get("verdict"),
                "integrity": integrity.get("verdict"),
            }),
        }
        run_signatures.append(sig)

    # Compare signatures across all runs
    if len(run_signatures) > 1:
        first_hash = run_signatures[0]["hash"]
        for sig in run_signatures[1:]:
            if sig["hash"] != first_hash:
                issues.append(
                    f"Determinism violation: Run {sig['run']} hash {sig['hash'][:8]}... "
                    f"!= Run 1 hash {first_hash[:8]}..."
                )

    return {
        "determinism_runs": len(run_signatures),
        "signature_hashes": run_signatures,
        "verdict": "PASS" if not issues else "FAIL",
        "issues": issues,
    }


TRUTH_REPORT_PATH = Path("forge/reports/TRUTH_REPORT.json")


@dataclass(frozen=True)
class TruthPolicy:
    max_override_count: int = 3
    required_proof_tier_default: int = 3
    required_proof_tier_critical: int = 4
    proof_ttl_hours_default: int = 24
    proof_ttl_hours_critical: int = 12
    require_prosecutor_a: bool = True
    require_prosecutor_b: bool = True
    require_arbitration_if_disputed: bool = True
    determinism_runs: int = 3


def _path(root: Path) -> Path:
    return root / TRUTH_REPORT_PATH


def _load_policy_overrides(root: Path) -> dict[str, Any]:
    policy = load_json(root / "forge/policy/POLICY.json", default={}) or {}
    return policy.get("truth_policy", {}) or {}


def _truth_bool(raw: dict[str, Any], key: str, default: bool) -> bool:
    v = raw.get(key, default)
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes", "on")
    return bool(v) if v is not None else default


def get_truth_policy(root: Path) -> TruthPolicy:
    raw = _load_policy_overrides(root)
    return TruthPolicy(
        max_override_count=int(raw.get("max_override_count", 3)),
        required_proof_tier_default=int(raw.get("required_proof_tier_default", 3)),
        required_proof_tier_critical=int(raw.get("required_proof_tier_critical", 4)),
        proof_ttl_hours_default=int(raw.get("proof_ttl_hours_default", 24)),
        proof_ttl_hours_critical=int(raw.get("proof_ttl_hours_critical", 12)),
        require_prosecutor_a=_truth_bool(raw, "require_prosecutor_a", True),
        require_prosecutor_b=_truth_bool(raw, "require_prosecutor_b", True),
        require_arbitration_if_disputed=_truth_bool(raw, "require_arbitration_if_disputed", True),
        determinism_runs=int(raw.get("determinism_runs", 3)),
    )


def _severity_map(manifest: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id")
            if item_id:
                out[item_id] = str(item.get("severity", "MINOR")).upper()
    return out


def has_prosecution_results(payload: dict[str, Any]) -> bool:
    r = payload.get("results")
    return isinstance(r, list) and len(r) > 0


def _required_ids(manifest: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            if item.get("id") and bool(item.get("required", True)):
                ids.add(item["id"])
    return ids


def _proof_tier(row: dict[str, Any], root: Path) -> int:
    """
    Determine proof confidence tier (1-5) based on evidence content validation (fail-closed).

    Tiers:
    1: Minimum proof (has manifest_id)
    2: Has command
    3: Has artifact_paths list
    4: Artifacts exist, are non-empty, match hashes, and have valid schema
    5: PROD environment + PASS status (highest confidence)

    Tier is dropped (e.g., 4 → 2) if artifact validation fails (fail-closed).
    """
    if not row:
        return 0
    tier = 1
    artifacts = row.get("artifact_paths") or []
    artifact_hashes = row.get("artifact_hashes") or []
    if row.get("command"):
        tier = 2
    if artifacts:
        tier = 3
        # Validate all artifacts: existence, non-empty, hash matching, schema
        all_valid = True
        for idx, artifact_path in enumerate(artifacts):
            expected_hash = artifact_hashes[idx] if idx < len(artifact_hashes) else None
            from .evidence_engine import _validate_artifact_content
            is_valid, error_msg = _validate_artifact_content(root, artifact_path, expected_hash)
            if not is_valid:
                log.warning(f"Artifact validation failed for {artifact_path}: {error_msg}")
                all_valid = False
                break

        if all_valid:
            tier = 4
    if row.get("environment") == "PROD" and row.get("status") == "PASS":
        tier = 5
    return tier


def _latest_proof_by_id(root: Path) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in read_runtime_proof_rows(root):
        manifest_id = row.get("manifest_id")
        if manifest_id:
            latest[manifest_id] = row
    return latest


def _cross_consistency(
    manifest: dict[str, Any], structure: dict[str, Any], evidence_index: dict[str, Any]
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []

    manifest_ids: set[str] = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            if item.get("id"):
                manifest_ids.add(item["id"])

    structure_ids: set[str] = set()
    for entry in structure.get("entries", []) or []:
        mid = entry.get("manifest_id")
        if mid:
            structure_ids.add(mid)

    evidence_ids = set((evidence_index.get("by_manifest_id", {}) or {}).keys())

    for mid in sorted(structure_ids - manifest_ids):
        issues.append({"id": mid, "message": "STRUCTURE references undeclared manifest ID"})
    for mid in sorted(evidence_ids - manifest_ids):
        issues.append({"id": mid, "message": "EVIDENCE references undeclared manifest ID"})

    return issues


def _invariant_checks(
    state: dict[str, Any],
    done_gate: dict[str, Any],
    enforcement: dict[str, Any],
    audit: dict[str, Any],
    evidence_index: dict[str, Any],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    missing_required = len(evidence_index.get("missing_required_ids", []) or [])

    if done_gate.get("verdict") == "PASS" and missing_required != 0:
        issues.append({"id": "INVARIANT", "message": "DONE_GATE PASS with missing required proofs"})
    if enforcement.get("verdict") == "PASS" and len(enforcement.get("blocking_items", []) or []) != 0:
        issues.append({"id": "INVARIANT", "message": "ENFORCEMENT PASS with blocking items present"})
    if audit.get("system_verdict") == "PASS":
        for key in ("enforcement_pass", "drift_pass", "done_gate_pass", "deployment_gate_pass"):
            if not state.get(key):
                issues.append({"id": "INVARIANT", "message": f"AUDIT PASS while state.{key} is false"})
    return issues


def _run_beta_tests(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """
    Run functional beta tests and generate proof records.

    If BETA.json is configured, runs test suites with determinism checks.
    Generates proof records for each manifest ID.
    Detects regressions against baseline.

    Returns dict with beta test results and any blocking issues.
    """
    beta_config = load_beta_config(root)
    if not beta_config:
        # No beta config = no tests required
        return {
            "verdict": "PASS",
            "reason": "No BETA.json configuration",
            "beta_tests_run": False,
        }

    required_ids = _required_ids(manifest)
    if not required_ids:
        return {
            "verdict": "PASS",
            "reason": "No required behaviors to test",
            "beta_tests_run": False,
        }

    # Run determinism tests
    determinism_result = run_determinism_test(root, beta_config)

    blocking_items: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # Check determinism verdict
    is_deterministic = determinism_result.get("verdict") == "PASS"
    if not is_deterministic:
        blocking_items.append({
            "id": "BETA_DETERMINISM",
            "message": f"Beta test determinism failed: {determinism_result.get('issues', ['Unknown'])[0]}",
        })

    # Generate proof records for each behavior
    proof_records: list[dict[str, Any]] = []
    for manifest_id in sorted(required_ids):
        # Use most recent run as proof
        current_result = determinism_result.get("runs", [{}])[-1]

        # Check for regressions
        baseline = load_baseline(root, manifest_id)
        regression = detect_regressions(current_result, baseline, thresholds={
            "coverage_drop_percent": 5.0,
            "test_count_drop": 0,
            "failure_increase": 0,
            "time_increase_percent": 20.0,
        })

        if regression.verdict == "FAIL":
            warnings.append({
                "id": manifest_id,
                "message": f"Regression detected: {regression.issues[0] if regression.issues else 'Unknown'}",
            })

        # Auto-generate proof from test execution (CI-driven)
        # This creates cryptographically-bound proof entries in RUNTIME_PROOF.jsonl
        if is_deterministic:
            auto_proof_result = auto_prove_from_beta_test(root, manifest_id, current_result, determinism_result)
            if auto_proof_result.get("status") != "SUCCESS":
                log.warning(f"Auto-proof generation failed for {manifest_id}: {auto_proof_result.get('error')}")
                blocking_items.append({
                    "id": f"AUTO_PROVE_{manifest_id}",
                    "message": f"Failed to generate proof for {manifest_id}: {auto_proof_result.get('error')}",
                })

        # Generate proof record for return (backward compatibility)
        proof = generate_proof_record(root, current_result, manifest_id)
        proof_records.append(proof)

        # Generate reports
        generate_json_report(current_result, manifest_id, root)
        generate_html_report(current_result, {
            "verdict": regression.verdict,
            "issues": regression.issues,
            "changes": regression.changes,
        }, manifest_id, root)

        # Save baseline if current run is good
        if current_result.get("verdict") == "PASS":
            save_baseline(root, manifest_id, current_result)

    return {
        "verdict": "FAIL" if blocking_items else "PASS",
        "beta_tests_run": True,
        "determinism_runs": determinism_result.get("determinism_runs", 0),
        "determinism_verdict": determinism_result.get("verdict"),
        "proof_records": proof_records,
        "blocking_items": blocking_items,
        "warnings": warnings,
    }


def _determinism_signature(root: Path) -> dict[str, Any]:
    state = load_json(root / "forge/state/STATE.json", default={}) or {}
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    done_gate = load_json(root / "forge/reports/DONE_GATE.json", default={}) or {}
    deployment_gate = load_json(root / "forge/reports/DEPLOYMENT_GATE.json", default={}) or {}
    integrity = load_json(root / "forge/reports/INTEGRITY_REPORT.json", default={}) or {}

    return {
        "state_stage": state.get("project_stage"),
        "state_next": state.get("next_legal_action"),
        "enforcement": enforcement.get("verdict"),
        "drift": drift.get("verdict"),
        "done_gate": done_gate.get("verdict"),
        "deployment_gate": deployment_gate.get("verdict"),
        "integrity": integrity.get("verdict"),
    }


def run_truth(root: Path) -> dict[str, Any]:
    policy = get_truth_policy(root)
    manifest = load_json(root / "forge/manifest/MANIFEST.json", default={}) or {}
    policy_json = load_json(root / "forge/policy/POLICY.json", default={}) or {}
    policy_hash = sha256_dict(policy_json) if policy_json else None
    structure = load_json(root / "forge/structure/STRUCTURE.json", default={}) or {}
    evidence_index = load_json(root / "forge/evidence/EVIDENCE_INDEX.json", default={}) or {}
    state = load_json(root / "forge/state/STATE.json", default={}) or {}
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    done_gate = load_json(root / "forge/reports/DONE_GATE.json", default={}) or {}
    audit = load_json(root / "forge/reports/AUDIT_REPORT.json", default={}) or {}
    prosecution_a = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_A.json", default={}) or {}
    prosecution_b = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_B.json", default={}) or {}
    prosecution_cmp = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}
    arbitration = load_json(root / "forge/prosecution/ARBITRATION_RESULT.json", default={}) or {}

    blocking_items: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # Read overrides with strict validation (fail-closed on malformed JSON)
    from .override_engine import read_overrides as read_overrides_from_engine
    try:
        override_rows = read_overrides_from_engine(root)
    except ValueError as e:
        # Malformed override JSON blocks truth gate
        blocking_items.append({"id": "OVERRIDES", "message": f"Override file validation failed: {str(e)}"})
        override_rows = []

    # Run beta tests first (actual functional testing)
    beta_result = _run_beta_tests(root, manifest)
    if beta_result.get("beta_tests_run"):
        blocking_items.extend(beta_result.get("blocking_items", []))
        warnings.extend(beta_result.get("warnings", []))

    # Run determinism check
    determinism_result = _run_determinism_check(root)
    if determinism_result.get("verdict") != "PASS":
        for issue in determinism_result.get("issues", []):
            blocking_items.append({"id": "DETERMINISM", "message": issue})

    if not manifest.get("manifest_locked"):
        blocking_items.append({"id": "MANIFEST_LOCK", "message": "Manifest must be locked before truth validation"})

    required_ids = _required_ids(manifest)
    severity_map = _severity_map(manifest)
    try:
        latest_proofs = _latest_proof_by_id(root)
    except ValueError as e:
        # Proof chain integrity failure blocks truth gate (fail-closed)
        blocking_items.append({"id": "PROOF_CHAIN", "message": f"Proof chain integrity check failed: {str(e)}"})
        latest_proofs = {}

    if policy.require_prosecutor_a and not has_prosecution_results(prosecution_a):
        blocking_items.append({"id": "PROSECUTION_A", "message": "Prosecutor A results required"})
    if policy.require_prosecutor_b and not has_prosecution_results(prosecution_b):
        blocking_items.append({"id": "PROSECUTION_B", "message": "Prosecutor B results required"})
    disputes = prosecution_cmp.get("disagreements") or []
    if (
        policy.require_arbitration_if_disputed
        and isinstance(disputes, list)
        and len(disputes) > 0
        and not arbitration.get("results")
    ):
        blocking_items.append(
            {"id": "ARBITRATION", "message": "Arbitration required when prosecution prosecutors disagree"}
        )

    active_overrides = [r for r in override_rows if r.get("status") == "ACTIVE"]
    if len(active_overrides) > policy.max_override_count:
        blocking_items.append(
            {
                "id": "OVERRIDES",
                "message": f"Active overrides exceed max_override_count ({policy.max_override_count})",
            }
        )

    for mid in sorted(required_ids):
        latest = latest_proofs.get(mid)
        if not latest:
            blocking_items.append({"id": mid, "message": "Required manifest item has no proof"})
            continue

        severity = severity_map.get(mid, "MINOR")
        needed_tier = (
            policy.required_proof_tier_critical
            if severity == "CRITICAL"
            else policy.required_proof_tier_default
        )
        actual_tier = _proof_tier(latest, root)
        if actual_tier < needed_tier:
            blocking_items.append(
                {"id": mid, "message": f"Proof tier too low: have {actual_tier}, need {needed_tier}"}
            )

        age_days = proof_age_days(latest.get("timestamp_utc"))
        ttl_hours = policy.proof_ttl_hours_critical if severity == "CRITICAL" else policy.proof_ttl_hours_default
        if age_days is not None and age_days * 24 > ttl_hours:
            blocking_items.append(
                {"id": mid, "message": f"Proof stale: {age_days * 24:.2f}h > ttl {ttl_hours}h"}
            )

    blocking_items.extend(_cross_consistency(manifest, structure, evidence_index))

    blocking_items.extend(_invariant_checks(state, done_gate, enforcement, audit, evidence_index))

    event_chain = verify_event_chain(root)
    if event_chain.get("verdict") != "PASS":
        blocking_items.append(
            {
                "id": "EVENT_CHAIN",
                "message": str(event_chain.get("message", "Event chain verification failed")),
            }
        )

    signature = _determinism_signature(root)

    report: dict[str, Any] = {
        "report_name": "TRUTH_REPORT",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest),
        "policy_hash": policy_hash,
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "summary": {
            "required_manifest_count": len(required_ids),
            "active_override_count": len(active_overrides),
            "beta_tests_run": beta_result.get("beta_tests_run", False),
            "beta_tests_verdict": beta_result.get("verdict"),
            "determinism_runs_configured": policy.determinism_runs,
            "determinism_runs_executed": determinism_result.get("determinism_runs", 0),
            "determinism_verdict": determinism_result.get("verdict"),
            "determinism_signature_hashes": determinism_result.get("signature_hashes", []),
            "determinism_signature": signature,
        },
    }
    save_json(_path(root), report)
    return report
