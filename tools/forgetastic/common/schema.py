# tools/forgetastic/common/schema.py

from __future__ import annotations

import re
from typing import List


# Validation patterns (MUST match exactly)
MANIFEST_ID_PATTERN = re.compile(r"^[A-Z]{3}-\d{3}$")  # e.g., BHV-001
PROOF_TYPE_VALUES = {"MANUAL", "CLI", "TEST", "API", "UI", "INTEGRATION", "BETA_TEST"}
ENVIRONMENT_VALUES = {"LOCAL", "DEV", "STAGING", "PROD", "ANY"}
PROOF_STATUS_VALUES = {"PASS", "FAIL", "ENVIRONMENTAL"}
CONFIDENCE_RANGE = range(1, 7)  # 1 (strongest) to 6 (weakest)
MODE_VALUES = {"LITE", "STANDARD", "FULL", "REGULATED"}
SEVERITY_VALUES = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "MINOR"}


def validate_manifest_id(value: str) -> tuple[bool, str]:
    """
    Validate manifest ID format.
    Returns: (is_valid, error_message)
    """
    value = str(value).strip()
    if not value:
        return False, "manifest_id is required"
    if not MANIFEST_ID_PATTERN.match(value):
        return False, f"manifest_id must match pattern XXX-### (e.g., BHV-001), got: {value}"
    return True, ""


def validate_proof_type(value: str) -> tuple[bool, str]:
    """Validate proof type is one of allowed values."""
    value = str(value).strip().upper()
    if value not in PROOF_TYPE_VALUES:
        return False, f"proof_type must be one of {PROOF_TYPE_VALUES}, got: {value}"
    return True, ""


def validate_environment(value: str) -> tuple[bool, str]:
    """Validate environment is one of allowed values."""
    value = str(value).strip().upper()
    if value not in ENVIRONMENT_VALUES:
        return False, f"environment must be one of {ENVIRONMENT_VALUES}, got: {value}"
    return True, ""


def validate_status(value: str) -> tuple[bool, str]:
    """Validate proof status."""
    value = str(value).strip().upper()
    if value not in PROOF_STATUS_VALUES:
        return False, f"status must be one of {PROOF_STATUS_VALUES}, got: {value}"
    return True, ""


def validate_confidence_level(value: int) -> tuple[bool, str]:
    """Validate confidence level (1-6)."""
    try:
        value = int(value)
    except (ValueError, TypeError):
        return False, f"confidence_level must be integer 1-6, got: {value}"
    if value not in CONFIDENCE_RANGE:
        return False, f"confidence_level must be 1-6, got: {value}"
    return True, ""


def validate_artifact_path(path: str) -> tuple[bool, str]:
    """
    Validate artifact path (prevent path traversal).
    MUST NOT contain: ../ or absolute paths or backslashes.
    """
    path = str(path).strip()
    if not path:
        return False, "artifact path is empty"

    # Reject absolute paths
    if path.startswith("/") or (len(path) > 1 and path[1] == ":"):
        return False, f"artifact path must be relative (no absolute paths), got: {path}"

    # Reject parent directory traversal
    if ".." in path:
        return False, f"artifact path must not contain '..', got: {path}"

    # Warn on backslashes (Windows paths should use forward slashes)
    if "\\" in path:
        return False, f"artifact path must use forward slashes, got: {path}"

    return True, ""


def validate_artifact_paths(paths: list) -> tuple[bool, str]:
    """Validate list of artifact paths."""
    if not isinstance(paths, list):
        return False, f"artifact_paths must be list, got: {type(paths)}"

    for i, path in enumerate(paths):
        is_valid, error = validate_artifact_path(path)
        if not is_valid:
            return False, f"artifact_paths[{i}]: {error}"

    return True, ""


def validate_runner_name(value: str) -> tuple[bool, str]:
    """Validate runner name (no weird characters)."""
    value = str(value).strip()
    if not value:
        return False, "runner is required"
    if len(value) > 100:
        return False, f"runner name too long (max 100 chars), got: {len(value)}"
    if not re.match(r"^[a-zA-Z0-9_\-\. ]+$", value):
        return False, f"runner name contains invalid characters, got: {value}"
    return True, ""


def validate_string_field(value: str, field_name: str, max_length: int = 10000) -> tuple[bool, str]:
    """Generic string field validator."""
    value = str(value).strip()
    if not value:
        return False, f"{field_name} is required"
    if len(value) > max_length:
        return False, f"{field_name} exceeds max length {max_length}, got: {len(value)}"
    return True, ""
