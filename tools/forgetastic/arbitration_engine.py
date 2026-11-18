# tools/forgetastic/arbitration_engine.py (Forgetastic Pro 1-Build this in Cursor-2.md BUILD 9 FILE 1)

from __future__ import annotations

from pathlib import Path
from typing import Any, List

from .common import load_json, save_json, utc_now_iso


ARBITRATION_INPUT_PATH = Path("forge/prosecution/ARBITRATION_INPUT.json")
ARBITRATION_RESULT_PATH = Path("forge/prosecution/ARBITRATION_RESULT.json")


VALID_VERDICTS = {"PASS", "FAIL", "OVERRULE_A", "OVERRULE_B"}


def _input_path(root: Path) -> Path:
    return root / ARBITRATION_INPUT_PATH


def _result_path(root: Path) -> Path:
    return root / ARBITRATION_RESULT_PATH


def build_arbitration_input(root: Path) -> dict:
    comparison = load_json(root / "forge/prosecution/PROSECUTION_COMPARISON.json", default={}) or {}

    disputes = comparison.get("disagreements", []) or []

    bundle = {
        "bundle_name": "ARBITRATION_INPUT",
        "generated_utc": utc_now_iso(),
        "disputes": disputes,
        "instructions": {
            "goal": "Resolve disagreements between Prosecutor A and B.",
            "allowed_verdicts": list(VALID_VERDICTS),
            "rules": [
                "Decide based on evidence and structure only.",
                "Do not invent new behavior.",
                "Each dispute must have exactly one final verdict.",
            ],
        },
    }

    save_json(_input_path(root), bundle)
    return bundle


def validate_arbitration_result(payload: dict) -> List[str]:
    errors: List[str] = []

    if not isinstance(payload, dict):
        return ["Payload must be JSON object"]

    results = payload.get("results")
    if not isinstance(results, list):
        return ["Missing results array"]

    for row in results:
        if not isinstance(row, dict):
            errors.append("Each result row must be an object")
            continue
        verdict = str(row.get("verdict", "")).upper()
        if verdict not in VALID_VERDICTS:
            errors.append(f"Invalid verdict: {verdict}")

        if not row.get("manifest_id"):
            errors.append("Missing manifest_id")

        if not row.get("reason"):
            errors.append("Missing reason")

    return errors


def import_arbitration_result(root: Path, payload: dict) -> dict:
    result = {
        "report_name": "ARBITRATION_RESULT",
        "generated_utc": utc_now_iso(),
        "results": payload.get("results", []),
    }

    save_json(_result_path(root), result)
    return result
