from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .common import ensure_directory, get_logger, load_json, save_json, utc_now_iso
from .manifest_lint import lint_manifest, load_manifest, save_manifest, render_manifest_markdown
from .state_engine import append_session_log, derive_state, recompute_and_save
from .structure_engine import build_structure, save_structure
from .evidence_engine import create_proof_entry, append_proof, build_evidence_index
from .enforcement_engine import run_enforcement
from .drift_engine import run_drift
from .policy_defaults import default_policy
from .done_gate_engine import run_done_gate
from .override_engine import create_override, active_overrides
from .arbitration_engine import (
    build_arbitration_input,
    import_arbitration_result,
    validate_arbitration_result,
)
from .finalization_engine import build_final_snapshot, lock_project
from .production_engine import ensure_production_config, run_deployment_gate, save_production_config
from .artifact_verifier import verify_artifacts
from .prosecution_engine import (
    build_prosecution_bundle,
    compare_prosecution_results,
    import_prosecution_results,
    validate_prosecution_results,
)
from .truth_engine import run_truth
from .ledger_engine import record_standard_event
from .integrity_engine import run_integrity
from .audit_engine import run_audit
from .release_gate_engine import run_release_gate

log = get_logger("cli")

PROOF_TYPES = ["MANUAL", "CLI", "TEST", "API", "UI", "INTEGRATION", "BETA_TEST"]
ENVIRONMENTS = ["LOCAL", "DEV", "STAGING", "PROD", "ANY"]

REQUIRED_DIRECTORIES = [
    "forge/policy",
    "forge/state",
    "forge/manifest",
    "forge/structure",
    "forge/evidence",
    "forge/prosecution",
    "forge/reports",
    "forge/overrides",
    "forge/glossary",
    "forge/final",
    ".claude/rules",
    ".claude/commands",
    "scripts",
    ".githooks",
    "deployment",
    "forge/ledger",
]


def find_project_root() -> Path:
    """Resolve project root: prefer `.git`, else a directory containing this CLI package (release zip)."""
    start = Path.cwd().resolve()
    for candidate in [start, *start.parents]:
        if (candidate / ".git").exists():
            return candidate
        if (candidate / "tools" / "forgetastic" / "cli.py").exists():
            return candidate
    raise RuntimeError(
        "Cannot find project root (no .git and no tools/forgetastic/cli.py)."
    )


def get_policy(root: Path) -> dict:
    return load_json(root / "forge" / "policy" / "POLICY.json", default={}) or {}


def get_structure(root: Path) -> dict:
    return load_json(root / "forge" / "structure" / "STRUCTURE.json", default={}) or {}


def merge_policy_defaults(root: Path) -> None:
    """Merge missing top-level keys from default_policy() into POLICY.json (BUILD 13)."""
    path = root / "forge" / "policy" / "POLICY.json"
    existing = load_json(path, default={}) or {}
    base = default_policy()
    out = dict(existing)
    for k, v in base.items():
        if k not in out:
            out[k] = v
    save_json(path, out)


def default_version() -> dict[str, Any]:
    """Binding release intent for forge/VERSION.json (merge missing keys on init)."""
    return {
        "version": "1.0.0-rc0",
        "release_intent": "frozen_validation",
        "schema_locked": True,
    }


def merge_version_defaults(root: Path) -> None:
    path = root / "forge" / "VERSION.json"
    existing = load_json(path, default={}) or {}
    base = default_version()
    out = dict(existing)
    for k, v in base.items():
        if k not in out:
            out[k] = v
    ensure_directory(path.parent)
    save_json(path, out)


def _recompute_if_manifest(root: Path) -> None:
    m = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if m is not None:
        recompute_and_save(root, m)


def init_command(root: Path) -> int:
    """Initialize project structure."""
    log.info(f"Initializing project at {root}")

    for dir_name in REQUIRED_DIRECTORIES:
        dir_path = root / dir_name
        ensure_directory(dir_path)
        log.debug(f"Created {dir_path}")

    merge_policy_defaults(root)
    merge_version_defaults(root)
    ensure_production_config(root)
    (root / "forge" / "state" / "SESSION_LOG.jsonl").touch(exist_ok=True)

    log.info("Project structure initialized")
    return 0


