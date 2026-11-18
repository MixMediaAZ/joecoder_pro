# tools/forgetastic/beta_engine.py (Functional Beta Testing & Proof Generation)

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from .common import load_json, save_json, utc_now_iso, sha256_dict, sha256_file, get_logger
from .test_harness import TestSuite, run_all_test_suites, execution_to_dict
from .result_parser import parse_junit_xml, parse_coverage_xml, metrics_to_dict, coverage_to_dict
from .artifact_validator import validate_artifact

log = get_logger("beta_engine")


@dataclass(frozen=True)
class BetaTestConfig:
    """Configuration for beta testing a build."""
    test_suites: list[dict[str, Any]]  # List of test suite configs
    min_coverage_percent: float = 80.0    # Minimum line coverage %
    min_test_count: int = 1               # Minimum number of tests
    determinism_runs: int = 1             # Number of times to run suite
    environment: str = "STAGING"          # Environment to test in
    required: bool = True                 # If False, test failures don't block


def load_beta_config(root: Path) -> Optional[BetaTestConfig]:
    """Load beta testing configuration from BETA.json."""
    beta_config_path = root / "forge/policy/BETA.json"
    if not beta_config_path.exists():
        log.warning(f"No BETA.json found at {beta_config_path}")
        return None

    payload = load_json(beta_config_path) or {}
    return BetaTestConfig(
        test_suites=payload.get("test_suites", []),
        min_coverage_percent=float(payload.get("min_coverage_percent", 80.0)),
        min_test_count=int(payload.get("min_test_count", 1)),
        determinism_runs=int(payload.get("determinism_runs", 1)),
        environment=str(payload.get("environment", "STAGING")),
        required=bool(payload.get("required", True)),
    )


def run_beta_test(root: Path, config: BetaTestConfig, run_number: int = 1) -> dict[str, Any]:
    """
    Execute a single beta test run.

    Runs all configured test suites, parses results, validates artifacts.

    Args:
        root: Project root
        config: Beta test configuration
        run_number: Which determinism run (1, 2, 3, etc.)

    Returns:
        Dict with test results, coverage, artifacts, and verdict
    """
    log.info(f"Running beta test #{run_number}")

    # Convert config to TestSuite objects
    suites: list[TestSuite] = []
    for suite_config in config.test_suites:
        suite = TestSuite(
            name=suite_config.get("name", "unknown"),
            command=suite_config.get("command", ""),
            working_dir=suite_config.get("working_dir", "."),
            junit_xml_path=suite_config.get("junit_xml_path", ""),
            coverage_xml_path=suite_config.get("coverage_xml_path"),
            min_coverage=float(suite_config.get("min_coverage", 0.0)),
            timeout_seconds=int(suite_config.get("timeout_seconds", 300)),
            required=bool(suite_config.get("required", True)),
        )
        suites.append(suite)

    if not suites:
        log.warning("No test suites configured in BETA.json")
        return {
            "verdict": "FAIL",
            "reason": "No test suites configured",
            "run_number": run_number,
        }

    # Execute all test suites with isolation mode enabled for determinism
    executions = run_all_test_suites(suites, isolation_mode=True)

    # Parse results and collect metrics
    results: dict[str, Any] = {
        "run_number": run_number,
        "timestamp_utc": utc_now_iso(),
        "test_suites": [],
        "total_tests": 0,
        "total_passed": 0,
        "total_failed": 0,
        "total_coverage_percent": 0.0,
        "blocking_issues": [],
        "warnings": [],
    }

    for execution in executions:
        suite_result = execution_to_dict(execution)

        # Parse JUnit XML if it exists
        junit_metrics = None
        if execution.junit_xml_path:
            junit_path = root / execution.junit_xml_path
            junit_metrics = parse_junit_xml(junit_path)
            if junit_metrics:
                suite_result.update(metrics_to_dict(junit_metrics))
                results["total_tests"] += junit_metrics.total_tests
                results["total_passed"] += junit_metrics.passed
                results["total_failed"] += junit_metrics.failed

        # Parse coverage XML if it exists
        coverage_metrics = None
        if execution.coverage_xml_path:
            coverage_path = root / execution.coverage_xml_path
            coverage_metrics = parse_coverage_xml(coverage_path)
            if coverage_metrics:
                suite_result.update(coverage_to_dict(coverage_metrics))
                results["total_coverage_percent"] = max(
                    results["total_coverage_percent"],
                    coverage_metrics.line_rate * 100,
                )

        # Check for issues
        suite_required = next((suite.required for suite in suites if suite.name == execution.suite_name), True)

        if execution.exit_code != 0:
            issue = {
                "suite": execution.suite_name,
                "issue": f"Test suite failed with exit code {execution.exit_code}",
            }
            if suite_required:
                results["blocking_issues"].append(issue)
            else:
                results["warnings"].append(issue)

        if junit_metrics and junit_metrics.failed > 0:
            issue = {
                "suite": execution.suite_name,
                "issue": f"{junit_metrics.failed} test(s) failed",
            }
            if suite_required:
                results["blocking_issues"].append(issue)
            else:
                results["warnings"].append(issue)

        if coverage_metrics and coverage_metrics.line_rate * 100 < config.min_coverage_percent:
            results["blocking_issues"].append({
                "suite": execution.suite_name,
                "issue": f"Coverage {coverage_metrics.line_rate * 100:.1f}% < required {config.min_coverage_percent}%",
            })

        if junit_metrics and junit_metrics.total_tests < config.min_test_count:
            results["warnings"].append({
                "suite": execution.suite_name,
                "issue": f"Only {junit_metrics.total_tests} test(s), min {config.min_test_count} required",
            })

        results["test_suites"].append(suite_result)

    # Determine verdict
    results["verdict"] = "PASS" if not results["blocking_issues"] else "FAIL"

    return results


