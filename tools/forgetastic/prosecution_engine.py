# tools/forgetastic/prosecution_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md BUILD 8 FILE 1)

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from .common import load_json, save_json, utc_now_iso


PROSECUTION_INPUT_BUNDLE_PATH = Path("forge/prosecution/PROSECUTION_INPUT_BUNDLE.json")
PROSECUTION_RESULTS_A_PATH = Path("forge/prosecution/PROSECUTION_RESULTS_A.json")
PROSECUTION_RESULTS_B_PATH = Path("forge/prosecution/PROSECUTION_RESULTS_B.json")
PROSECUTION_COMPARISON_PATH = Path("forge/prosecution/PROSECUTION_COMPARISON.json")


VALID_VERDICTS = {"PASS", "FAIL", "DISPUTED", "ENVIRONMENTAL"}
VALID_CONFIDENCE = {"HIGH", "MEDIUM", "LOW"}


def _input_bundle_path(root: Path) -> Path:
    return root / PROSECUTION_INPUT_BUNDLE_PATH


def _results_a_path(root: Path) -> Path:
    return root / PROSECUTION_RESULTS_A_PATH


def _results_b_path(root: Path) -> Path:
    return root / PROSECUTION_RESULTS_B_PATH


def _comparison_path(root: Path) -> Path:
    return root / PROSECUTION_COMPARISON_PATH


def collect_declared_items(manifest: dict[str, Any]) -> List[dict[str, Any]]:
    items: List[dict[str, Any]] = []

    for section_name, key in [
        ("behaviors", "BHV"),
        ("failures", "FAI"),
        ("integrations", "INT"),
    ]:
        for item in manifest.get(section_name, []) or []:
            item_id = item.get("id")
            if not item_id:
                continue
            items.append(
                {
                    "manifest_id": item_id,
                    "section": section_name,
                    "required": bool(item.get("required", True)),
                    "severity": item.get("severity", "MINOR"),
                    "title": item.get("title", ""),
                    "given": item.get("given", ""),
                    "when": item.get("when", ""),
                    "then": item.get("then", ""),
                    "notes": item.get("notes", ""),
                }
            )

    return items


def _latest_evidence_for_bundle(evidence: dict[str, Any]) -> dict[str, Any]:
    """Map BUILD 5 index shape (count, latest_timestamp) to bundle contract."""
    if not evidence:
        return {
            "proof_count": None,
            "latest_status": None,
            "latest_environment": None,
            "latest_timestamp_utc": None,
            "latest_confidence_level": None,
            "latest_proof_id": None,
        }
    return {
        "proof_count": evidence.get("proof_count", evidence.get("count")),
        "latest_status": evidence.get("latest_status"),
        "latest_environment": evidence.get("latest_environment"),
        "latest_timestamp_utc": evidence.get("latest_timestamp_utc", evidence.get("latest_timestamp")),
        "latest_confidence_level": evidence.get("latest_confidence_level"),
        "latest_proof_id": evidence.get("latest_proof_id"),
    }