def status_command(root: Path) -> int:
    """Show current state (BUILD 11: derived workflow fields)."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    state = recompute_and_save(root, manifest)

    print("STATUS")
    print(f"project_stage: {state.get('project_stage', 'UNKNOWN')}")
    print(f"next_legal_action: {state.get('next_legal_action', 'UNKNOWN')}")
    print(f"manifest_locked: {state.get('manifest_locked', False)}")
    print(f"operator_approved: {state.get('operator_approved', False)}")
    print(f"runtime_proof_ready: {state.get('runtime_proof_ready', False)}")
    print(f"enforcement_pass: {state.get('enforcement_pass', False)}")
    print(f"drift_pass: {state.get('drift_pass', False)}")
    print(f"done_gate_pass: {state.get('done_gate_pass', False)}")
    print(f"deployment_gate_pass: {state.get('deployment_gate_pass', False)}")
    print(f"prosecution_status: {state.get('prosecution_status', 'UNKNOWN')}")
    print(f"arbitration_status: {state.get('arbitration_status', 'UNKNOWN')}")
    print(f"project_complete: {state.get('project_complete', False)}")
    print(f"active_overrides: {state.get('active_overrides', 0)}")
    append_session_log(root, {"event": "status"})
    return 0


def doctor_command(root: Path) -> int:
    """Run project health check."""
    log.info(f"Health check at {root}")
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    state = derive_state(root, manifest)
    enforcement = load_json(root / "forge" / "reports" / "ENFORCEMENT_REPORT.json", default={}) or {}
    drift = load_json(root / "forge" / "reports" / "DRIFT_REPORT.json", default={}) or {}
    done_gate = load_json(root / "forge" / "reports" / "DONE_GATE.json", default={}) or {}
    issues: list[str] = []
    if enforcement.get("verdict") == "FAIL":
        issues.append("Enforcement is failing")
    if drift.get("verdict") == "FAIL":
        issues.append("Drift is failing")
    if done_gate.get("verdict") == "FAIL":
        issues.append("Done gate is failing")
    if not state.get("runtime_proof_ready"):
        issues.append("Required runtime proofs missing")
    print("DOCTOR")
    if issues:
        for i in issues:
            print(f"ISSUE: {i}")
        return 1
    print("OK — no blocking issues detected by doctor")
    return 0


def report_status_command(root: Path) -> int:
    """Show report presence, verdicts, manifest-hash freshness, and dependency age."""
    from .common import sha256_dict

    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json") or {}
    current_manifest_hash = sha256_dict(manifest) if manifest else None

    reports = [
        ("manifest_lint", "forge/reports/MANIFEST_LINT_REPORT.json"),
        ("enforcement", "forge/reports/ENFORCEMENT_REPORT.json"),
        ("drift", "forge/reports/DRIFT_REPORT.json"),
        ("done_gate", "forge/reports/DONE_GATE.json"),
        ("deployment_gate", "forge/reports/DEPLOYMENT_GATE.json"),
        ("integrity", "forge/reports/INTEGRITY_REPORT.json"),
        ("truth", "forge/reports/TRUTH_REPORT.json"),
        ("audit", "forge/reports/AUDIT_REPORT.json"),
        ("release_gate", "forge/reports/RELEASE_GATE_REPORT.json"),
    ]
    report_map = {name: (load_json(root / path, default={}) or {}) for name, path in reports}

    dependencies = {
        "done_gate": ["enforcement", "drift"],
        "deployment_gate": ["done_gate"],
        "truth": ["enforcement", "drift", "done_gate", "deployment_gate", "integrity"],
        "audit": ["manifest_lint", "enforcement", "drift", "done_gate", "deployment_gate", "integrity", "truth"],
        "release_gate": ["audit", "truth", "integrity", "deployment_gate"],
    }

    def ts(name: str) -> str | None:
        value = report_map.get(name, {}).get("generated_utc")
        return value if isinstance(value, str) else None

    print("REPORT STATUS")
    any_problem = False
    for name, _path in reports:
        report = report_map[name]
        timestamp = report.get("generated_utc")
        verdict = report.get("verdict") or report.get("system_verdict")
        report_hash = report.get("manifest_hash")

        if timestamp is None:
            status = "MISSING"
            any_problem = True
        elif current_manifest_hash and report_hash and report_hash != current_manifest_hash:
            status = "STALE"
            any_problem = True
        elif name == "audit" and current_manifest_hash:
            hashes = report.get("manifest_hashes") or {}
            if hashes and any(h and h != current_manifest_hash for h in hashes.values()):
                status = "STALE"
                any_problem = True
            else:
                status = "OK"
        else:
            status = "OK"

        newer_deps = [dep for dep in dependencies.get(name, []) if ts(dep) and timestamp and ts(dep) > timestamp]
        if newer_deps:
            status = "OUTDATED"
            any_problem = True

        verdict_str = f"({verdict})" if verdict else "(no verdict)"
        hash_note = f" hash={report_hash[:8]}" if report_hash else ""
        dep_note = f" newer_than={','.join(newer_deps)}" if newer_deps else ""
        print(f"  {name:20s} {status:10s} {verdict_str:15s} {timestamp or 'N/A'}{hash_note}{dep_note}")

    if any_problem:
        print("\nMISSING/STALE/OUTDATED reports must be regenerated before release decisions are trusted.")
        return 1
    return 0


def validate_order_command(root: Path) -> int:
    """Validate workflow order: checks that prerequisites are met before proceeding."""
    issues: list[str] = []
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")

    # Step 1-4: Manifest setup
    if manifest is None:
        issues.append("Manifest not initialized (run init first)")
    else:
        if not manifest.get("project"):
            issues.append("Manifest: project field missing (run interview)")
        if not manifest.get("manifest_locked"):
            issues.append("Manifest not locked (run manifest-lint, then lock-manifest)")

    # Step 5: Structure
    structure = load_json(root / "forge" / "structure" / "STRUCTURE.json", default={}) or {}
    if not structure.get("entries"):
        issues.append("Structure not built (run structure command)")

    # Step 6: Prove
    proof_jsonl = root / "forge" / "evidence" / "RUNTIME_PROOF.jsonl"
    if not proof_jsonl.exists() or proof_jsonl.stat().st_size == 0:
        issues.append("No proofs recorded yet (run prove to add runtime proof)")

    # Step 7-9: Gates
    enforcement = load_json(root / "forge/reports/ENFORCEMENT_REPORT.json", default={}) or {}
    if enforcement.get("verdict") is None:
        issues.append("Enforcement not run (run enforce)")
    elif enforcement.get("verdict") == "FAIL":
        issues.append("Enforcement FAILED (fix issues, then re-run enforce)")

    drift = load_json(root / "forge/reports/DRIFT_REPORT.json", default={}) or {}
    if drift.get("verdict") is None:
        issues.append("Drift not run (run drift)")
    elif drift.get("verdict") == "FAIL":
        issues.append("Drift FAILED (fix issues, then re-run drift)")

    done_gate = load_json(root / "forge/reports/DONE_GATE.json", default={}) or {}
    if done_gate.get("verdict") is None:
        issues.append("Done gate not run (run done-gate)")
    elif done_gate.get("verdict") == "FAIL":
        issues.append("Done gate FAILED (add missing proofs or fix blocking items)")

    # Step 10-14: Prosecution/Arbitration
    prosecution_a = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_A.json", default={}) or {}
    if not prosecution_a.get("results"):
        issues.append("Prosecution A not imported (run prosecution-bundle, then prosecution-import --prosecutor A)")

    prosecution_b = load_json(root / "forge/prosecution/PROSECUTION_RESULTS_B.json", default={}) or {}
    if not prosecution_b.get("results"):
        issues.append("Prosecution B not imported (run prosecution-import --prosecutor B)")

    prosecution_cmp = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}
    if prosecution_cmp.get("verdict") is None:
        issues.append("Prosecution comparison missing (auto-generated by prosecution-import; re-run if needed)")

    disputes = prosecution_cmp.get("disagreements") or []
    if disputes:
        arbitration = load_json(root / "forge/prosecution/ARBITRATION_RESULT.json", default={}) or {}
        if not arbitration.get("results"):
            issues.append("Arbitration required (prosecutors disagreed; run arbitration-bundle and arbitration-import)")

    # Step 15-20: Final gates
    integrity = load_json(root / "forge/reports/INTEGRITY_REPORT.json", default={}) or {}
    if integrity.get("verdict") is None:
        issues.append("Integrity not run (run integrity)")
    elif integrity.get("verdict") == "FAIL":
        issues.append("Integrity FAILED (fix file/JSON corruption, then re-run integrity)")

    truth = load_json(root / "forge/reports/TRUTH_REPORT.json", default={}) or {}
    if truth.get("verdict") is None:
        issues.append("Truth not run (run truth AFTER integrity)")
    elif truth.get("verdict") == "FAIL":
        issues.append("Truth FAILED (check proof tiers, prosecutors, overrides, then re-run truth)")

    audit = load_json(root / "forge/reports/AUDIT_REPORT.json", default={}) or {}
    if audit.get("system_verdict") is None:
        issues.append("Audit not run (run audit AFTER truth)")
    elif audit.get("system_verdict") == "FAIL":
        issues.append("Audit FAILED (check subsystem reports, then re-run audit)")

    deployment = load_json(root / "forge/reports/DEPLOYMENT_GATE.json", default={}) or {}
    if deployment.get("verdict") is None:
        issues.append("Deployment gate not run (run deployment-gate)")
    elif deployment.get("verdict") == "FAIL":
        issues.append("Deployment gate FAILED (configure production settings, then re-run deployment-gate)")

    finalized = (root / "forge/final/LOCK").exists()

    print("VALIDATE-ORDER")
    if issues:
        print(f"BLOCKERS: {len(issues)}")
        for msg in issues:
            print(f"  - {msg}")
        return 1

    if finalized:
        print("OK — Workflow complete (project is finalized)")
    else:
        print("OK — Workflow prerequisites satisfied; ready for finalize-gate")
    return 0


def _release_pre_finalize_blockers(root: Path) -> list[str]:
    """Return release-critical blockers that must be clear before final lock.

    Finalize must not be weaker than release-gate. This helper intentionally
    checks the same high-level gates release-gate depends on, except final
    snapshot/LOCK which finalize itself creates.
    """
    blockers: list[str] = []

    required_reports = [
        ("DONE_GATE", "forge/reports/DONE_GATE.json", "verdict"),
        ("DEPLOYMENT_GATE", "forge/reports/DEPLOYMENT_GATE.json", "verdict"),
        ("INTEGRITY_REPORT", "forge/reports/INTEGRITY_REPORT.json", "verdict"),
        ("TRUTH_REPORT", "forge/reports/TRUTH_REPORT.json", "verdict"),
        ("AUDIT_REPORT", "forge/reports/AUDIT_REPORT.json", "system_verdict"),
    ]
    for label, rel_path, verdict_key in required_reports:
        report = load_json(root / rel_path, default={}) or {}
        if report.get(verdict_key) != "PASS":
            blockers.append(f"{label} not PASS")

    prosecution = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}
    if prosecution.get("verdict") != "PASS":
        blockers.append("Prosecution comparison not PASS")

    if active_overrides(root):
        blockers.append(f"Active overrides present ({len(active_overrides(root))} override(s), must be cleared)")

    disputes = prosecution.get("disagreements") or []
    if isinstance(disputes, list) and len(disputes) > 0:
        arbitration = load_json(root / "forge/prosecution/ARBITRATION_RESULT.json", default={}) or {}
        if not arbitration.get("results"):
            blockers.append("Prosecution has disagreements; arbitration required but not resolved")

    return blockers


def structure_command(root: Path) -> int:
    """Scan and build structure."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1

    structure = build_structure(root, manifest)
    save_structure(root, structure)

    print(f"Entries: {structure['summary']['entry_count']}")
    if "forgetastic_entry_count" in structure["summary"]:
        print(f"FORGETASTIC lines: {structure['summary']['forgetastic_entry_count']}")
    if "ast_symbol_count" in structure["summary"]:
        print(f"AST symbols: {structure['summary']['ast_symbol_count']}")
    print(f"Mapped: {len(structure['summary']['mapped_ids'])}")
    print(f"Unmapped: {len(structure['summary']['unmapped_manifest_ids'])}")

    if structure["summary"]["unmapped_manifest_ids"]:
        print("\nUnmapped manifest IDs:")
        for mid in structure["summary"]["unmapped_manifest_ids"]:
            print(f"  - {mid}")

    recompute_and_save(root, manifest)
    return 0


