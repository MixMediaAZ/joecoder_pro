# tools/forgetastic/beta_reporter.py (Generate Test Reports - HTML & JSON)

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from .common import save_json, utc_now_iso, get_logger

log = get_logger("beta_reporter")


def generate_json_report(
    result: dict[str, Any], manifest_id: str, root: Path
) -> Path:
    """
    Generate a JSON test report.

    Args:
        result: Test result dict from beta_engine
        manifest_id: BHV-XXX identifier
        root: Project root

    Returns:
        Path to generated report
    """
    report_dir = root / "forge/beta"
    report_dir.mkdir(parents=True, exist_ok=True)

    report_path = report_dir / f"{manifest_id}-{utc_now_iso().replace(':', '')}.json"

    report = {
        "report_type": "BETA_TEST_REPORT",
        "manifest_id": manifest_id,
        "generated_utc": utc_now_iso(),
        "verdict": result.get("verdict", "UNKNOWN"),
        "test_results": result,
    }

    save_json(report_path, report)
    log.info(f"Generated JSON report: {report_path}")
    return report_path


def _render_regression_section(regression: dict[str, Any]) -> str:
    """Build the Regression Analysis HTML without nested same-quoted f-strings,
    so this module parses on Python 3.11 (PEP 701 nesting is 3.12-only)."""
    if not regression.get("verdict"):
        return ""
    verdict = regression.get("verdict", "UNKNOWN")
    color = "#28a745" if verdict == "PASS" else "#dc3545"
    issues_html = "".join(
        f'<div class="issue" style="border-left-color: #dc3545; background: #fff5f5;">{issue}</div>'
        for issue in regression.get("issues", [])
    )
    rows_html = ""
    for key, change in regression.get("changes", {}).items():
        baseline = change.get("baseline", "N/A")
        current = change.get("current", "N/A")
        delta = change.get("delta", change.get("delta_percent", "N/A"))
        rows_html += (
            "<tr>"
            f"<td>{key}</td>"
            f"<td>{baseline}</td>"
            f"<td>{current}</td>"
            f"<td>{delta}</td>"
            "</tr>"
        )
    return (
        '<div class="section">'
        '<div class="section-title">Regression Analysis</div>'
        '<div style="margin-bottom: 10px;">'
        f'<strong>Verdict:</strong> <span style="color: {color}">{verdict}</span>'
        '</div>'
        f'{issues_html}'
        '<table style="margin-top: 15px; font-size: 12px;">'
        '<tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th></tr>'
        f'{rows_html}'
        '</table>'
        '</div>'
    )


