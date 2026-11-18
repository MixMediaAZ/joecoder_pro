# tools/forgetastic/enforcement_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md FILE 2)

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from .common import load_json, save_json, utc_now_iso, sha256_dict
from .artifact_verifier import verify_artifacts
from .evidence_engine import build_evidence_index, collect_required_manifest_ids, latest_proof_by_manifest_id


ENFORCEMENT_REPORT_PATH = Path("forge/reports/ENFORCEMENT_REPORT.json")

BLOCKING_UNDECLARED_PATTERNS = {"mock", "fake", "placeholder", "stub"}
WARNING_UNDECLARED_PATTERNS = {"todo", "fixme"}


def _report_path(root: Path) -> Path:
    return root / ENFORCEMENT_REPORT_PATH


def _manifest_required_ids(manifest: dict[str, Any]) -> List[str]:
    return sorted(collect_required_manifest_ids(manifest))


def _structure_payload(root: Path) -> dict[str, Any]:
    return load_json(root / "forge/structure/STRUCTURE.json", default={}) or {}


def _runtime_index(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    return build_evidence_index(root, manifest)


def _latest_status(latest_rows: Dict[str, dict[str, Any]], manifest_id: str) -> str | None:
    row = latest_rows.get(manifest_id)
    if not row:
        return None
    return row.get("status")


def run_enforcement(root: Path, manifest: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    _ = policy  # reserved for future policy-driven rules
    structure = _structure_payload(root)
    evidence_index = _runtime_index(root, manifest)
    latest_rows = latest_proof_by_manifest_id(root)

    blocking_items: List[dict[str, Any]] = []
    warnings: List[dict[str, Any]] = []

    artifact_report = verify_artifacts(root)
    if artifact_report.get("verdict") != "PASS":
        blocking_items.append({
            "id": "ARTIFACTS",
            "message": f"{artifact_report.get('missing_count', 0)} missing artifacts referenced by runtime proof",
        })

    if not manifest.get("manifest_locked", False):
        blocking_items.append({"id": "MANIFEST", "message": "Manifest must be locked before enforcement can pass."})

    if not manifest.get("operator_approved", False):
        blocking_items.append({"id": "MANIFEST", "message": "Operator approval must be true before enforcement can pass."})
    else:
        # If operator_approved is true, require a recent timestamp (fail-closed attestation)
        from datetime import UTC, datetime
        approval_timestamp = manifest.get("operator_approval_timestamp_utc")
        if not approval_timestamp:
            blocking_items.append({
                "id": "ATTESTATION",
                "message": "operator_approved=true requires operator_approval_timestamp_utc field (process-enforced witness)"
            })
        else:
            try:
                ts = datetime.fromisoformat(approval_timestamp.replace("Z", "+00:00")).astimezone(UTC)
                age_days = (datetime.now(UTC) - ts).total_seconds() / 86400.0
                if age_days > 7:
                    blocking_items.append({
                        "id": "ATTESTATION",
                        "message": f"operator_approval_timestamp_utc is stale ({age_days:.1f} days old; max 7 days)"
                    })
            except (ValueError, AttributeError):
                blocking_items.append({
                    "id": "ATTESTATION",
                    "message": "operator_approval_timestamp_utc is malformed (must be ISO 8601 UTC timestamp)"
                })

    entries = structure.get("entries", []) or []
    summary = structure.get("summary", {}) or {}
    mapped_ids = {e["manifest_id"] for e in entries if e.get("manifest_id")}
    undeclared_code_flags = summary.get("undeclared_code_flags", []) or []

    if len(entries) == 0:
        blocking_items.append({"id": "STRUCTURE", "message": "No structure entries found. Implementation has not been mapped."})

    required_ids = _manifest_required_ids(manifest)

    for manifest_id in required_ids:
        if manifest_id not in mapped_ids:
            blocking_items.append({"id": manifest_id, "message": "Required manifest item is not mapped in STRUCTURE.json"})

    declared_ids = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            if item.get("id"):
                declared_ids.add(item["id"])

    for entry in entries:
        manifest_id = entry.get("manifest_id")
        if manifest_id and manifest_id not in declared_ids:
            blocking_items.append({"id": manifest_id, "message": "STRUCTURE.json references undeclared manifest ID"})

    for flag in undeclared_code_flags:
        pattern = str(flag.get("pattern", "")).lower()
        file_path = flag.get("file", "UNKNOWN")
        if pattern in BLOCKING_UNDECLARED_PATTERNS:
            blocking_items.append({"id": file_path, "message": f"Blocking suspicious pattern found in source: {pattern}"})
        elif pattern in WARNING_UNDECLARED_PATTERNS:
            warnings.append({"id": file_path, "message": f"Warning suspicious pattern found in source: {pattern}"})
        else:
            warnings.append({"id": file_path, "message": f"Suspicious pattern found in source: {pattern}"})

    missing_required_ids = evidence_index.get("missing_required_ids", []) or []
    for manifest_id in missing_required_ids:
        warnings.append({"id": manifest_id, "message": "Required manifest item has no runtime proof yet"})

    for manifest_id in required_ids:
        latest_status = _latest_status(latest_rows, manifest_id)
        if latest_status == "FAIL":
            blocking_items.append({"id": manifest_id, "message": "Latest runtime proof status is FAIL"})
        elif latest_status == "ENVIRONMENTAL":
            warnings.append({"id": manifest_id, "message": "Latest runtime proof status is ENVIRONMENTAL"})

    report = {
        "report_name": "ENFORCEMENT_REPORT",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest),
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "summary": {
            "required_manifest_id_count": len(required_ids),
            "mapped_required_manifest_id_count": len([x for x in required_ids if x in mapped_ids]),
            "missing_required_proof_count": len(missing_required_ids),
            "suspicious_source_flag_count": len(undeclared_code_flags),
            "structure_entry_count": len(entries),
            "artifact_verification_verdict": artifact_report.get("verdict"),
            "artifact_missing_count": artifact_report.get("missing_count", 0),
        },
    }

    save_json(_report_path(root), report)
    return report