def lock_manifest_command(root: Path) -> int:
    """Set manifest_locked true after lint passes (release validation)."""
    manifest_path = root / "forge" / "manifest" / "MANIFEST.json"
    manifest = load_manifest(manifest_path)
    if manifest is None:
        log.error("Manifest not found")
        return 1
    report = lint_manifest(manifest)
    if report["verdict"] != "PASS":
        log.error("Cannot lock manifest: manifest-lint must PASS first")
        print(f"Verdict: {report['verdict']}")
        for item in report.get("blocking_items", []):
            print(f"  - {item.get('id')}: {item.get('message')}")
        return 1
    manifest["manifest_locked"] = True
    save_manifest(manifest_path, manifest)
    recompute_and_save(root, manifest)
    print("MANIFEST LOCKED")
    return 0


def integrity_command(root: Path) -> int:
    """Structural integrity: JSON/JSONL, artifacts, event chain."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    report = run_integrity(root)
    if manifest is not None:
        recompute_and_save(root, manifest)
    print("INTEGRITY")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    return 0 if report["verdict"] == "PASS" else 1


def audit_command(root: Path) -> int:
    """Aggregate subsystem verdicts: manifest-lint, enforcement, drift, done-gate, integrity, truth, deployment-gate (run after truth for complete picture)."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    report = run_audit(root)
    if manifest is not None:
        recompute_and_save(root, manifest)
    print("AUDIT")
    print(f"system_verdict: {report['system_verdict']}")
    if report.get("failure_reasons"):
        for r in report["failure_reasons"]:
            print(f"  - {r}")
    return 0 if report["system_verdict"] == "PASS" else 1


