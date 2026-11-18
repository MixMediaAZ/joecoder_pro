# tools/forgetastic/drift_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md FILE 3)

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from .common import load_json, save_json, utc_now_iso, sha256_dict
from .evidence_engine import (
    collect_manifest_ids,
    collect_required_manifest_ids,
    latest_proof_by_manifest_id,
    proof_age_days,
)


DRIFT_REPORT_PATH = Path("forge/reports/DRIFT_REPORT.json")


def _report_path(root: Path) -> Path:
    return root / DRIFT_REPORT_PATH


def _structure_payload(root: Path) -> dict[str, Any]:
    return load_json(root / "forge/structure/STRUCTURE.json", default={}) or {}


def _policy_threshold_days(policy: dict[str, Any], severity: str) -> int | None:
    value = (
        policy.get("runtime_proof_requirements", {})
        .get(severity, {})
        .get("stale_after_days")
    )
    if isinstance(value, int):
        return value
    return None


def _manifest_severity_map(manifest: dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id")
            if item_id:
                out[item_id] = str(item.get("severity", "MINOR")).upper()
    return out


def run_drift(root: Path, manifest: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    structure = _structure_payload(root)
    latest_rows = latest_proof_by_manifest_id(root)
    policy_hash = sha256_dict(policy) if policy else None

    blocking_items: List[dict[str, Any]] = []
    warnings: List[dict[str, Any]] = []

    declared_ids = collect_manifest_ids(manifest)
    required_ids = collect_required_manifest_ids(manifest)
    severity_map = _manifest_severity_map(manifest)

    structure_entries = structure.get("entries", []) or []
    mapped_ids = set()
    for entry in structure_entries:
        manifest_id = entry.get("manifest_id")
        if manifest_id:
            mapped_ids.add(manifest_id)
            if manifest_id not in declared_ids:
                blocking_items.append({"id": manifest_id, "message": "Structure drift: mapped ID is not declared in manifest"})

    required_not_mapped = [manifest_id for manifest_id in required_ids if manifest_id not in mapped_ids]
    for manifest_id in required_not_mapped:
        blocking_items.append({"id": manifest_id, "message": "Required manifest item is not mapped in structure"})

    proof_ids = set(latest_rows.keys())
    undeclared_proof_ids = [manifest_id for manifest_id in proof_ids if manifest_id not in declared_ids]
    for manifest_id in undeclared_proof_ids:
        blocking_items.append({"id": manifest_id, "message": "Runtime proof exists for undeclared manifest ID"})

    stale_proof_ids: List[dict[str, Any]] = []
    missing_required_proof_ids: List[str] = []

    for manifest_id in required_ids:
        latest = latest_rows.get(manifest_id)
        if not latest:
            missing_required_proof_ids.append(manifest_id)
            continue

        severity = severity_map.get(manifest_id, "MINOR")
        threshold_days = _policy_threshold_days(policy, severity)
        age_days = proof_age_days(latest.get("timestamp_utc"))

        if threshold_days is not None and age_days is not None and age_days > threshold_days:
            stale_proof_ids.append(
                {
                    "id": manifest_id,
                    "message": f"Proof is stale for severity {severity}: age {age_days:.2f} days > threshold {threshold_days}",
                }
            )

    for item in missing_required_proof_ids:
        warnings.append({"id": item, "message": "Required manifest item has no runtime proof"})

    for item in stale_proof_ids:
        severity = severity_map.get(item["id"], "MINOR")
        if severity in {"CRITICAL", "MAJOR"}:
            blocking_items.append(item)
        else:
            warnings.append(item)

    report = {
        "report_name": "DRIFT_REPORT",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest),
        "policy_hash": policy_hash,
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "summary": {
            "declared_manifest_id_count": len(declared_ids),
            "required_manifest_id_count": len(required_ids),
            "mapped_manifest_id_count": len(mapped_ids),
            "undeclared_proof_id_count": len(undeclared_proof_ids),
            "missing_required_proof_count": len(missing_required_proof_ids),
            "stale_proof_count": len(stale_proof_ids),
        },
    }

    save_json(_report_path(root), report)
    return report