def generate_html_report(
    result: dict[str, Any], regression: dict[str, Any], manifest_id: str, root: Path
) -> Path:
    """
    Generate an HTML test report with rich formatting.

    Args:
        result: Test result dict from beta_engine
        regression: Regression analysis dict
        manifest_id: BHV-XXX identifier
        root: Project root

    Returns:
        Path to generated report
    """
    report_dir = root / "forge/beta"
    report_dir.mkdir(parents=True, exist_ok=True)

    report_path = report_dir / f"{manifest_id}-{utc_now_iso().replace(':', '')}.html"

    # Build HTML
    verdict = result.get("verdict", "UNKNOWN")
    verdict_class = "pass" if verdict == "PASS" else "fail" if verdict == "FAIL" else "warn"
    regression_section = _render_regression_section(regression)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Beta Test Report - {manifest_id}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }}
        .header {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #0066cc;
        }}
        .verdict {{
            font-size: 24px;
            font-weight: bold;
            margin-top: 10px;
        }}
        .verdict.pass {{ color: #28a745; }}
        .verdict.fail {{ color: #dc3545; }}
        .verdict.warn {{ color: #ffc107; }}
        .section {{
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
        }}
        .section-title {{
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        th, td {{
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }}
        th {{
            background: #f8f9fa;
            font-weight: 600;
        }}
        .metric {{
            display: inline-block;
            margin-right: 20px;
            margin-bottom: 10px;
        }}
        .metric-label {{
            font-size: 12px;
            color: #666;
        }}
        .metric-value {{
            font-size: 24px;
            font-weight: bold;
            color: #0066cc;
        }}
        .issue {{
            padding: 10px;
            margin: 10px 0;
            border-left: 4px solid #dc3545;
            background: #fff5f5;
        }}
        .issue.warn {{
            border-left-color: #ffc107;
            background: #fffbf0;
        }}
        .test-suite {{
            margin-bottom: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
        }}
        .progress-bar {{
            width: 100%;
            height: 20px;
            background: #eee;
            border-radius: 4px;
            overflow: hidden;
        }}
        .progress-fill {{
            height: 100%;
            background: linear-gradient(90deg, #28a745, #20c997);
            transition: width 0.3s;
        }}
        footer {{
            text-align: center;
            color: #999;
            font-size: 12px;
            margin-top: 40px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Beta Test Report</h1>
        <div class="metric-label">Manifest ID: {manifest_id}</div>
        <div class="verdict {verdict_class}">{verdict}</div>
        <div class="metric-label" style="margin-top: 10px;">Generated: {result.get("timestamp_utc", "unknown")}</div>
    </div>

    <div class="section">
        <div class="section-title">Metrics</div>
        <div class="metric">
            <div class="metric-label">Total Tests</div>
            <div class="metric-value">{result.get("total_tests", 0)}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Passed</div>
            <div class="metric-value" style="color: #28a745;">{result.get("total_passed", 0)}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Failed</div>
            <div class="metric-value" style="color: #dc3545;">{result.get("total_failed", 0)}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Coverage</div>
            <div class="metric-value">{result.get("total_coverage_percent", 0):.1f}%</div>
        </div>

        <div style="margin-top: 20px;">
            <div class="metric-label">Coverage Progress</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: {min(result.get('total_coverage_percent', 0), 100)}%"></div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Test Suites</div>
        {"".join([
            f'''
            <div class="test-suite">
                <strong>{suite.get("suite_name", "unknown")}</strong>
                <br/>Tests: {suite.get("total_tests", 0)} | Passed: {suite.get("passed", 0)} | Failed: {suite.get("failed", 0)}
                <br/>Time: {suite.get("execution_time_seconds", 0):.2f}s
            </div>
            ''' for suite in result.get("test_suites", [])
        ])}
    </div>

    {"".join([
        f'<div class="section"><div class="section-title">Blocking Issues</div>' +
        "".join([
            f'<div class="issue">{issue.get("suite", "general")}: {issue.get("issue", "Unknown issue")}</div>'
            for issue in result.get("blocking_issues", [])
        ]) + '</div>'
        if result.get("blocking_issues") else ''
    ])}

    {"".join([
        f'<div class="section"><div class="section-title">Warnings</div>' +
        "".join([
            f'<div class="issue warn">{warn.get("suite", "general")}: {warn.get("issue", "Unknown warning")}</div>'
            for warn in result.get("warnings", [])
        ]) + '</div>'
        if result.get("warnings") else ''
    ])}

    {regression_section}

    <footer>
        <p>Generated by Forgetastic Beta Testing Framework</p>
        <p>Report: {report_path.name}</p>
    </footer>
</body>
</html>"""

    report_path.write_text(html)
    log.info(f"Generated HTML report: {report_path}")
    return report_path


def generate_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Generate a summary of all beta test runs.

    Args:
        results: List of test results

    Returns:
        Summary dict
    """
    total_runs = len(results)
    passed_runs = sum(1 for r in results if r.get("verdict") == "PASS")
    failed_runs = sum(1 for r in results if r.get("verdict") == "FAIL")

    avg_coverage = 0.0
    if results:
        avg_coverage = sum(r.get("total_coverage_percent", 0) for r in results) / len(results)

    return {
        "total_runs": total_runs,
        "passed_runs": passed_runs,
        "failed_runs": failed_runs,
        "pass_rate": passed_runs / total_runs if total_runs > 0 else 0.0,
        "avg_coverage_percent": avg_coverage,
        "timestamp_utc": utc_now_iso(),
    }