def release_gate_command(root: Path) -> int:
    """Final shippable release rule (all gates, overrides, prosecution, finalize)."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    report = run_release_gate(root)
    if manifest is not None:
        recompute_and_save(root, manifest)
    print("RELEASE GATE")
    print(f"verdict: {report['verdict']}")
    for item in report.get("blocking_items", []):
        print(f"  - {item.get('id')}: {item.get('message')}")
    return 0 if report["verdict"] == "PASS" else 1


def manifest_lint_command(root: Path) -> int:
    """Lint and render manifest."""
    manifest_path = root / "forge" / "manifest" / "MANIFEST.json"
    manifest = load_manifest(manifest_path)

    if manifest is None:
        log.error("Manifest not found. Run: forgetastic init")
        return 1

    report = lint_manifest(manifest)

    # Render markdown
    markdown = render_manifest_markdown(root, manifest)
    (root / "forge" / "manifest" / "MANIFEST.md").write_text(markdown, encoding="utf-8")

    # Save report
    save_json(root / "forge" / "reports" / "MANIFEST_LINT_REPORT.json", report)

    print(f"Verdict: {report['verdict']}")
    if report["blocking_items"]:
        print("\nBlocking items:")
        for item in report["blocking_items"]:
            print(f"  - {item['id']}: {item['message']}")

    recompute_and_save(root, manifest)
    return 0 if report["verdict"] == "PASS" else 1


def interview_command(root: Path, args: argparse.Namespace) -> int:
    """Update manifest interactively."""
    manifest_path = root / "forge" / "manifest" / "MANIFEST.json"
    manifest = load_manifest(manifest_path)

    if manifest is None:
        # Create default manifest
        manifest = {
            "project": "Unnamed Project",
            "mode": "STANDARD",
            "purpose": "TBD",
            "operator_approved": False,
            "manifest_locked": False,
            "created_utc": utc_now_iso(),
            "users": [],
            "behaviors": [],
            "failures": [],
            "integrations": [],
            "assumptions": [],
            "out_of_scope": [],
        }

    # Update from arguments
    if args.project:
        manifest["project"] = args.project.strip()

    if args.mode:
        manifest["mode"] = args.mode.upper().strip()

    if args.purpose:
        manifest["purpose"] = args.purpose.strip()

    # Save
    save_manifest(manifest_path, manifest)

    # After saving manifest:
    manifest = load_manifest(manifest_path)
    report = lint_manifest(manifest)

    # Lint + recompute (manifest_lint_command updates STATE via derive_state)
    return manifest_lint_command(root)


def prove_command(root: Path, args: argparse.Namespace) -> int:
    """Record runtime proof with cryptographic binding (deprecated for production)."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1

    if not manifest.get("manifest_locked", False):
        log.error("Manifest must be locked before recording proof")
        return 1

    # Validate manifest ID exists in manifest
    manifest_ids: set[str] = set()
    for section in ("behaviors", "failures", "integrations", "users", "assumptions", "out_of_scope"):
        for item in manifest.get(section, []) or []:
            if item.get("id"):
                manifest_ids.add(item["id"])

    if args.manifest_id not in manifest_ids:
        log.error(f"Manifest ID '{args.manifest_id}' not declared in manifest. Valid IDs: {sorted(manifest_ids) if manifest_ids else '(none)'}")
        return 1

    # Load production config for strictness checks
    from .production_engine import ensure_production_config
    production_cfg = ensure_production_config(root)

    # Warn if require_command_artifact_binding is enabled
    if production_cfg.get("require_command_artifact_binding", False):
        log.warning(
            "NOTE: Manual 'prove' CLI is deprecated for PRODUCTION. "
            "Use CI-driven beta tests instead (they auto-generate cryptographically-bound proofs). "
            "For production deployments, proofs must be auto-generated from test execution."
        )

    try:
        entry = create_proof_entry(
            root=root,
            manifest_id=args.manifest_id,
            proof_type=args.proof_type,
            environment=args.environment,
            runner=args.runner,
            command_text=args.command,
            input_summary=args.input_summary,
            expected_summary=args.expected_summary,
            actual_summary=args.actual_summary,
            status=args.status,
            artifact_paths=args.artifacts or [],
            confidence_level=args.confidence,
            session_id=args.session_id or "",
        )
    except ValueError as e:
        log.error(f"Proof validation failed: {e}")
        return 1

    append_proof(root, entry)
    build_evidence_index(root, manifest)
    _recompute_if_manifest(root)

    print(f"✓ Proof recorded: {entry['proof_id']}")
    print(f"  Command hash: {entry.get('command_hash', 'N/A')[:16]}...")
    print(f"  Artifacts bound: {len(entry.get('artifact_binding', []))}")
    return 0