def run_determinism_test(root: Path, config: BetaTestConfig) -> dict[str, Any]:
    """
    Run beta tests multiple times and compare outputs with strict isolation.

    Verifies determinism: same tests, same results, every time.
    Uses isolated subprocess execution to enforce determinism at the OS level.

    Args:
        root: Project root
        config: Beta test configuration

    Returns:
        Dict with determinism verdict and run comparisons
    """
    determinism_runs = max(1, config.determinism_runs)
    log.info(f"Running determinism test with {determinism_runs} isolated runs")

    runs: list[dict[str, Any]] = []
    hashes: list[str] = []
    key_metrics: list[dict[str, Any]] = []

    for run_num in range(1, determinism_runs + 1):
        log.info(f"Determinism run {run_num}/{determinism_runs}")
        run_result = run_beta_test(root, config, run_num)
        runs.append(run_result)

        # Create hash of key outputs for comparison
        key_outputs = {
            "total_tests": run_result.get("total_tests"),
            "total_passed": run_result.get("total_passed"),
            "total_failed": run_result.get("total_failed"),
            "total_coverage_percent": run_result.get("total_coverage_percent"),
            "verdict": run_result.get("verdict"),
        }
        run_hash = sha256_dict(key_outputs)
        hashes.append(run_hash)
        key_metrics.append(key_outputs)

    # Compare hashes - all must be identical
    verdict = "PASS"
    issues: list[str] = []

    if len(set(hashes)) > 1:
        # Determinism failed - provide detailed diffs
        verdict = "FAIL"
        for i in range(1, len(hashes)):
            if hashes[i] != hashes[0]:
                # Detailed diff of this run vs baseline
                metrics_diff = []
                for key in key_metrics[0].keys():
                    baseline_val = key_metrics[0][key]
                    current_val = key_metrics[i][key]
                    if baseline_val != current_val:
                        metrics_diff.append(f"{key}: {baseline_val} → {current_val}")

                issue_msg = (
                    f"Run {i+1} diverged from baseline (run 1): "
                    f"{', '.join(metrics_diff) if metrics_diff else 'unknown divergence'}"
                )
                issues.append(issue_msg)
                log.warning(issue_msg)

    if verdict == "PASS":
        log.info(f"✓ All {determinism_runs} runs are deterministic (identical outputs)")

    return {
        "verdict": verdict,
        "determinism_runs": len(runs),
        "run_hashes": hashes,
        "issues": issues,
        "runs": runs,
    }


def generate_proof_record(
    root: Path, beta_result: dict[str, Any], manifest_id: str
) -> dict[str, Any]:
    """
    Generate a proof record from beta test results.

    This becomes a RUNTIME_PROOF.jsonl entry.

    Args:
        root: Project root
        beta_result: Result from run_beta_test or run_determinism_test
        manifest_id: BHV-XXX identifier

    Returns:
        Dict suitable for appending to RUNTIME_PROOF.jsonl
    """
    # Determine confidence tier based on coverage and test count
    total_tests = beta_result.get("total_tests", 0)
    passed = beta_result.get("total_passed", 0)
    coverage = beta_result.get("total_coverage_percent", 0.0)

    confidence_tier = 1
    if total_tests > 0:
        confidence_tier = 2
    if coverage >= 50:
        confidence_tier = 3
    if coverage >= 80 and passed > 0:
        confidence_tier = 4
    if coverage >= 90 and passed > 10:
        confidence_tier = 5

    proof = {
        "proof_id": f"BETA-{utc_now_iso().replace(':', '').replace('-', '')}",
        "manifest_id": manifest_id,
        "proof_type": "BETA_TEST",
        "environment": beta_result.get("environment", "STAGING"),
        "runner": "forgetastic-beta",
        "timestamp_utc": utc_now_iso(),
        "status": beta_result.get("verdict", "FAIL").upper(),
        "test_count": total_tests,
        "passed": passed,
        "failed": beta_result.get("total_failed", 0),
        "coverage_percent": coverage,
        "confidence_level": confidence_tier,
        "blocking_issues": beta_result.get("blocking_issues", []),
        "warnings": beta_result.get("warnings", []),
        "artifact_paths": [
            f"forge/beta/{manifest_id}/run-{utc_now_iso()}.json"
        ],
    }

    return proof
