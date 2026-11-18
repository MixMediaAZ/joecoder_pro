# tools/forgetastic/evidence_engine.py

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, List

from .common import (
    load_json, save_json, validate_manifest_id, validate_proof_type,
    validate_environment, validate_status, validate_confidence_level,
    validate_artifact_paths, validate_runner_name, validate_string_field,
    get_logger, read_jsonl, append_jsonl, utc_now_iso
)
from .common.hashing import sha256_dict, hmac_sha256, sha256_file
from .result_parser import parse_junit_xml, parse_coverage_xml

log = get_logger("evidence")

RUNTIME_PROOF_JSONL = Path("forge/evidence/RUNTIME_PROOF.jsonl")
EVIDENCE_INDEX_JSON = Path("forge/evidence/EVIDENCE_INDEX.json")


def collect_manifest_ids(manifest: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for section in ("users", "behaviors", "failures", "integrations", "out_of_scope", "assumptions"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id")
            if item_id:
                ids.add(item_id)
    return ids


def collect_required_manifest_ids(manifest: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            item_id = item.get("id")
            if item_id and bool(item.get("required", True)):
                ids.add(item_id)
    return ids


def read_runtime_proof_rows(root: Path) -> List[dict[str, Any]]:
    """READ 13: All valid rows from RUNTIME_PROOF.jsonl in file order, with chain verification (fail-closed).

    Raises ValueError if proof chain integrity check fails.
    """
    proof_jsonl = root / RUNTIME_PROOF_JSONL
    valid_rows, _ = read_jsonl(proof_jsonl)

    # Verify proof chain integrity (fail-closed: raise exception on failure)
    chain_valid, error_msg, break_line = verify_proof_chain(root)
    if not chain_valid:
        raise ValueError(f"Proof chain integrity check failed at line {break_line}: {error_msg}")

    return valid_rows


def latest_proof_by_manifest_id(root: Path) -> Dict[str, dict[str, Any]]:
    proof_jsonl = root / RUNTIME_PROOF_JSONL
    valid_rows, _ = read_jsonl(proof_jsonl)
    latest: Dict[str, dict[str, Any]] = {}
    for row in valid_rows:
        manifest_id = row.get("manifest_id")
        if not manifest_id:
            continue
        latest[manifest_id] = row
    return latest


def parse_utc_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def proof_age_days(timestamp_utc: str | None) -> float | None:
    parsed = parse_utc_timestamp(timestamp_utc)
    if not parsed:
        return None
    delta = datetime.now(UTC) - parsed
    return delta.total_seconds() / 86400.0


def _validate_artifact_content(
    root: Path, artifact_path: str, expected_hash: str | None = None
) -> tuple[bool, str]:
    """
    Validate artifact file content (fail-closed).

    Checks:
    1. File exists and is non-empty (size > 0)
    2. File hash matches expected hash (if provided)
    3. For JUnit XML: validates schema by parsing
    4. For coverage XML: validates schema by parsing

    Returns:
        (is_valid, error_message) tuple
    """
    full_path = root / artifact_path


    # Check file exists
    if not full_path.exists():
        return False, f"Artifact {artifact_path} does not exist"

    # Check file is non-empty
    try:
        file_size = full_path.stat().st_size
        if file_size == 0:
            return False, f"Artifact {artifact_path} is empty (size 0)"
    except OSError as e:
        return False, f"Cannot stat artifact {artifact_path}: {e}"

    # Check hash if provided
    if expected_hash:
        try:
            actual_hash = sha256_file(full_path)
            # expected_hash might be in format "sha256:hexdigest" or just "hexdigest"
            expected_hex = expected_hash.split(":", 1)[1] if ":" in expected_hash else expected_hash
            if actual_hash != expected_hex:
                return False, f"Hash mismatch for {artifact_path} (expected {expected_hex[:8]}..., got {actual_hash[:8]}...)"
        except Exception as e:
            return False, f"Cannot compute hash for {artifact_path}: {e}"

    # Validate XML schema for known XML artifact types
    if artifact_path.endswith("junit.xml") or "junit" in artifact_path.lower():
        try:
            metrics = parse_junit_xml(full_path)
            if metrics is None:
                return False, f"JUnit XML {artifact_path} failed to parse (invalid schema)"
        except Exception as e:
            return False, f"JUnit XML {artifact_path} validation failed: {e}"

    elif artifact_path.endswith("coverage.xml") or "coverage" in artifact_path.lower():
        try:
            metrics = parse_coverage_xml(full_path)
            if metrics is None:
                return False, f"Coverage XML {artifact_path} failed to parse (invalid schema)"
        except Exception as e:
            return False, f"Coverage XML {artifact_path} validation failed: {e}"

    return True, ""


def compute_artifact_hashes(root: Path, artifact_paths: list[str]) -> list[str]:
    """Compute SHA256 hash for each artifact file.

    Returns list of "sha256:hexdigest" strings in same order as artifact_paths.
    Raises ValueError if artifact cannot be read.
    """
    hashes = []
    for artifact in artifact_paths:
        full_path = root / artifact
        if not full_path.exists():
            raise ValueError(f"Artifact {artifact} does not exist")
        try:
            content = full_path.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            hashes.append(f"sha256:{digest}")
        except (OSError, IOError) as e:
            raise ValueError(f"Cannot read artifact {artifact}: {e}")
    return hashes


def create_proof_entry(
    root: Path,
    manifest_id: str,
    proof_type: str,
    environment: str,
    runner: str,
    command_text: str,
    input_summary: str,
    expected_summary: str,
    actual_summary: str,
    status: str,
    artifact_paths: list[str],
    confidence_level: int,
    session_id: str = "",
) -> dict[str, Any]:
    """
    Create and validate a proof entry with cryptographic binding.

    Raises ValueError if any field is invalid.
    """

    # Validate all fields
    is_valid, error = validate_manifest_id(manifest_id)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_proof_type(proof_type)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_environment(environment)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_status(status)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_confidence_level(confidence_level)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_artifact_paths(artifact_paths)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_runner_name(runner)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_string_field(command_text, "command_text", max_length=5000)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_string_field(input_summary, "input_summary", max_length=1000)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_string_field(expected_summary, "expected_summary", max_length=1000)
    if not is_valid:
        raise ValueError(error)

    is_valid, error = validate_string_field(actual_summary, "actual_summary", max_length=1000)
    if not is_valid:
        raise ValueError(error)

    # Compute artifact hashes for integrity verification
    artifact_hashes = compute_artifact_hashes(root, artifact_paths)

    # Generate proof ID
    proof_id = str(uuid.uuid4())[:8].upper()
    timestamp_utc = utc_now_iso()

    # Compute command hash (SHA256 of command text)
    command_hash = hashlib.sha256(command_text.encode("utf-8")).hexdigest()

    # Create artifact binding array
    artifact_binding = []
    for artifact_path, artifact_hash in zip(artifact_paths, artifact_hashes):
        # artifact_hash is "sha256:hexdigest"; extract just the hexdigest
        hash_value = artifact_hash.split(":", 1)[1] if ":" in artifact_hash else artifact_hash
        artifact_binding.append({
            "artifact_path": artifact_path,
            "sha256": hash_value,
            "source_command_hash": command_hash,
        })

    # Compute evidence hash (includes command and artifact binding)
    hash_input = {
        "manifest_id": manifest_id,
        "proof_type": proof_type,
        "environment": environment,
        "input_summary": input_summary,
        "expected_summary": expected_summary,
        "actual_summary": actual_summary,
        "status": status,
        "artifact_paths": artifact_paths,
        "command_hash": command_hash,
        "artifact_binding": artifact_binding,
    }
    evidence_hash = sha256_dict(hash_input)

    # Get signing secret from POLICY.json
    policy_file = root / "forge/policy/POLICY.json"
    policy = load_json(policy_file) or {}
    signing_secret = policy.get("event_signing_secret", "REPLACE-IN-PROD")

    # Compute proof signature (HMAC-SHA256)
    signature_input = f"{evidence_hash}:{proof_id}:{timestamp_utc}"
    proof_signature = hmac_sha256(signature_input, signing_secret)

    # Get previous proof hash for chain integrity
    previous_proof_hash = None
    proof_rows = read_runtime_proof_rows(root)
    if proof_rows:
        last_row = proof_rows[-1]
        if "proof_signature" in last_row:
            previous_proof_hash = last_row["proof_signature"]

    return {
        "proof_id": proof_id,
        "manifest_id": manifest_id,
        "proof_type": proof_type,
        "environment": environment,
        "runner": runner,
        "command": command_text,
        "command_hash": command_hash,
        "timestamp_utc": timestamp_utc,
        "input_summary": input_summary,
        "expected_summary": expected_summary,
        "actual_summary": actual_summary,
        "status": status,
        "artifact_paths": artifact_paths,
        "artifact_hashes": artifact_hashes,
        "artifact_binding": artifact_binding,
        "confidence_level": confidence_level,
        "evidence_hash": evidence_hash,
        "proof_signature": proof_signature,
        "previous_proof_hash": previous_proof_hash,
        "session_id": session_id or "",
    }


def append_proof(root: Path, entry: dict[str, Any]) -> None:
    """Append proof entry to JSONL file."""
    proof_jsonl = root / RUNTIME_PROOF_JSONL
    append_jsonl(proof_jsonl, entry)
    log.info(f"Proof recorded: {entry['proof_id']} for {entry['manifest_id']}")


def verify_proof_signature(root: Path, proof: dict[str, Any]) -> tuple[bool, str]:
    """
    Verify proof signature integrity.

    Recomputes expected signature and compares with stored signature.

    Args:
        root: Project root
        proof: Proof record to verify

    Returns:
        (is_valid, error_message)
    """
    if "proof_signature" not in proof:
        return False, "Proof missing proof_signature field"

    if "evidence_hash" not in proof or "proof_id" not in proof or "timestamp_utc" not in proof:
        return False, "Proof missing required fields for signature verification"

    # Load signing secret
    policy_file = root / "forge/policy/POLICY.json"
    policy = load_json(policy_file) or {}
    signing_secret = policy.get("event_signing_secret", "REPLACE-IN-PROD")

    # Recompute signature
    signature_input = f"{proof['evidence_hash']}:{proof['proof_id']}:{proof['timestamp_utc']}"
    expected_signature = hmac_sha256(signature_input, signing_secret)

    if expected_signature != proof["proof_signature"]:
        return False, f"Signature mismatch: expected {expected_signature}, got {proof['proof_signature']}"

    return True, ""


def verify_proof_chain(root: Path) -> tuple[bool, str, int]:
    """
    Verify RUNTIME_PROOF.jsonl chain integrity (fail-closed).

    Enforces that ALL non-first proofs MUST have previous_proof_hash field.
    Each proof's previous_proof_hash must match the previous proof's proof_signature.

    Args:
        root: Project root

    Returns:
        (is_valid, error_message, first_break_line) where first_break_line is 1-indexed
    """
    proof_jsonl = root / RUNTIME_PROOF_JSONL
    valid_rows, _ = read_jsonl(proof_jsonl)

    if not valid_rows:
        return True, "", 0

    # Verify chain: each entry's previous_proof_hash should match previous entry's proof_signature
    for i, proof in enumerate(valid_rows):
        if i == 0:
            # First entry should have previous_proof_hash = null
            if proof.get("previous_proof_hash") is not None:
                return False, f"First proof entry has non-null previous_proof_hash", i + 1
        else:
            # Non-first entries MUST have previous_proof_hash field (fail-closed)
            if "previous_proof_hash" not in proof:
                return (
                    False,
                    f"Chain break at entry {i+1}: missing required previous_proof_hash field (chain link required)",
                    i + 1,
                )

            prev_proof = valid_rows[i - 1]
            expected_previous_hash = prev_proof.get("proof_signature")
            actual_previous_hash = proof.get("previous_proof_hash")

            if expected_previous_hash != actual_previous_hash:
                return (
                    False,
                    f"Chain break at entry {i+1}: previous_proof_hash "
                    f"(expected {expected_previous_hash}, got {actual_previous_hash})",
                    i + 1,
                )

    return True, "", 0


def auto_prove_from_beta_test(
    root: Path,
    manifest_id: str,
    beta_result: dict[str, Any],
    determinism_result: dict[str, Any],
) -> dict[str, Any]:
    """
    Auto-generate proof record from beta test execution.

    This function bridges CI-driven test execution to proof ledger.
    It is called automatically after successful determinism verification.

    Args:
        root: Project root
        manifest_id: Behavior ID (BHV-XXX)
        beta_result: Results from run_beta_test()
        determinism_result: Results from run_determinism_test()

    Returns:
        Dict with proof_id, status, and any errors
    """
    try:
        # Extract command from beta result (should be in first test suite)
        command_text = ""
        if beta_result.get("test_suites") and len(beta_result["test_suites"]) > 0:
            command_text = beta_result["test_suites"][0].get("command", "")

        if not command_text:
            return {
                "proof_id": None,
                "status": "FAILED",
                "error": "Could not extract command from beta test result",
            }

        # Determine status based on determinism
        determ_verdict = determinism_result.get("verdict", "FAIL")
        proof_status = "PASS" if (determ_verdict == "PASS" and not beta_result.get("blocking_issues")) else "FAIL"

        # Build input/expected/actual summaries
        input_summary = f"Beta test run for {manifest_id}"
        expected_summary = f"All test suites pass with {int(beta_result.get('total_coverage_percent', 0))}% coverage"
        actual_summary = (
            f"{beta_result.get('total_tests', 0)} tests: "
            f"{beta_result.get('total_passed', 0)} passed, "
            f"{beta_result.get('total_failed', 0)} failed, "
            f"{int(beta_result.get('total_coverage_percent', 0))}% coverage"
        )

        # Determine confidence tier based on coverage and test count
        test_count = beta_result.get("total_tests", 0)
        coverage = beta_result.get("total_coverage_percent", 0.0)
        confidence_level = 1
        if test_count == 0:
            confidence_level = 6
        elif coverage < 50:
            confidence_level = 5
        elif coverage < 80:
            confidence_level = 4
        elif coverage < 90:
            confidence_level = 3
        else:
            confidence_level = 2 if test_count > 10 else 3

        # Get list of artifact paths from test suites
        artifact_paths = []
        for suite in beta_result.get("test_suites", []):
            if suite.get("junit_xml_path"):
                artifact_paths.append(suite["junit_xml_path"])
            if suite.get("coverage_xml_path"):
                artifact_paths.append(suite["coverage_xml_path"])

        # Create proof entry with full binding
        proof_entry = create_proof_entry(
            root=root,
            manifest_id=manifest_id,
            proof_type="BETA_TEST",
            environment=beta_result.get("environment", "STAGING"),
            runner="forgetastic-beta",
            command_text=command_text,
            input_summary=input_summary,
            expected_summary=expected_summary,
            actual_summary=actual_summary,
            status=proof_status,
            artifact_paths=artifact_paths,
            confidence_level=confidence_level,
        )

        # Append to ledger
        append_proof(root, proof_entry)

        return {
            "proof_id": proof_entry.get("proof_id"),
            "status": "SUCCESS",
            "error": None,
        }

    except Exception as e:
        log.error(f"Auto-proof generation failed for {manifest_id}: {e}")
        return {
            "proof_id": None,
            "status": "FAILED",
            "error": str(e),
        }


def build_evidence_index(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Build index of all proofs by manifest ID."""
    proof_jsonl = root / RUNTIME_PROOF_JSONL
    valid_rows, error_rows = read_jsonl(proof_jsonl)

    if error_rows:
        log.warning(f"Evidence index: {len(error_rows)} corrupted lines skipped")

    # Get all required IDs from manifest
    required_ids = set()
    for section in ("behaviors", "failures", "integrations"):
        for item in manifest.get(section, []) or []:
            if item.get("required", True) and item.get("id"):
                required_ids.add(item["id"])

    # Index by manifest_id
    by_id = {}
    for manifest_id in required_ids:
        proofs = [r for r in valid_rows if r.get("manifest_id") == manifest_id]
        latest = proofs[-1] if proofs else None
        by_id[manifest_id] = {
            "count": len(proofs),
            "latest_status": latest.get("status") if latest else None,
            "latest_timestamp": latest.get("timestamp_utc") if latest else None,
        }

    missing = [mid for mid, data in by_id.items() if data["count"] == 0]

    index = {
        "total_proofs": len(valid_rows),
        "required_ids_count": len(required_ids),
        "missing_proofs": missing,
        "missing_required_ids": missing,
        "by_id": by_id,
        "by_manifest_id": by_id,
        "generated_utc": utc_now_iso(),
    }

    save_json(root / EVIDENCE_INDEX_JSON, index)
    return index