def enforce_command(root: Path) -> int:
    """BUILD 6: Run enforcement report."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    policy = get_policy(root)
    report = run_enforcement(root, manifest, policy)
    _recompute_if_manifest(root)
    print("ENFORCEMENT")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    print(f"warnings: {len(report.get('warnings', []))}")
    return 0 if report["verdict"] == "PASS" else 1


def drift_command(root: Path) -> int:
    """BUILD 6: Run drift report."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    policy = get_policy(root)
    report = run_drift(root, manifest, policy)
    _recompute_if_manifest(root)
    print("DRIFT")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    print(f"warnings: {len(report.get('warnings', []))}")
    return 0 if report["verdict"] == "PASS" else 1


def done_gate_command(root: Path) -> int:
    """BUILD 7: Completion gate."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    policy = get_policy(root)
    report = run_done_gate(root, manifest, policy)
    _recompute_if_manifest(root)
    print("DONE GATE")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    return 0 if report["verdict"] == "PASS" else 1


def override_command(root: Path, args: argparse.Namespace) -> int:
    """BUILD 7: Record override request."""
    entry = create_override(
        root=root,
        reason=args.reason,
        manifest_ids=args.manifest_ids,
        expires_utc=args.expires,
        created_by=args.created_by,
    )
    print("OVERRIDE CREATED")
    print(f"id: {entry['override_id']}")
    _recompute_if_manifest(root)
    return 0


def prosecution_bundle_command(root: Path) -> int:
    """BUILD 8: Generate prosecution input bundle."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    structure = get_structure(root)
    evidence_index = build_evidence_index(root, manifest)
    policy = get_policy(root)
    bundle = build_prosecution_bundle(root, manifest, structure, evidence_index, policy)
    print("PROSECUTION BUNDLE GENERATED")
    print(f"items: {len(bundle.get('items', []))}")
    return 0


