# tools/forgetastic/ledger_engine.py (BUILD 14 — execution attestation / event chain with hash-chaining)

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import append_jsonl, read_jsonl, sha256_dict, utc_now_iso

SESSION_LOG_PATH = Path("forge/state/SESSION_LOG.jsonl")
STANDARD_EVENTS_PATH = Path("forge/ledger/STANDARD_EVENTS.jsonl")


def record_standard_event(root: Path, event_type: str, actor: str, payload: dict[str, Any]) -> None:
    """Append a structured operator event for audit trail with previous_hash for chain integrity."""
    path = root / STANDARD_EVENTS_PATH

    # Compute hash of previous row for chain integrity
    previous_hash = None
    if path.exists():
        valid_rows, _ = read_jsonl(path)
        if valid_rows:
            last_row = valid_rows[-1]
            previous_hash = sha256_dict(last_row)

    row = {
        "event_type": event_type,
        "actor": actor,
        "payload": payload,
        "timestamp_utc": utc_now_iso(),
        "previous_hash": previous_hash,
    }
    append_jsonl(path, row)


def verify_event_chain(root: Path) -> dict[str, Any]:
    """
    Verify append-only JSONL integrity with hash-chain validation (fail-closed).

    Enforces that ALL rows (after first) MUST have previous_hash field.
    Checks: JSON parseability, hash-chain continuity.
    Returns verdict FAIL if any row lacks required fields or chain breaks detected.
    """
    corrupt = 0
    chain_breaks = []

    for rel in (SESSION_LOG_PATH, STANDARD_EVENTS_PATH):
        path = root / rel
        if not path.exists():
            continue

        valid_rows, errors = read_jsonl(path)
        corrupt += len(errors)

        # Check hash-chain continuity: ALL rows must have previous_hash field
        # (fail-closed: no skipping rows without the field)
        for idx, row in enumerate(valid_rows):
            if idx == 0:
                # First row should have previous_hash=None
                if row.get("previous_hash") is not None:
                    chain_breaks.append(f"{rel}:row 0 has non-null previous_hash")
            else:
                # Non-first rows MUST have previous_hash field (fail-closed)
                if "previous_hash" not in row:
                    chain_breaks.append(
                        f"{rel}:row {idx} missing required previous_hash field (chain link required)"
                    )
                    continue

                # Verify this row's previous_hash matches hash of previous row
                prev_row = valid_rows[idx - 1]
                expected_prev_hash = sha256_dict(prev_row)
                actual_prev_hash = row.get("previous_hash")
                if expected_prev_hash != actual_prev_hash:
                    chain_breaks.append(
                        f"{rel}:row {idx} previous_hash mismatch (expected {expected_prev_hash[:8]}..., got {actual_prev_hash[:8] if actual_prev_hash else 'None'}...)"
                    )

    if corrupt or chain_breaks:
        return {
            "verdict": "FAIL",
            "message": f"Event chain verification failed: {corrupt} corrupt lines, {len(chain_breaks)} hash-chain breaks",
            "corrupt_line_count": corrupt,
            "chain_breaks": chain_breaks,
        }
    return {"verdict": "PASS", "message": "event chain readable and hash-chained"}
