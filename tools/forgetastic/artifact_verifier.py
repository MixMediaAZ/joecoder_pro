# tools/forgetastic/artifact_verifier.py (BUILD 11)

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .common import save_json, utc_now_iso

REPORT_PATH = Path("forge/reports/ARTIFACT_VERIFICATION.json")


def verify_artifacts(root: Path) -> dict[str, Any]:
    proof_rows_path = root / "forge" / "evidence" / "RUNTIME_PROOF.jsonl"

    missing: list[dict[str, Any]] = []
    checked = 0

    if proof_rows_path.exists():
        with proof_rows_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line.strip())
                except json.JSONDecodeError as e:
                    raise ValueError(f"Corrupt proof line in {proof_rows_path}: {e}")

                artifact_paths = row.get("artifact_paths", []) or []
                artifact_hashes = row.get("artifact_hashes", []) or []

                for idx, artifact in enumerate(artifact_paths):
                    checked += 1
                    full = root / artifact
                    if not full.exists():
                        missing.append({
                            "artifact": artifact,
                            "proof_id": row.get("proof_id"),
                            "reason": "file not found",
                        })
                    elif idx < len(artifact_hashes):
                        expected_hash = artifact_hashes[idx]
                        try:
                            content = full.read_bytes()
                            actual_hash = f"sha256:{hashlib.sha256(content).hexdigest()}"
                            if actual_hash != expected_hash:
                                missing.append({
                                    "artifact": artifact,
                                    "proof_id": row.get("proof_id"),
                                    "reason": f"hash mismatch: expected {expected_hash} got {actual_hash}",
                                })
                        except (OSError, IOError) as e:
                            missing.append({
                                "artifact": artifact,
                                "proof_id": row.get("proof_id"),
                                "reason": f"cannot read file: {e}",
                            })

    report: dict[str, Any] = {
        "report_name": "ARTIFACT_VERIFICATION",
        "generated_utc": utc_now_iso(),
        "checked_count": checked,
        "missing_count": len(missing),
        "missing": missing,
        "verdict": "PASS" if not missing else "FAIL",
    }

    save_json(root / REPORT_PATH, report)
    return report