def prosecution_import_command(root: Path, args: argparse.Namespace) -> int:
    """BUILD 8: Import prosecutor A or B results JSON."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1

    results_path = Path(args.results_file)
    if not results_path.is_absolute():
        results_path = (root / results_path).resolve()
    if not results_path.exists():
        print("RESULTS FILE NOT FOUND")
        return 1

    try:
        payload = json.loads(results_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print("RESULTS FILE IS NOT VALID JSON")
        return 1

    errors = validate_prosecution_results(payload, manifest)
    if errors:
        print("PROSECUTION RESULTS REJECTED")
        for error in errors:
            print(f"- {error}")
        return 1

    prosecutor = str(args.prosecutor).upper().strip()
    output_path = import_prosecution_results(root, prosecutor, payload)
    comparison = compare_prosecution_results(root)

    print("PROSECUTION RESULTS IMPORTED")
    print(f"stored_at: {output_path}")
    print(f"comparison_verdict: {comparison['verdict']}")
    print(f"disagreements: {len(comparison.get('disagreements', []))}")
    _recompute_if_manifest(root)
    return 0


def arbitration_bundle_command(root: Path) -> int:
    """BUILD 9: Generate arbitration input from prosecution comparison."""
    bundle = build_arbitration_input(root)
    print("ARBITRATION BUNDLE GENERATED")
    print(f"disputes: {len(bundle.get('disputes', []))}")
    return 0


def arbitration_import_command(root: Path, args: argparse.Namespace) -> int:
    """BUILD 9: Import arbiter decision JSON."""
    file_path = Path(args.file)
    if not file_path.is_absolute():
        file_path = (root / file_path).resolve()
    if not file_path.exists():
        print("FILE NOT FOUND")
        return 1
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print("INVALID JSON")
        return 1
    errors = validate_arbitration_result(payload)
    if errors:
        print("INVALID ARBITRATION RESULT")
        for e in errors:
            print(f"- {e}")
        return 1
    import_arbitration_result(root, payload)
    print("ARBITRATION IMPORTED")
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is not None:
        recompute_and_save(root, manifest)
    return 0


def deployment_gate_command(root: Path) -> int:
    """BUILD 11: Run deployment gate (URLs, PROD proof, deadlines, snapshot)."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    report = run_deployment_gate(root)
    print("DEPLOYMENT GATE")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    print(f"warnings: {len(report.get('warnings', []))}")
    if manifest is not None:
        recompute_and_save(root, manifest)
    return 0 if report["verdict"] == "PASS" else 1


def production_config_command(root: Path, args: argparse.Namespace) -> int:
    """BUILD 11: View or update forge/policy/PRODUCTION.json."""
    cfg = ensure_production_config(root)

    def _tf(v: str | None) -> bool | None:
        if v is None:
            return None
        return v == "true"

    if args.project_owner is not None:
        cfg["project_owner"] = args.project_owner.strip()
    if args.completion_deadline_utc is not None:
        cfg["completion_deadline_utc"] = args.completion_deadline_utc.strip()
    if args.stale_project_days is not None:
        cfg["stale_project_days"] = int(args.stale_project_days)
    rl = _tf(args.require_live_runtime_proof)
    if rl is not None:
        cfg["require_live_runtime_proof"] = rl
    ro = _tf(args.require_owner_signoff)
    if ro is not None:
        cfg["require_owner_signoff"] = ro
    fz = _tf(args.system_freeze)
    if fz is not None:
        cfg["system_freeze_mode"] = fz

    if args.base_url is not None or args.healthcheck_url is not None:
        targets = list(cfg.get("deployment_targets") or [])
        if not targets:
            targets = [{"name": "primary", "base_url": "", "healthcheck_url": "", "required": True}]
        t0 = dict(targets[0])
        if args.base_url is not None:
            t0["base_url"] = args.base_url.strip()
        if args.healthcheck_url is not None:
            t0["healthcheck_url"] = args.healthcheck_url.strip()
        targets[0] = t0
        cfg["deployment_targets"] = targets

    save_production_config(root, cfg)
    print(json.dumps(cfg, indent=2, ensure_ascii=False))
    return 0


def verify_artifacts_command(root: Path) -> int:
    """BUILD 10: Verify proof artifact paths exist; write ARTIFACT_VERIFICATION.json."""
    report = verify_artifacts(root)
    print("ARTIFACT VERIFICATION")
    print(f"verdict: {report['verdict']}")
    print(f"checked: {report.get('checked_count', 0)} missing: {report.get('missing_count', 0)}")
    return 0 if report["verdict"] == "PASS" else 1