def build_prosecution_bundle(
    root: Path,
    manifest: dict[str, Any],
    structure: dict[str, Any],
    evidence_index: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    declared_items = collect_declared_items(manifest)
    structure_entries = structure.get("entries", []) or []
    by_manifest_id = evidence_index.get("by_manifest_id", {}) or {}

    structure_map: Dict[str, List[dict[str, Any]]] = {}
    for entry in structure_entries:
        manifest_id = entry.get("manifest_id")
        if not manifest_id:
            continue
        structure_map.setdefault(manifest_id, []).append(
            {
                "file_path": entry.get("file_path"),
                "line_number": entry.get("line_number"),
                "symbol_name": entry.get("symbol_name"),
                "symbol_type": entry.get("symbol_type"),
                "confidence": entry.get("confidence"),
            }
        )

    items: List[dict[str, Any]] = []
    for item in declared_items:
        manifest_id = item["manifest_id"]
        evidence = by_manifest_id.get(manifest_id, {}) or {}
        items.append(
            {
                "manifest_id": manifest_id,
                "section": item["section"],
                "required": item["required"],
                "severity": item["severity"],
                "title": item["title"],
                "given": item["given"],
                "when": item["when"],
                "then": item["then"],
                "notes": item["notes"],
                "structure_entries": structure_map.get(manifest_id, []),
                "latest_evidence": _latest_evidence_for_bundle(evidence),
            }
        )

    bundle = {
        "bundle_name": "PROSECUTION_INPUT_BUNDLE",
        "generated_utc": utc_now_iso(),
        "project": manifest.get("project", "UNKNOWN"),
        "policy_version": policy.get("policy_version", "UNKNOWN"),
        "project_mode": manifest.get("mode", "UNKNOWN"),
        "manifest_locked": bool(manifest.get("manifest_locked", False)),
        "operator_approved": bool(manifest.get("operator_approved", False)),
        "items": items,
        "instructions": {
            "goal": "Evaluate each manifest item independently against structure and evidence.",
            "allowed_verdicts": sorted(VALID_VERDICTS),
            "required_output_fields": [
                "manifest_id",
                "verdict",
                "reason",
                "confidence",
                "evidence_referenced",
                "requires_arbitration",
            ],
            "rules": [
                "Judge only what is declared.",
                "Do not invent missing implementation.",
                "Do not infer PASS without structure and/or evidence support.",
                "Use ENVIRONMENTAL only for external blockers.",
                "Use DISPUTED only when the available evidence is internally conflicting.",
            ],
        },
    }

    save_json(_input_bundle_path(root), bundle)
    return bundle


def validate_prosecution_results(payload: dict[str, Any], manifest: dict[str, Any]) -> List[str]:
    errors: List[str] = []

    if not isinstance(payload, dict):
        return ["Result payload must be a JSON object"]

    results = payload.get("results")
    if not isinstance(results, list):
        return ["Result payload must contain a results array"]

    declared_ids = {item["manifest_id"] for item in collect_declared_items(manifest)}
    seen_ids = set()

    for row in results:
        if not isinstance(row, dict):
            errors.append("Each result row must be an object")
            continue

        manifest_id = str(row.get("manifest_id", "")).strip()
        verdict = str(row.get("verdict", "")).strip().upper()
        confidence = str(row.get("confidence", "")).strip().upper()

        if not manifest_id:
            errors.append("Each result row must include manifest_id")
            continue

        if manifest_id not in declared_ids:
            errors.append(f"Undeclared manifest_id in prosecution results: {manifest_id}")

        if manifest_id in seen_ids:
            errors.append(f"Duplicate prosecution result for manifest_id: {manifest_id}")
        seen_ids.add(manifest_id)

        if verdict not in VALID_VERDICTS:
            errors.append(f"Invalid verdict for {manifest_id}: {verdict}")

        if confidence not in VALID_CONFIDENCE:
            errors.append(f"Invalid confidence for {manifest_id}: {confidence}")

        if not str(row.get("reason", "")).strip():
            errors.append(f"Missing reason for {manifest_id}")

        evidence_referenced = row.get("evidence_referenced")
        if evidence_referenced is not None and not isinstance(evidence_referenced, list):
            errors.append(f"evidence_referenced must be an array for {manifest_id}")

        requires_arbitration = row.get("requires_arbitration")
        if requires_arbitration is not None and not isinstance(requires_arbitration, bool):
            errors.append(f"requires_arbitration must be boolean for {manifest_id}")

    return errors


def import_prosecution_results(root: Path, prosecutor: str, payload: dict[str, Any]) -> Path:
    prosecutor = prosecutor.upper().strip()
    if prosecutor not in {"A", "B"}:
        raise ValueError("prosecutor must be A or B")

    output = {
        "report_name": f"PROSECUTION_RESULTS_{prosecutor}",
        "generated_utc": utc_now_iso(),
        "source_prosecutor": prosecutor,
        "results": payload.get("results", []),
    }

    path = _results_a_path(root) if prosecutor == "A" else _results_b_path(root)
    save_json(path, output)
    return path


def compare_prosecution_results(root: Path) -> dict[str, Any]:
    a_payload = load_json(_results_a_path(root), default={}) or {}
    b_payload = load_json(_results_b_path(root), default={}) or {}

    a_rows = {row.get("manifest_id"): row for row in (a_payload.get("results") or []) if isinstance(row, dict)}
    b_rows = {row.get("manifest_id"): row for row in (b_payload.get("results") or []) if isinstance(row, dict)}

    all_ids = sorted(set(a_rows.keys()) | set(b_rows.keys()))

    agreements: List[dict[str, Any]] = []
    disagreements: List[dict[str, Any]] = []
    missing_from_a: List[str] = []
    missing_from_b: List[str] = []

    for manifest_id in all_ids:
        a_row = a_rows.get(manifest_id)
        b_row = b_rows.get(manifest_id)

        if a_row is None:
            missing_from_a.append(manifest_id)
            continue
        if b_row is None:
            missing_from_b.append(manifest_id)
            continue

        a_verdict = str(a_row.get("verdict", "")).upper()
        b_verdict = str(b_row.get("verdict", "")).upper()

        if a_verdict == b_verdict:
            agreements.append(
                {
                    "manifest_id": manifest_id,
                    "verdict": a_verdict,
                    "a_confidence": a_row.get("confidence"),
                    "b_confidence": b_row.get("confidence"),
                }
            )
        else:
            disagreements.append(
                {
                    "manifest_id": manifest_id,
                    "a_verdict": a_verdict,
                    "b_verdict": b_verdict,
                    "a_reason": a_row.get("reason"),
                    "b_reason": b_row.get("reason"),
                    "requires_arbitration": True,
                }
            )

    verdict = "PASS"
    if disagreements or missing_from_a or missing_from_b:
        verdict = "FAIL"

    comparison = {
        "report_name": "PROSECUTION_COMPARISON",
        "generated_utc": utc_now_iso(),
        "verdict": verdict,
        "agreements": agreements,
        "disagreements": disagreements,
        "missing_from_a": missing_from_a,
        "missing_from_b": missing_from_b,
        "summary": {
            "agreement_count": len(agreements),
            "disagreement_count": len(disagreements),
            "missing_from_a_count": len(missing_from_a),
            "missing_from_b_count": len(missing_from_b),
        },
    }

    save_json(_comparison_path(root), comparison)
    return comparison
