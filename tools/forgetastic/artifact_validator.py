# tools/forgetastic/artifact_validator.py (Validate Artifact Content & Integrity)

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional

from .common import sha256_file, get_logger
from .result_parser import parse_junit_xml, parse_coverage_xml

log = get_logger("artifact_validator")


@dataclass(frozen=True)
class ArtifactValidation:
    """Result of validating an artifact."""
    verdict: str  # PASS, FAIL, WARN
    path: str
    exists: bool
    is_empty: bool
    size_bytes: int
    hash_sha256: str
    hash_matches: bool  # True if matches expected_hash
    is_recent: bool  # True if newer than min_timestamp
    age_seconds: float
    format_valid: bool  # True if JUnit/coverage XML parses
    content_summary: dict[str, Any]  # Format-specific summary
    issues: list[str]


def validate_artifact(
    artifact_path: Path,
    expected_hash: Optional[str] = None,
    min_timestamp_utc: Optional[str] = None,
    format_type: str = "junit",  # "junit", "coverage", "generic"
) -> ArtifactValidation:
    """
    Validate an artifact file comprehensively.

    Checks:
    1. File exists
    2. File is not empty
    3. Hash matches expected (if provided)
    4. File is recent (if min_timestamp provided)
    5. Content is valid for format (if format_type specified)
    6. For JUnit: has tests and passes
    7. For Coverage: has coverage data

    Args:
        artifact_path: Path to artifact file
        expected_hash: Expected SHA256 hash (optional)
        min_timestamp_utc: Minimum file timestamp as ISO string (optional)
        format_type: Format for semantic validation ("junit", "coverage", "generic")

    Returns:
        ArtifactValidation with detailed verdict
    """
    issues: list[str] = []
    exists = artifact_path.exists()
    is_empty = False
    size_bytes = 0
    hash_sha256 = ""
    hash_matches = True
    is_recent = True
    age_seconds = 0.0
    format_valid = False
    content_summary: dict[str, Any] = {}

    # Check: existence
    if not exists:
        issues.append(f"Artifact does not exist: {artifact_path}")
        return ArtifactValidation(
            verdict="FAIL",
            path=str(artifact_path),
            exists=False,
            is_empty=False,
            size_bytes=0,
            hash_sha256="",
            hash_matches=False,
            is_recent=False,
            age_seconds=0.0,
            format_valid=False,
            content_summary={},
            issues=issues,
        )

    # Check: empty
    size_bytes = artifact_path.stat().st_size
    is_empty = size_bytes == 0
    if is_empty:
        issues.append("Artifact is empty (zero bytes)")

    # Check: hash
    hash_sha256 = sha256_file(artifact_path)
    if expected_hash:
        hash_matches = hash_sha256 == expected_hash
        if not hash_matches:
            issues.append(f"Hash mismatch: expected {expected_hash}, got {hash_sha256}")

    # Check: timestamp
    if min_timestamp_utc:
        try:
            min_dt = datetime.fromisoformat(min_timestamp_utc.replace("Z", "+00:00")).astimezone(UTC)
            file_dt = datetime.fromtimestamp(artifact_path.stat().st_mtime, tz=UTC)
            age_seconds = (datetime.now(UTC) - file_dt).total_seconds()
            is_recent = file_dt >= min_dt

            if not is_recent:
                diff = (min_dt - file_dt).total_seconds() / 3600
                issues.append(f"Artifact is {diff:.1f}h older than minimum timestamp {min_timestamp_utc}")
        except ValueError as e:
            issues.append(f"Failed to parse timestamp: {e}")

    # Check: format validity
    if not is_empty:
        if format_type == "junit":
            metrics = parse_junit_xml(artifact_path)
            if metrics:
                format_valid = True
                content_summary = {
                    "total_tests": metrics.total_tests,
                    "passed": metrics.passed,
                    "failed": metrics.failed,
                    "skipped": metrics.skipped,
                    "errors": metrics.errors,
                    "execution_time": metrics.execution_time_seconds,
                }

                # Semantic checks: no tests
                if metrics.total_tests == 0:
                    issues.append("JUnit result has no tests (empty test run)")
                # Semantic checks: all tests failed
                elif metrics.failed > 0:
                    issues.append(f"{metrics.failed} test(s) failed")
                # Semantic checks: too many skipped
                elif metrics.skipped == metrics.total_tests:
                    issues.append("All tests are skipped")
            else:
                issues.append("Failed to parse JUnit XML")

        elif format_type == "coverage":
            coverage = parse_coverage_xml(artifact_path)
            if coverage:
                format_valid = True
                content_summary = {
                    "line_coverage_percent": coverage.line_rate * 100,
                    "branch_coverage_percent": coverage.branch_rate * 100,
                    "lines_covered": coverage.lines_covered,
                    "lines_valid": coverage.lines_valid,
                }

                # Semantic checks: no coverage data
                if coverage.lines_valid == 0:
                    issues.append("Coverage report has no line data")
                # Semantic checks: zero coverage
                elif coverage.line_rate == 0:
                    issues.append("Coverage is 0% (no lines covered)")
            else:
                issues.append("Failed to parse coverage XML")

        else:  # generic
            format_valid = True
            content_summary = {
                "size_bytes": size_bytes,
                "hash": hash_sha256[:16] + "...",
            }

    # Determine verdict
    verdict = "PASS"
    if is_empty:
        verdict = "FAIL"
    elif issues:
        # Check if any issue is critical
        critical_issues = [
            i for i in issues
            if any(keyword in i.lower() for keyword in ["failed", "zero bytes", "does not exist", "hash mismatch"])
        ]
        verdict = "FAIL" if critical_issues else "WARN"
    elif not format_valid and format_type != "generic":
        verdict = "FAIL"

    return ArtifactValidation(
        verdict=verdict,
        path=str(artifact_path),
        exists=exists,
        is_empty=is_empty,
        size_bytes=size_bytes,
        hash_sha256=hash_sha256,
        hash_matches=hash_matches,
        is_recent=is_recent,
        age_seconds=age_seconds,
        format_valid=format_valid,
        content_summary=content_summary,
        issues=issues,
    )


def validate_artifacts(
    artifacts: list[dict[str, Any]], root: Path
) -> list[ArtifactValidation]:
    """
    Validate multiple artifacts.

    Args:
        artifacts: List of artifact dicts with path, expected_hash, min_timestamp, format
        root: Project root for relative path resolution

    Returns:
        List of ArtifactValidation results
    """
    results: list[ArtifactValidation] = []

    for artifact in artifacts:
        path = root / artifact.get("path", "")
        validation = validate_artifact(
            path,
            expected_hash=artifact.get("expected_hash"),
            min_timestamp_utc=artifact.get("min_timestamp_utc"),
            format_type=artifact.get("format", "generic"),
        )
        results.append(validation)

    return results
