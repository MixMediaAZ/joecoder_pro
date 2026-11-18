# tools/forgetastic/regression_detector.py (Detect Performance & Coverage Regressions)

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from .common import load_json, save_json, utc_now_iso, get_logger

log = get_logger("regression_detector")


@dataclass(frozen=True)
class Baseline:
    """Baseline test results for comparison."""
    timestamp_utc: str
    test_count: int
    passed: int
    failed: int
    coverage_percent: float
    execution_time_seconds: float


@dataclass(frozen=True)
class RegressionAnalysis:
    """Result of comparing current run to baseline."""
    verdict: str  # PASS, WARN, FAIL
    issues: list[str]
    changes: dict[str, Any]
    baseline: Optional[Baseline]
    current: dict[str, Any]


def load_baseline(root: Path, manifest_id: str) -> Optional[Baseline]:
    """Load baseline test results for a manifest ID."""
    baseline_path = root / f"forge/baselines/{manifest_id}.json"

    if not baseline_path.exists():
        log.warning(f"No baseline found for {manifest_id}")
        return None

    payload = load_json(baseline_path) or {}
    return Baseline(
        timestamp_utc=payload.get("timestamp_utc", ""),
        test_count=int(payload.get("test_count", 0)),
        passed=int(payload.get("passed", 0)),
        failed=int(payload.get("failed", 0)),
        coverage_percent=float(payload.get("coverage_percent", 0.0)),
        execution_time_seconds=float(payload.get("execution_time_seconds", 0.0)),
    )


def save_baseline(root: Path, manifest_id: str, current: dict[str, Any]) -> None:
    """Save current test results as new baseline."""
    baseline_dir = root / "forge/baselines"
    baseline_dir.mkdir(parents=True, exist_ok=True)

    baseline_path = baseline_dir / f"{manifest_id}.json"
    baseline_data = {
        "timestamp_utc": utc_now_iso(),
        "test_count": current.get("total_tests", 0),
        "passed": current.get("total_passed", 0),
        "failed": current.get("total_failed", 0),
        "coverage_percent": current.get("total_coverage_percent", 0.0),
        "execution_time_seconds": current.get("execution_time_seconds", 0.0),
    }

    save_json(baseline_path, baseline_data)
    log.info(f"Saved baseline for {manifest_id}: {baseline_path}")


def detect_regressions(
    current: dict[str, Any],
    baseline: Optional[Baseline],
    thresholds: Optional[dict[str, float]] = None,
) -> RegressionAnalysis:
    """
    Detect performance and coverage regressions.

    Compares current run to baseline and flags:
    - Coverage drop > threshold
    - Test count decrease
    - New test failures
    - Performance degradation

    Args:
        current: Current test run results
        baseline: Previous baseline results (optional)
        thresholds: Dict with acceptable changes (default: conservative)
            - coverage_drop_percent: Max % coverage drop (default 2%)
            - test_count_drop: Max test count decrease (default 0)
            - failure_increase: Max new failures (default 0)
            - time_increase_percent: Max execution time increase (default 10%)

    Returns:
        RegressionAnalysis with verdict and details
    """
    if not thresholds:
        thresholds = {
            "coverage_drop_percent": 2.0,
            "test_count_drop": 0,
            "failure_increase": 0,
            "time_increase_percent": 10.0,
        }

    issues: list[str] = []
    changes: dict[str, Any] = {}

    # No baseline = can't detect regression
    if not baseline:
        log.info("No baseline available, skipping regression detection")
        return RegressionAnalysis(
            verdict="PASS",
            issues=[],
            changes={},
            baseline=None,
            current=current,
        )

    # Compare coverage
    current_coverage = current.get("total_coverage_percent", 0.0)
    coverage_drop = baseline.coverage_percent - current_coverage
    changes["coverage_percent"] = {
        "baseline": baseline.coverage_percent,
        "current": current_coverage,
        "delta": -coverage_drop,
    }

    if coverage_drop > thresholds["coverage_drop_percent"]:
        issues.append(
            f"Coverage regressed: {baseline.coverage_percent:.1f}% → "
            f"{current_coverage:.1f}% (drop {coverage_drop:.1f}%, threshold {thresholds['coverage_drop_percent']:.1f}%)"
        )

    # Compare test count
    current_tests = current.get("total_tests", 0)
    test_drop = baseline.test_count - current_tests
    changes["test_count"] = {
        "baseline": baseline.test_count,
        "current": current_tests,
        "delta": -test_drop,
    }

    if test_drop > thresholds["test_count_drop"]:
        issues.append(
            f"Test count decreased: {baseline.test_count} → {current_tests} (drop {test_drop})"
        )

    # Compare failures
    current_failed = current.get("total_failed", 0)
    failure_increase = current_failed - baseline.failed
    changes["failures"] = {
        "baseline": baseline.failed,
        "current": current_failed,
        "delta": failure_increase,
    }

    if failure_increase > thresholds["failure_increase"]:
        issues.append(
            f"Test failures increased: {baseline.failed} → {current_failed} "
            f"(+{failure_increase}, threshold {thresholds['failure_increase']})"
        )

    # Compare execution time
    current_time = current.get("execution_time_seconds", 0.0)
    if baseline.execution_time_seconds > 0:
        time_increase_pct = (
            (current_time - baseline.execution_time_seconds) / baseline.execution_time_seconds * 100
        )
        changes["execution_time_seconds"] = {
            "baseline": baseline.execution_time_seconds,
            "current": current_time,
            "delta_percent": time_increase_pct,
        }

        if time_increase_pct > thresholds["time_increase_percent"]:
            issues.append(
                f"Execution time increased: {baseline.execution_time_seconds:.1f}s → "
                f"{current_time:.1f}s (+{time_increase_pct:.1f}%, threshold {thresholds['time_increase_percent']:.1f}%)"
            )

    # Determine verdict
    verdict = "PASS"
    if issues:
        # Check if any issue is critical (coverage drop, new failures)
        critical_issues = [
            i for i in issues
            if any(keyword in i.lower() for keyword in ["regressed", "increased", "drop"])
        ]
        verdict = "FAIL" if critical_issues else "WARN"

    return RegressionAnalysis(
        verdict=verdict,
        issues=issues,
        changes=changes,
        baseline=baseline,
        current=current,
    )
