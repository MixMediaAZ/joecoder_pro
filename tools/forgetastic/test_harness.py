# tools/forgetastic/test_harness.py (Beta Testing Framework - Phase 1)

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from .common import utc_now_iso, sha256_file, get_logger

log = get_logger("test_harness")


@dataclass(frozen=True)
class TestSuite:
    """Definition of a test suite to execute."""
    name: str                              # "unit", "integration", "e2e", etc.
    command: str                           # "pytest tests/ -v --junit-xml=..."
    working_dir: str                       # Where to run command
    junit_xml_path: str                    # Path to JUnit output (relative to working_dir)
    coverage_xml_path: Optional[str] = None # Path to coverage.xml (optional)
    min_coverage: float = 0.0              # Minimum coverage % (0-100)
    timeout_seconds: int = 300             # Max execution time
    required: bool = True                  # If False, failures don't block gates


@dataclass(frozen=True)
class ExecutionResult:
    """Result of a single test suite execution."""
    suite_name: str
    command: str
    exit_code: int
    stdout: str
    stderr: str
    execution_time_seconds: float
    timestamp_utc: str
    junit_xml_path: Optional[str]
    coverage_xml_path: Optional[str]
    test_count: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    coverage_percent: float = 0.0
    execution_hash: str = ""  # Hash of junit output for determinism


def run_test_suite(suite: TestSuite, isolation_mode: bool = True) -> ExecutionResult:
    """
    Execute a single test suite with optional isolation.

    Captures:
    - Exit code
    - stdout / stderr
    - Execution time
    - JUnit XML (structured test results)
    - Coverage XML (if specified)

    Isolation mode:
    - Sets PYTHONHASHSEED=0 for determinism
    - Executes in isolated subprocess context
    - Ensures deterministic output across runs

    Args:
        suite: Test suite configuration
        isolation_mode: If True, enforce determinism via environment variables

    Returns:
        ExecutionResult with all details
    """
    import os
    import time

    root = Path.cwd()
    working_dir = root / suite.working_dir
    junit_path = working_dir / suite.junit_xml_path

    if not working_dir.exists():
        log.error(f"Working directory not found: {working_dir}")
        return ExecutionResult(
            suite_name=suite.name,
            command=suite.command,
            exit_code=127,
            stdout="",
            stderr=f"Working directory not found: {working_dir}",
            execution_time_seconds=0.0,
            timestamp_utc=utc_now_iso(),
            junit_xml_path=None,
            coverage_xml_path=None,
        )

    log.info(f"Running test suite: {suite.name}")
    log.info(f"Command: {suite.command}")
    log.info(f"Working directory: {working_dir}")
    if isolation_mode:
        log.info(f"Isolation mode: enabled (PYTHONHASHSEED=0)")

    start_time = time.time()

    # Prepare environment for isolation
    env = os.environ.copy()
    if isolation_mode:
        env["PYTHONHASHSEED"] = "0"  # Ensure deterministic Python hash
        env["PYTHONDONTWRITEBYTECODE"] = "1"  # Don't create .pyc files
        # Avoid tracing plugins adding non-determinism or hangs in repeated subprocess runs.
        env.setdefault("DD_TRACE_ENABLED", "false")

    try:
        result = subprocess.run(
            suite.command,
            shell=True,
            cwd=str(working_dir),
            capture_output=True,
            text=True,
            timeout=suite.timeout_seconds,
            env=env,
        )
        exit_code = result.returncode
        stdout = result.stdout
        stderr = result.stderr
    except subprocess.TimeoutExpired:
        exit_code = 124
        stdout = ""
        stderr = f"Test suite timed out after {suite.timeout_seconds} seconds"
    except Exception as e:
        exit_code = 1
        stdout = ""
        stderr = str(e)

    execution_time = time.time() - start_time

    # Verify JUnit XML exists
    junit_exists = junit_path.exists()
    junit_relative = str(junit_path.relative_to(root)) if junit_exists else None

    # Verify coverage XML exists
    coverage_path = None
    coverage_relative = None
    if suite.coverage_xml_path:
        coverage_path = working_dir / suite.coverage_xml_path
        coverage_exists = coverage_path.exists()
        coverage_relative = str(coverage_path.relative_to(root)) if coverage_exists else None

    # Hash the output for determinism checking
    execution_hash = ""
    if junit_exists:
        execution_hash = sha256_file(junit_path)

    execution = ExecutionResult(
        suite_name=suite.name,
        command=suite.command,
        exit_code=exit_code,
        stdout=stdout[:1000],  # Truncate to prevent huge logs
        stderr=stderr[:1000],
        execution_time_seconds=execution_time,
        timestamp_utc=utc_now_iso(),
        junit_xml_path=junit_relative,
        coverage_xml_path=coverage_relative,
        execution_hash=execution_hash,
    )

    log.info(f"Test suite {suite.name} completed: exit_code={exit_code}, time={execution_time:.2f}s")

    return execution


def run_all_test_suites(suites: List[TestSuite], isolation_mode: bool = True) -> List[ExecutionResult]:
    """
    Execute all test suites in sequence with optional isolation.

    Args:
        suites: List of test suites to execute
        isolation_mode: If True, enforce determinism via environment variables

    Returns:
        List of ExecutionResult for each suite
    """
    results: List[ExecutionResult] = []

    for suite in suites:
        result = run_test_suite(suite, isolation_mode=isolation_mode)
        results.append(result)

        # Log result
        if result.exit_code == 0:
            log.info(f"✓ {suite.name} passed")
        else:
            log.warning(f"✗ {suite.name} failed with exit code {result.exit_code}")

    return results


def execution_to_dict(execution: ExecutionResult) -> dict[str, Any]:
    """Convert ExecutionResult to dict for JSON serialization."""
    return {
        "suite_name": execution.suite_name,
        "command": execution.command,
        "exit_code": execution.exit_code,
        "stdout": execution.stdout,
        "stderr": execution.stderr,
        "execution_time_seconds": execution.execution_time_seconds,
        "timestamp_utc": execution.timestamp_utc,
        "junit_xml_path": execution.junit_xml_path,
        "coverage_xml_path": execution.coverage_xml_path,
        "test_count": execution.test_count,
        "passed": execution.passed,
        "failed": execution.failed,
        "skipped": execution.skipped,
        "coverage_percent": execution.coverage_percent,
        "execution_hash": execution.execution_hash,
    }
