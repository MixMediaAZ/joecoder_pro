"""Default POLICY.json for BUILD 6 drift thresholds (Forgetastic Pro 1-Build this in Cursor-2.md)."""

from __future__ import annotations

from typing import Any


def default_policy() -> dict[str, Any]:
    return {
        "policy_version": "1",
        "runtime_proof_requirements": {
            "CRITICAL": {"stale_after_days": 7},
            "HIGH": {"stale_after_days": 14},
            "MAJOR": {"stale_after_days": 14},
            "MEDIUM": {"stale_after_days": 30},
            "LOW": {"stale_after_days": 90},
            "MINOR": {"stale_after_days": 180},
        },
        "truth_policy": {
            "max_override_count": 3,
            "required_proof_tier_default": 3,
            "required_proof_tier_critical": 4,
            "proof_ttl_hours_default": 24,
            "proof_ttl_hours_critical": 12,
            "require_prosecutor_a": True,
            "require_prosecutor_b": True,
            "require_arbitration_if_disputed": True,
            "determinism_runs": 3,
        },
        "event_signing_secret": "REPLACE-IN-PROD",
        "trusted_verifier_hash": "",
    }