def truth_command(root: Path) -> int:
    """BUILD 13: Truth enforcement layer (tiers, prosecution, overrides, invariants, event chain)."""
    ensure_directory(root / "forge/reports")
    ensure_directory(root / "forge/ledger")
    manifest = load_manifest(root / "forge/manifest/MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    report = run_truth(root)
    recompute_and_save(root, manifest)
    append_session_log(root, {"event": "truth", "verdict": report["verdict"]})
    record_standard_event(root, "truth_run", "operator", {"verdict": report["verdict"]})
    print("TRUTH")
    print(f"verdict: {report['verdict']}")
    print(f"blocking_items: {len(report.get('blocking_items', []))}")
    return 0 if report["verdict"] == "PASS" else 1


def finalize_gate_command(root: Path) -> int:
    """Pre-check: Can finalize proceed? (run before finalize to avoid surprises)."""
    blocking: list[str] = []

    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        blocking.append("Manifest not found")
    elif not manifest.get("manifest_locked", False):
        blocking.append("Manifest not locked (run lock-manifest first)")

    if (root / "forge/final/LOCK").exists():
        blocking.append("Already locked (finalize already completed)")

    blocking.extend(_release_pre_finalize_blockers(root))

    print("FINALIZE-GATE")
    if blocking:
        print("CANNOT FINALIZE:")
        for msg in blocking:
            print(f"  - {msg}")
        return 1

    print("OK — All preconditions for finalize are met")
    return 0


def finalize_command(root: Path) -> int:
    """BUILD 9: Snapshot hashes and lock project when gates pass."""
    manifest = load_manifest(root / "forge" / "manifest" / "MANIFEST.json")
    if manifest is None:
        log.error("Manifest not found")
        return 1
    if not manifest.get("manifest_locked", False):
        print("CANNOT FINALIZE — MANIFEST NOT LOCKED")
        return 1
    if (root / "forge/final/LOCK").exists():
        print("ALREADY LOCKED")
        return 1

    blockers = _release_pre_finalize_blockers(root)
    if blockers:
        print("CANNOT FINALIZE — RELEASE PRECONDITIONS")
        for msg in blockers:
            print(f"  - {msg}")
        return 1

    build_final_snapshot(root)
    lock_project(root)
    recompute_and_save(root, manifest)
    print("PROJECT FINALIZED")
    print("LOCKED")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="forgetastic",
        description="FORGE + Forgetastic unified control system",
    )
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    subparsers.add_parser("init", help="Initialize project")
    subparsers.add_parser("status", help="Show project status")
    subparsers.add_parser("doctor", help="Run health check")
    subparsers.add_parser("report-status", help="Show freshness of all reports")
    subparsers.add_parser("validate-order", help="Validate workflow order and prerequisites")

    interview = subparsers.add_parser("interview", help="Update manifest fields")
    interview.add_argument("--project", type=str, help="Set project name")
    interview.add_argument("--mode", type=str, choices=["LITE", "STANDARD", "FULL", "REGULATED"], help="Set mode")
    interview.add_argument("--purpose", type=str, help="Set purpose")

    subparsers.add_parser("manifest-lint", help="Lint and render manifest")
    subparsers.add_parser("lock-manifest", help="Set manifest_locked after manifest-lint PASS")

    subparsers.add_parser("structure", help="Scan and build structure")

    subparsers.add_parser("enforce", help="Run enforcement report (BUILD 6)")
    subparsers.add_parser("drift", help="Run drift report (BUILD 6)")

    subparsers.add_parser("done-gate", help="Run done gate report (BUILD 7)")

    override = subparsers.add_parser("override", help="Create override request (BUILD 7)")
    override.add_argument("--reason", required=True)
    override.add_argument("--manifest-ids", nargs="+", required=True, dest="manifest_ids")
    override.add_argument("--expires", required=True)
    override.add_argument("--created-by", required=True, dest="created_by")

    subparsers.add_parser("prosecution-bundle", help="Generate prosecution input bundle (BUILD 8)")

    prosecution_import = subparsers.add_parser("prosecution-import", help="Import prosecutor results JSON (BUILD 8)")
    prosecution_import.add_argument("--prosecutor", required=True, choices=["A", "B", "a", "b"])
    prosecution_import.add_argument("--results-file", required=True)

    subparsers.add_parser("arbitration-bundle", help="Generate arbitration input (BUILD 9)")

    arb_import = subparsers.add_parser("arbitration-import", help="Import arbitration result JSON (BUILD 9)")
    arb_import.add_argument("--file", required=True)

    subparsers.add_parser("finalize-gate", help="Pre-check: Can finalize proceed?")
    subparsers.add_parser("finalize", help="Write final snapshot and lock (BUILD 9)")

    subparsers.add_parser("deployment-gate", help="Run deployment gate report (BUILD 11)")
    subparsers.add_parser("verify-artifacts", help="Verify runtime proof artifacts exist (BUILD 10)")

    subparsers.add_parser("truth", help="Run truth enforcement report (BUILD 13)")
    subparsers.add_parser("integrity", help="Run integrity report (JSON/JSONL, artifacts, event chain)")
    subparsers.add_parser("audit", help="Aggregate AUDIT_REPORT (run after truth for full verdict)")
    subparsers.add_parser("release-gate", help="Final release rule (all gates + finalize artifacts)")

    pb = subparsers.add_parser(
        "pipeline-bootstrap",
        help="Initialize Forgetastic workspace from AppFinisher repair output (ForgePipeline)",
    )
    pb.add_argument(
        "--construction-log",
        default=None,
        metavar="PATH",
        help="Path to AppFinisher CONSTRUCTION_LOG.md (default: ./forge/CONSTRUCTION_LOG.md)",
    )
    pb.add_argument(
        "--status",
        default=None,
        metavar="PATH",
        help="Path to AppFinisher STATUS.md (default: ./forge/STATUS.md)",
    )

    prod_cfg = subparsers.add_parser(
        "production-config",
        help="View or edit forge/policy/PRODUCTION.json (BUILD 11)",
    )
    prod_cfg.add_argument("--project-owner", default=None, help="Project owner name")
    prod_cfg.add_argument("--completion-deadline-utc", default=None, metavar="ISO8601")
    prod_cfg.add_argument("--base-url", default=None, help="Primary deployment base URL")
    prod_cfg.add_argument("--healthcheck-url", default=None, help="Primary healthcheck URL")
    prod_cfg.add_argument("--stale-project-days", type=int, default=None)
    prod_cfg.add_argument(
        "--require-live-runtime-proof",
        choices=["true", "false"],
        default=None,
        help="Require at least one PROD proof with PASS",
    )
    prod_cfg.add_argument(
        "--require-owner-signoff",
        choices=["true", "false"],
        default=None,
        help="Require project_owner to be set for deployment gate",
    )
    prod_cfg.add_argument(
        "--system-freeze",
        choices=["true", "false"],
        default=None,
        dest="system_freeze",
        help="When true, deployment gate blocks (system_freeze_mode)",
    )

    prove = subparsers.add_parser("prove", help="Record runtime proof")
    prove.add_argument("--manifest-id", required=True, help="Manifest ID (e.g., BHV-001)")
    prove.add_argument("--proof-type", required=True, choices=list(PROOF_TYPES), help="Proof type")
    prove.add_argument("--environment", required=True, choices=list(ENVIRONMENTS), help="Environment")
    prove.add_argument("--runner", required=True, help="Runner name (e.g., pytest)")
    prove.add_argument("--command", required=True, help="Command run")
    prove.add_argument("--input-summary", required=True, help="What was tested")
    prove.add_argument("--expected-summary", required=True, help="What was expected")
    prove.add_argument("--actual-summary", required=True, help="What actually happened")
    prove.add_argument("--status", required=True, choices=["PASS", "FAIL", "ENVIRONMENTAL"], help="Result")
    prove.add_argument("--artifacts", nargs="*", default=[], help="Artifact paths")
    prove.add_argument("--confidence", type=int, required=True, help="Confidence (1-6)")
    prove.add_argument("--session-id", help="Session ID")

    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        parser = build_parser()
        args = parser.parse_args(argv)
        root = find_project_root()

        if args.cmd == "init":
            return init_command(root)
        if args.cmd == "status":
            return status_command(root)
        if args.cmd == "doctor":
            return doctor_command(root)
        if args.cmd == "report-status":
            return report_status_command(root)
        if args.cmd == "validate-order":
            return validate_order_command(root)
        if args.cmd == "manifest-lint":
            return manifest_lint_command(root)
        if args.cmd == "lock-manifest":
            return lock_manifest_command(root)
        if args.cmd == "interview":
            return interview_command(root, args)
        if args.cmd == "structure":
            return structure_command(root)
        if args.cmd == "prove":
            return prove_command(root, args)
        if args.cmd == "enforce":
            return enforce_command(root)
        if args.cmd == "drift":
            return drift_command(root)
        if args.cmd == "done-gate":
            return done_gate_command(root)
        if args.cmd == "override":
            return override_command(root, args)
        if args.cmd == "prosecution-bundle":
            return prosecution_bundle_command(root)
        if args.cmd == "prosecution-import":
            return prosecution_import_command(root, args)
        if args.cmd == "arbitration-bundle":
            return arbitration_bundle_command(root)
        if args.cmd == "arbitration-import":
            return arbitration_import_command(root, args)
        if args.cmd == "finalize-gate":
            return finalize_gate_command(root)
        if args.cmd == "finalize":
            return finalize_command(root)
        if args.cmd == "deployment-gate":
            return deployment_gate_command(root)
        if args.cmd == "verify-artifacts":
            return verify_artifacts_command(root)
        if args.cmd == "truth":
            return truth_command(root)
        if args.cmd == "integrity":
            return integrity_command(root)
        if args.cmd == "audit":
            return audit_command(root)
        if args.cmd == "release-gate":
            return release_gate_command(root)
        if args.cmd == "production-config":
            return production_config_command(root, args)
        if args.cmd == "pipeline-bootstrap":
            from .pipeline_bootstrap import bootstrap_from_appfinisher, resolve_default_paths
            construction_log, status_path = resolve_default_paths(root, args)
            return bootstrap_from_appfinisher(construction_log, status_path, root)

        parser.print_help()
        return 1
    except Exception as e:
        log.critical(f"Fatal error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
