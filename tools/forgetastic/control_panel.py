from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse

APP_NAME = "Forgetastic Control Panel"
APP_VERSION = "1.0.0-rc0-ui4"

PIPELINE_COMMANDS = [
    "status",
    "validate-order",
    "manifest-lint",
    "lock-manifest",
    "structure",
    "enforce",
    "drift",
    "done-gate",
    "prosecution-bundle",
    "arbitration-bundle",
    "deployment-gate",
    "verify-artifacts",
    "integrity",
    "truth",
    "audit",
    "finalize-gate",
    "finalize",
    "release-gate",
    "report-status",
    "doctor",
]

ALLOWED_COMMANDS = set(PIPELINE_COMMANDS) | {"init", "prove"}

REPORT_FILES = {
    "manifest_lint": "forge/reports/MANIFEST_LINT_REPORT.json",
    "enforcement": "forge/reports/ENFORCEMENT_REPORT.json",
    "drift": "forge/reports/DRIFT_REPORT.json",
    "done_gate": "forge/reports/DONE_GATE.json",
    "deployment_gate": "forge/reports/DEPLOYMENT_GATE.json",
    "artifact_verification": "forge/reports/ARTIFACT_VERIFICATION.json",
    "integrity": "forge/reports/INTEGRITY_REPORT.json",
    "truth": "forge/reports/TRUTH_REPORT.json",
    "audit": "forge/reports/AUDIT_REPORT.json",
    "release_gate": "forge/reports/RELEASE_GATE_REPORT.json",
}

PIPELINE_STAGES = [
    ("intent", None),
    ("manifest", "manifest_lint"),
    ("structure", None),
    ("proof", None),
    ("enforce", "enforcement"),
    ("drift", "drift"),
    ("done-gate", "done_gate"),
    ("prosecution", None),
    ("arbitration", None),
    ("deployment-gate", "deployment_gate"),
    ("integrity", "integrity"),
    ("truth", "truth"),
    ("audit", "audit"),
    ("finalize", None),
    ("release-gate", "release_gate"),
]

PROTECTED_RELATIVE_PATHS = [
    "forge/manifest/MANIFEST.json",
    "forge/policy/POLICY.json",
    "forge/policy/PRODUCTION.json",
    "forge/policy/BETA.json",
    "forge/final/FINAL_SNAPSHOT.json",
    "forge/final/LOCK",
]

PROTECTED_GLOBS = [
    "tools/forgetastic/*truth*",
    "tools/forgetastic/*audit*",
    "tools/forgetastic/*release_gate*",
    "tools/forgetastic/*integrity*",
    "tools/forgetastic/*finalization*",
]

STATE_DIR = Path("forge/state")
CONTROL_LOG = STATE_DIR / "CONTROL_PANEL_COMMANDS.jsonl"
PROTECTED_HASHES = STATE_DIR / "CONTROL_PANEL_PROTECTED_HASHES.json"


def core_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_target(path_value: str | None) -> Path:
    if not path_value:
        return core_root()
    p = Path(path_value).expanduser()
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    return p.resolve()


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as exc:
        return {"_json_error": str(exc), "_path": str(path)}


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def sha256_dict(data: dict[str, Any]) -> str:
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def python_executable() -> str:
    return sys.executable or "python"


def target_has_cli(target: Path) -> bool:
    return (target / "tools" / "forgetastic" / "cli.py").exists()


def run_cli(target: Path, command: str, extra_args: list[str] | None = None, timeout: int = 120) -> dict[str, Any]:
    if command not in ALLOWED_COMMANDS:
        raise ValueError(f"Command is not allowlisted: {command}")
    if not target.exists() or not target.is_dir():
        raise ValueError(f"Target folder does not exist: {target}")
    if not target_has_cli(target):
        raise ValueError("Forge CLI is not bootstrapped into this target. Run Bootstrap first.")

    cmd = [python_executable(), "-m", "tools.forgetastic.cli", command]
    if extra_args:
        cmd.extend(extra_args)

    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(target),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        exit_code = proc.returncode
        stdout = proc.stdout
        stderr = proc.stderr
    except subprocess.TimeoutExpired as exc:
        exit_code = 124
        stdout = exc.stdout or ""
        stderr = (exc.stderr or "") + f"\nTIMEOUT after {timeout}s"

    result = {
        "command": command,
        "args": extra_args or [],
        "cmdline": cmd,
        "target": str(target),
        "exit_code": exit_code,
        "ok": exit_code == 0,
        "stdout": stdout,
        "stderr": stderr,
        "started_utc": utc_now(),
        "elapsed_seconds": round(time.time() - started, 3),
    }
    append_jsonl(target / CONTROL_LOG, result)
    return result


def copytree_safe(src: Path, dst: Path) -> list[str]:
    copied: list[str] = []
    for item in src.rglob("*"):
        if "__pycache__" in item.parts or item.suffix == ".pyc":
            continue
        rel = item.relative_to(src)
        out = dst / rel
        if item.is_dir():
            out.mkdir(parents=True, exist_ok=True)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, out)
        copied.append(str(out))
    return copied


def bootstrap_target(target: Path) -> dict[str, Any]:
    if not target.exists() or not target.is_dir():
        raise ValueError(f"Target folder does not exist: {target}")
    src_root = core_root()
    copied: list[str] = []

    target_tools = target / "tools" / "forgetastic"
    if not target_tools.exists():
        copied.extend(copytree_safe(src_root / "tools" / "forgetastic", target_tools))
    elif not (target_tools / "cli.py").exists():
        copied.extend(copytree_safe(src_root / "tools" / "forgetastic", target_tools))

    tools_init = target / "tools" / "__init__.py"
    if not tools_init.exists():
        tools_init.parent.mkdir(parents=True, exist_ok=True)
        tools_init.write_text("# Namespace package for Forgetastic.\n", encoding="utf-8")
        copied.append(str(tools_init))

    for filename in ["AGENTS.md", "FORGE_OPERATOR_LOOP.md", "INTENT_TO_MANIFEST.md"]:
        src = src_root / filename
        dst = target / filename
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)
            copied.append(str(dst))

    init_result = run_cli(target, "init")
    manifest_path = target / "forge" / "manifest" / "MANIFEST.json"
    created_manifest = False
    if not manifest_path.exists():
        template = {
            "project": target.name,
            "mode": "STANDARD",
            "purpose": "TBD - convert the intent doc into required behaviors before locking.",
            "operator_approved": False,
            "manifest_locked": False,
            "created_utc": utc_now(),
            "users": [],
            "behaviors": [],
            "failures": [],
            "integrations": [],
            "assumptions": [],
            "out_of_scope": [],
        }
        write_json(manifest_path, template)
        created_manifest = True

    return {
        "target": str(target),
        "copied_count": len(copied),
        "copied": copied[:200],
        "created_manifest_template": created_manifest,
        "init": init_result,
    }


def protected_files(target: Path) -> list[Path]:
    files: list[Path] = []
    for rel in PROTECTED_RELATIVE_PATHS:
        p = target / rel
        if p.exists() and p.is_file():
            files.append(p)
    for pattern in PROTECTED_GLOBS:
        for p in target.glob(pattern):
            if p.exists() and p.is_file():
                files.append(p)
    unique = []
    seen = set()
    for p in files:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def current_protected_hashes(target: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for p in protected_files(target):
        try:
            hashes[str(p.relative_to(target)).replace("\\", "/")] = sha256_file(p)
        except OSError:
            continue
    return hashes


def protected_status(target: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    current = current_protected_hashes(target)
    path = target / PROTECTED_HASHES
    baseline = read_json(path, default=None)
    manifest_locked = bool(manifest.get("manifest_locked")) if isinstance(manifest, dict) else False
    created_baseline = False
    changed: list[dict[str, str]] = []

    if manifest_locked and baseline is None:
        write_json(path, {"created_utc": utc_now(), "hashes": current})
        baseline = {"created_utc": utc_now(), "hashes": current}
        created_baseline = True

    if isinstance(baseline, dict):
        base_hashes = baseline.get("hashes", {}) or {}
        all_keys = sorted(set(base_hashes) | set(current))
        for key in all_keys:
            old = base_hashes.get(key)
            new = current.get(key)
            if old != new:
                changed.append({"path": key, "baseline": old or "MISSING", "current": new or "MISSING"})

    return {
        "protected_count": len(current),
        "baseline_exists": isinstance(baseline, dict),
        "baseline_created_now": created_baseline,
        "changed_after_lock": changed,
        "warning": bool(changed and manifest_locked),
    }


def manifest_summary(target: Path) -> dict[str, Any]:
    path = target / "forge" / "manifest" / "MANIFEST.json"
    manifest = read_json(path, default=None)
    if not isinstance(manifest, dict):
        return {"exists": False, "path": str(path), "manifest": None}
    behaviors = manifest.get("behaviors", []) or []
    failures = manifest.get("failures", []) or []
    integrations = manifest.get("integrations", []) or []
    counts = {"CRITICAL": 0, "MAJOR": 0, "MINOR": 0, "UNKNOWN": 0}
    required = 0
    vague: list[str] = []
    for item in behaviors:
        if not isinstance(item, dict):
            continue
        severity = str(item.get("severity", "UNKNOWN")).upper()
        counts[severity if severity in counts else "UNKNOWN"] += 1
        if item.get("required") is True:
            required += 1
        text = " ".join(str(item.get(k, "")) for k in ["title", "description", "given", "when", "then"])
        if len(text.strip()) < 80 or "works correctly" in text.lower() or "app works" in text.lower():
            vague.append(str(item.get("id") or item.get("title") or "unknown"))
    warnings = []
    if len(behaviors) < 3:
        warnings.append("Manifest is thin: fewer than 3 behaviors declared.")
    if required == 0:
        warnings.append("No required behaviors. A green verdict would be meaningless.")
    if counts["CRITICAL"] == 0 and behaviors:
        warnings.append("No CRITICAL behaviors. Core workflows may be under-protected.")
    if vague:
        warnings.append(f"Potentially vague behavior(s): {', '.join(vague[:8])}")
    if not manifest.get("out_of_scope"):
        warnings.append("out_of_scope is empty; scope creep can distort 100% done.")
    return {
        "exists": True,
        "path": str(path),
        "project": manifest.get("project"),
        "purpose": manifest.get("purpose"),
        "mode": manifest.get("mode"),
        "operator_approved": bool(manifest.get("operator_approved")),
        "operator_approval_timestamp_utc": manifest.get("operator_approval_timestamp_utc"),
        "manifest_locked": bool(manifest.get("manifest_locked")),
        "manifest_hash": sha256_dict(manifest),
        "behavior_count": len(behaviors),
        "required_behavior_count": required,
        "severity_counts": counts,
        "failure_count": len(failures),
        "integration_count": len(integrations),
        "warnings": warnings,
        "manifest": manifest,
    }


def report_status(target: Path, manifest_hash: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name, rel in REPORT_FILES.items():
        path = target / rel
        report = read_json(path, default=None)
        exists = path.exists()
        verdict = None
        generated = None
        report_hash = None
        stale = False
        json_error = None
        if isinstance(report, dict):
            json_error = report.get("_json_error")
            verdict = report.get("verdict") or report.get("system_verdict") or report.get("overall_verdict")
            generated = report.get("generated_utc")
            report_hash = report.get("manifest_hash")
            if manifest_hash and report_hash and report_hash != manifest_hash:
                stale = True
            if name == "audit" and manifest_hash:
                hashes = report.get("manifest_hashes") or {}
                if isinstance(hashes, dict) and any(v and v != manifest_hash for v in hashes.values()):
                    stale = True
        out.append({
            "name": name,
            "path": rel,
            "exists": exists,
            "verdict": verdict,
            "generated_utc": generated,
            "manifest_hash": report_hash,
            "stale": stale,
            "json_error": json_error,
            "report": report if isinstance(report, dict) else None,
        })
    return out


def collect_blockers(target: Path) -> list[dict[str, Any]]:
    blockers: list[dict[str, Any]] = []
    for name, rel in REPORT_FILES.items():
        report = read_json(target / rel, default=None)
        if not isinstance(report, dict):
            continue
        for item in report.get("blocking_items", []) or []:
            if isinstance(item, dict):
                blockers.append({
                    "source": name,
                    "id": item.get("id") or item.get("manifest_id") or "",
                    "message": item.get("message") or item.get("reason") or json.dumps(item, ensure_ascii=False),
                    "raw": item,
                })
            else:
                blockers.append({"source": name, "id": "", "message": str(item), "raw": item})
        for reason in report.get("failure_reasons", []) or []:
            blockers.append({"source": name, "id": "", "message": str(reason), "raw": reason})
    return blockers


def prosecution_status(target: Path) -> dict[str, Any]:
    comp = read_json(target / "forge" / "prosecution" / "PROSECUTION_COMPARISON.json", default={}) or {}
    a = (target / "forge" / "prosecution" / "PROSECUTION_RESULTS_A.json").exists()
    b = (target / "forge" / "prosecution" / "PROSECUTION_RESULTS_B.json").exists()
    disagreements = comp.get("disagreements", []) if isinstance(comp, dict) else []
    arbitration = read_json(target / "forge" / "prosecution" / "ARBITRATION_RESULT.json", default={}) or {}
    return {
        "a_exists": a,
        "b_exists": b,
        "comparison_verdict": comp.get("verdict") if isinstance(comp, dict) else None,
        "disagreement_count": len(disagreements) if isinstance(disagreements, list) else 0,
        "arbitration_exists": bool(arbitration),
        "comparison": comp,
    }


def read_state(target: Path) -> dict[str, Any]:
    manifest = manifest_summary(target)
    manifest_hash = manifest.get("manifest_hash") if manifest.get("exists") else None
    state = read_json(target / "forge" / "state" / "STATE.json", default={}) or {}
    reports = report_status(target, manifest_hash)
    blockers = collect_blockers(target)
    protected = protected_status(target, manifest.get("manifest") or {}) if manifest.get("exists") else {}
    pstat = prosecution_status(target)
    release = next((r for r in reports if r["name"] == "release_gate"), {})
    audit = next((r for r in reports if r["name"] == "audit"), {})
    stages: list[dict[str, Any]] = []
    report_by_name = {r["name"]: r for r in reports}
    for stage, report_name in PIPELINE_STAGES:
        status = "MISSING"
        verdict = None
        if stage == "intent":
            status = "PASS" if (target / "FORGE_OPERATOR_LOOP.md").exists() and (target / "INTENT_TO_MANIFEST.md").exists() else "MISSING"
        elif stage == "structure":
            status = "PASS" if (target / "forge" / "structure" / "STRUCTURE.json").exists() else "MISSING"
        elif stage == "proof":
            status = "PASS" if (target / "forge" / "evidence" / "RUNTIME_PROOF.jsonl").exists() and (target / "forge" / "evidence" / "RUNTIME_PROOF.jsonl").stat().st_size > 0 else "MISSING"
        elif stage == "prosecution":
            if pstat["a_exists"] and pstat["b_exists"]:
                status = "PASS" if pstat["comparison_verdict"] == "PASS" else "FAIL"
            else:
                status = "MISSING"
        elif stage == "arbitration":
            status = "PASS" if pstat["disagreement_count"] == 0 else ("PASS" if pstat["arbitration_exists"] else "BLOCKED")
        elif stage == "finalize":
            status = "PASS" if (target / "forge" / "final" / "LOCK").exists() else "MISSING"
        elif report_name:
            r = report_by_name[report_name]
            verdict = r.get("verdict")
            if not r.get("exists"):
                status = "MISSING"
            elif r.get("stale"):
                status = "STALE"
            elif verdict == "PASS":
                status = "PASS"
            elif verdict == "FAIL":
                status = "FAIL"
            else:
                status = "UNKNOWN"
        stages.append({"stage": stage, "status": status, "verdict": verdict, "report": report_name})

    ship_status = "SHIP" if release.get("verdict") == "PASS" else "DO NOT SHIP"
    return {
        "app": {"name": APP_NAME, "version": APP_VERSION, "core_root": str(core_root())},
        "target": str(target),
        "target_exists": target.exists() and target.is_dir(),
        "bootstrapped": target_has_cli(target),
        "manifest": manifest,
        "state": state,
        "reports": reports,
        "blockers": blockers,
        "protected": protected,
        "prosecution": pstat,
        "stages": stages,
        "release": {
            "ship_status": ship_status,
            "release_gate_verdict": release.get("verdict"),
            "audit_verdict": audit.get("verdict"),
        },
    }


def import_review(target: Path, kind: str, payload_text: str) -> dict[str, Any]:
    if kind not in {"A", "B", "ARBITRATION"}:
        raise ValueError("kind must be A, B, or ARBITRATION")
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Review text is not valid JSON: {exc}") from exc
    target_tmp = target / "forge" / "prosecution" / f"_ui_import_{kind}_{int(time.time())}.json"
    write_json(target_tmp, payload)
    rel = str(target_tmp.relative_to(target))
    if kind == "ARBITRATION":
        return run_cli(target, "arbitration-import", ["--file", rel])
    return run_cli(target, "prosecution-import", ["--prosecutor", kind, "--results-file", rel])


def record_proof(target: Path, fields: dict[str, Any]) -> dict[str, Any]:
    """Shell to the CLI `prove` command to record runtime proof. The CLI stays
    the schema-validation authority; this only marshals args and enforces the
    manifest-locked precondition (proof before lock is meaningless)."""
    summary = manifest_summary(target)
    if not summary.get("manifest_locked"):
        raise ValueError("Manifest is not locked. Lock the manifest before recording proof.")

    status = fields.get("status")
    if not status:
        raise ValueError("status is required (PASS, FAIL, or ENVIRONMENTAL) — it is never auto-set.")

    extra_args = [
        "--manifest-id", str(fields.get("manifest_id", "")),
        "--proof-type", str(fields.get("proof_type", "")),
        "--environment", str(fields.get("environment", "")),
        "--runner", str(fields.get("runner", "")),
        "--command", str(fields.get("command", "")),
        "--input-summary", str(fields.get("input_summary", "")),
        "--expected-summary", str(fields.get("expected_summary", "")),
        "--actual-summary", str(fields.get("actual_summary", "")),
        "--status", str(status),
        "--confidence", str(fields.get("confidence", "")),
    ]

    artifacts = fields.get("artifacts") or []
    if not isinstance(artifacts, list):
        artifacts = [artifacts]
    if artifacts:
        extra_args.append("--artifacts")
        extra_args.extend(str(a) for a in artifacts)

    session_id = fields.get("session_id")
    if session_id:
        extra_args.extend(["--session-id", str(session_id)])

    return run_cli(target, "prove", extra_args=extra_args)


def find_open_port(host: str, requested: int | None = None) -> int:
    if requested:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, requested))
                return requested
            except OSError:
                pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return int(s.getsockname()[1])


# ---------------------------------------------------------------------------
# Item B — Node/Vite run adapter (additive; no change to gate logic or
# guardrails). Only ever executes: `npm install`, `npm run dev`, `npm start`,
# or the target's own `start.bat` — never an arbitrary or user-supplied
# command string.
# ---------------------------------------------------------------------------


def npm_executable() -> str | None:
    return shutil.which("npm")


def _windows_cmd_wrap(argv: list[str]) -> list[str]:
    """On Windows, .bat/.cmd scripts (npm.cmd, start.bat) cannot be launched
    directly via CreateProcess without an interpreter. Wrap with cmd.exe /c
    using list-form args only — no shell=True, no string interpolation, so
    this stays a fixed, non-arbitrary invocation."""
    if os.name == "nt":
        return ["cmd.exe", "/c", *argv]
    return argv


def detect_start_command(target: Path) -> dict[str, Any] | None:
    """Determine the ONLY allowed way to start a Node/JS target app, per
    AGENTS.md port policy: prefer start.bat, else `npm run dev` if that
    script is declared in package.json, else `npm start` if declared.
    NEVER returns an arbitrary/user-supplied command. Returns None if the
    target declares no usable start method."""
    start_bat = target / "start.bat"
    if start_bat.exists():
        return {"label": "start.bat", "display": "start.bat", "cmd": _windows_cmd_wrap(["start.bat"])}

    if not npm_executable():
        return None

    pkg = read_json(target / "package.json", default=None)
    scripts = pkg.get("scripts") if isinstance(pkg, dict) else None
    scripts = scripts if isinstance(scripts, dict) else {}
    if "dev" in scripts:
        return {"label": "npm run dev", "display": "npm run dev", "cmd": _windows_cmd_wrap(["npm", "run", "dev"])}
    if "start" in scripts:
        return {"label": "npm start", "display": "npm start", "cmd": _windows_cmd_wrap(["npm", "start"])}
    return None


def run_npm_install(target: Path, timeout: int = 300) -> dict[str, Any]:
    """Run `npm install` only, timeboxed. Caller is responsible for only
    calling this when node_modules is missing."""
    started = time.time()
    cmd = _windows_cmd_wrap(["npm", "install"])
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(target),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "elapsed_seconds": round(time.time() - started, 3),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "exit_code": 124,
            "stdout": exc.stdout or "",
            "stderr": (exc.stderr or "") + f"\nTIMEOUT after {timeout}s",
            "elapsed_seconds": round(time.time() - started, 3),
        }


def check_route(url: str, total_timeout: float = 30.0, per_request_timeout: float = 2.0) -> dict[str, Any]:
    """Poll a URL until it returns a 2xx/3xx status or total_timeout elapses.
    Never assumes success; returns reachable=False with the last error if the
    window expires."""
    started = time.time()
    attempts = 0
    last_error: str | None = None
    while time.time() - started < total_timeout:
        attempts += 1
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=per_request_timeout) as resp:
                status_code = getattr(resp, "status", None) or resp.getcode()
                if 200 <= status_code < 400:
                    return {"reachable": True, "status_code": status_code, "attempts": attempts,
                             "elapsed_seconds": round(time.time() - started, 3)}
                last_error = f"HTTP {status_code}"
        except urllib.error.HTTPError as exc:
            if 200 <= exc.code < 400:
                return {"reachable": True, "status_code": exc.code, "attempts": attempts,
                         "elapsed_seconds": round(time.time() - started, 3)}
            last_error = f"HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001 - any connection/timeout error just means "not yet"
            last_error = str(exc)
        time.sleep(0.5)
    return {"reachable": False, "status_code": None, "attempts": attempts,
             "elapsed_seconds": round(time.time() - started, 3), "error": last_error}


def _terminate_process(proc: subprocess.Popen) -> None:
    """Guaranteed best-effort shutdown: terminate, then kill after a short
    grace period. Never raises."""
    try:
        proc.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
        return
    except Exception:
        pass
    try:
        proc.kill()
        proc.wait(timeout=5)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# UI2 additions (additive; no change to gate logic or guardrails)
# ---------------------------------------------------------------------------

# Non-destructive gate chain used by the narrated "Run Full Check".
# Excludes state-mutating steps (init, lock-manifest, finalize, prosecution/
# arbitration imports) on purpose — those stay explicit operator actions.
GATE_SEQUENCE = [
    "status",
    "manifest-lint",
    "structure",
    "enforce",
    "drift",
    "done-gate",
    "deployment-gate",
    "verify-artifacts",
    "integrity",
    "truth",
    "audit",
    "release-gate",
]

# Which command produces which report verdict (for live narration).
CMD_REPORT = {
    "manifest-lint": "manifest_lint",
    "enforce": "enforcement",
    "drift": "drift",
    "done-gate": "done_gate",
    "deployment-gate": "deployment_gate",
    "integrity": "integrity",
    "truth": "truth",
    "audit": "audit",
    "release-gate": "release_gate",
}


def projects_root() -> Path:
    """Sibling folder that holds all app builds (parent of the Forgetastic core)."""
    return core_root().parent


def list_projects() -> list[dict[str, Any]]:
    """List immediate sub-folders of the projects root as candidate targets."""
    root = projects_root()
    out: list[dict[str, Any]] = []
    try:
        entries = sorted(
            [p for p in root.iterdir() if p.is_dir()],
            key=lambda p: p.name.lower(),
        )
    except OSError:
        entries = []
    for p in entries:
        if p.name.startswith("."):
            continue
        out.append({
            "name": p.name,
            "path": str(p),
            "bootstrapped": (p / "tools" / "forgetastic" / "cli.py").exists(),
            "has_forge": (p / "forge").is_dir(),
        })
    return {"projects_root": str(root), "projects": out}


def list_dir(path_str: str | None) -> dict[str, Any]:
    """Read-only directory listing for the in-page file explorer (Phase 1).
    Lists sub-folders only; never reads file contents and never writes.
    Defaults to the projects root; exposes Windows drive letters for navigation."""
    import string

    base = Path(path_str).expanduser() if path_str else projects_root()
    try:
        base = base.resolve()
    except OSError:
        base = projects_root()

    drives: list[str] = []
    if os.name == "nt":
        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            if os.path.exists(root):
                drives.append(root)

    dirs: list[dict[str, str]] = []
    error = None
    try:
        for p in sorted(base.iterdir(), key=lambda x: x.name.lower()):
            try:
                if p.is_dir() and not p.name.startswith("."):
                    dirs.append({"name": p.name, "path": str(p)})
            except OSError:
                continue
    except (OSError, PermissionError) as exc:
        error = str(exc)

    parent = str(base.parent) if base.parent != base else None
    return {
        "path": str(base),
        "parent": parent,
        "drives": drives,
        "dirs": dirs,
        "error": error,
        "has_forge": (base / "forge").is_dir(),
        "bootstrapped": (base / "tools" / "forgetastic" / "cli.py").exists(),
    }


# --- Phase 2: reconciler (intent + code -> draft manifest + plan of action) ---

_RECON_SKIP_DOCS = {
    "FORGE_OPERATOR_LOOP.md", "INTENT_TO_MANIFEST.md", "HANDOFF_UI3.md", "HANDOFF_UI2.md",
    "KNOWN_LIMITS.md", "AGENTS.md", "RECONCILER_SPEC.md", "README_UI.md",
    "FORGETASTIC_PRO_1_MASTER_HANDOFF.md", "TRUST_BOUNDARY_ANALYSIS.md",
    "RELEASE_NOTES.md", "RELEASE_CHECKLIST.md", "PROJECT.md",
}
_INTENT_MARKERS = ("user can", "users can", "should be able", "must ", "allows ",
                   "allow ", "enable ", "the app ", "the system ", "supports ")
_CODE_DIRS = {"src", "app", "pages", "routes", "components", "api", "server", "lib", "backendforge"}


def _scan_intent(target: Path) -> list[dict[str, str]]:
    """Collect candidate intent statements from the target's own docs (not Forge docs)."""
    out: list[dict[str, str]] = []
    for p in sorted(target.glob("*.md")):
        if p.name in _RECON_SKIP_DOCS:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            s = line.strip()
            if not s:
                continue
            low = s.lower()
            if s.startswith("#"):
                title = s.lstrip("# ").strip()
                if 3 < len(title) < 120:
                    out.append({"text": title, "src": p.name})
            elif any(k in low for k in _INTENT_MARKERS) and len(s) < 200:
                out.append({"text": s.lstrip("-*0123456789. ").strip(), "src": p.name})
    return out


def _scan_code(target: Path) -> list[str]:
    hints: list[str] = []
    try:
        for p in sorted(target.iterdir()):
            if p.is_dir() and p.name.lower() in _CODE_DIRS:
                hints.append(p.name)
    except OSError:
        pass
    return hints


def reconcile(target: Path) -> dict[str, Any]:
    """Diff intent (docs) against code; propose a DRAFT manifest + reports + plan.
    Proposals are origin-tagged and required=false. NEVER auto-required, NEVER locked."""
    intent = _scan_intent(target)
    code = _scan_code(target)

    behaviors: list[dict[str, Any]] = []
    seen: set[str] = set()
    n = 1
    for item in intent:
        stmt = item["text"]
        key = stmt.lower()
        if not stmt or key in seen:
            continue
        seen.add(key)
        behaviors.append({
            "id": f"BHV-{n:03d}",
            "title": stmt[:80],
            "description": f"From {item['src']}: {stmt}",
            "required": False,
            "severity": "MAJOR",
            "origin": "intent",
            "given": "TODO — precondition",
            "when": "TODO — action",
            "then": "TODO — observable outcome",
            "notes": "Proposed from intent. Confirm, set required/severity, and fill Given/When/Then before locking.",
        })
        n += 1

    existing = read_json(target / "forge" / "manifest" / "MANIFEST.json", default={}) or {}
    draft = {
        "project": existing.get("project") or target.name,
        "mode": existing.get("mode", "STANDARD"),
        "purpose": existing.get("purpose", "TBD — describe what this app is for."),
        "operator_approved": False,
        "manifest_locked": False,
        "created_utc": utc_now(),
        "users": [],
        "behaviors": behaviors,
        "failures": [],
        "integrations": [],
        "assumptions": [],
        "out_of_scope": [],
        "_reconcile": {"intent_statements": len(intent), "code_dirs": code, "generated_utc": utc_now()},
    }
    write_json(target / "forge" / "manifest" / "DRAFT_MANIFEST.json", draft)

    reports_dir = target / "forge" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_lines = [
        "# Reconciliation Report",
        "",
        f"Generated: {utc_now()}",
        "",
        f"- Intent statements found: {len(intent)}",
        f"- Code directories detected: {', '.join(code) if code else 'none'}",
        f"- Proposed behaviors: {len(behaviors)}",
        "",
        "## Proposed behaviors (origin=intent, required=false — CONFIRM before locking)",
    ]
    report_lines += [f"- {b['id']}: {b['title']}  _(from {b['description'].split(':')[0]})_" for b in behaviors]
    if not behaviors:
        report_lines.append("- (none — no intent statements detected; author behaviors manually from the app's spec)")
    (reports_dir / "RECONCILIATION_REPORT.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    plan = (
        "# Plan of Action\n\n"
        "1. Review DRAFT_MANIFEST.json; mark genuinely-intended behaviors `required: true` and set severity.\n"
        "2. Fill each behavior's Given/When/Then so a proof is obvious. Delete noise; add anything missing.\n"
        "3. Tick **Operator approved** and **Approve & Save** (writes MANIFEST.json).\n"
        "4. Press **Next Step**: it runs `manifest-lint`, then **Lock**.\n"
        "5. Record real runtime proof for each required behavior (form or Node adapter).\n"
        "6. **Run Full Check** → address blockers (copy-prompt or onboard AI) → repeat until SHIP.\n"
    )
    (target / "forge" / "PLAN_OF_ACTION.md").write_text(plan, encoding="utf-8")

    return {
        "intent_count": len(intent),
        "code_dirs": code,
        "behavior_count": len(behaviors),
        "draft_path": "forge/manifest/DRAFT_MANIFEST.json",
        "draft": draft,
    }


def save_manifest(target: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Write MANIFEST.json from the editor. Refuses if the manifest is already
    locked (unlock is a deliberate action, not a silent edit). Saving never locks."""
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    path = target / "forge" / "manifest" / "MANIFEST.json"
    existing = read_json(path, default={}) or {}
    if existing.get("manifest_locked"):
        raise ValueError("Manifest is locked. Editing a locked manifest is not allowed here.")
    manifest["manifest_locked"] = False
    write_json(path, manifest)
    return {
        "ok": True,
        "behavior_count": len(manifest.get("behaviors", []) or []),
        "required_count": sum(1 for b in (manifest.get("behaviors") or []) if isinstance(b, dict) and b.get("required")),
        "operator_approved": bool(manifest.get("operator_approved")),
    }


def command_verdict(target: Path, command: str) -> str | None:
    name = CMD_REPORT.get(command)
    if not name:
        return None
    rep = read_json(target / REPORT_FILES[name], default=None)
    if isinstance(rep, dict):
        return rep.get("verdict") or rep.get("system_verdict") or rep.get("overall_verdict")
    return None


def next_step(target: Path, state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compute the single next legal action, deterministically, from current state.

    kind ∈ {select, bootstrap, manual, command, sequence, fix, done}
    """
    st = state if state is not None else read_state(target)

    if not st.get("target_exists"):
        return {"kind": "select", "label": "Select a valid target app folder",
                "why": "The chosen path does not exist."}

    if not st.get("bootstrapped"):
        return {"kind": "bootstrap", "label": "Bootstrap Forge into this app",
                "why": "forge/ tooling is not present in this folder yet."}

    m = st.get("manifest") or {}
    if not m.get("exists") or (m.get("behavior_count") or 0) == 0:
        return {"kind": "manual", "label": "Author MANIFEST.json from the intent doc",
                "why": "No behaviors declared. 100% is meaningless without a real contract.",
                "ref": "INTENT_TO_MANIFEST.md"}

    if (m.get("required_behavior_count") or 0) == 0:
        return {"kind": "manual", "label": "Mark required behaviors in the manifest",
                "why": "No required behaviors; a green verdict would be meaningless.",
                "ref": "INTENT_TO_MANIFEST.md"}

    if not m.get("manifest_locked"):
        reports = {r["name"]: r for r in st.get("reports", [])}
        lint = reports.get("manifest_lint", {})
        if not lint.get("exists") or lint.get("verdict") != "PASS":
            return {"kind": "command", "command": "manifest-lint", "label": "Run manifest-lint",
                    "why": "The manifest must lint clean before it can be locked."}
        return {"kind": "command", "command": "lock-manifest", "label": "Lock the manifest",
                "why": "Lint passed. Locking fixes the bar (protected from here on).",
                "confirm": True}

    proof_ok = False
    pj = target / "forge" / "evidence" / "RUNTIME_PROOF.jsonl"
    try:
        proof_ok = pj.exists() and pj.stat().st_size > 0
    except OSError:
        proof_ok = False
    if not proof_ok:
        return {"kind": "manual", "label": "Have the agent build and record runtime proof",
                "why": "No runtime proof yet. The agent runs the app/tests, then `prove` records evidence.",
                "ref": "FORGE_OPERATOR_LOOP.md"}

    if (st.get("release") or {}).get("ship_status") == "SHIP":
        return {"kind": "done", "label": "Shipped — release-gate PASS",
                "why": "All gates are green at the locked contract."}

    blockers = st.get("blockers") or []
    if blockers:
        return {"kind": "fix", "label": "Address the blocking items, then re-check",
                "why": f"{len(blockers)} blocking item(s) remain. Fix app code (agent), then run the full check.",
                "count": len(blockers)}

    return {"kind": "sequence", "label": "Run Full Check (narrated)",
            "why": "Regenerate the gate chain to get the current verdict."}


# ---------------------------------------------------------------------------
# Item C: guardrailed auto-fix loop (experimental, opt-in, OFF by default)
# The agent may edit APP CODE only. A protected-file hash baseline is captured
# up front; any change to MANIFEST/policy/protected engine files after an agent
# pass is a HARD STOP + rollback. The agent command is read ONLY from a local
# config file the operator must deliberately create — never from the browser.
# ---------------------------------------------------------------------------

AUTOFIX_CONFIG = STATE_DIR / "AUTOFIX_CONFIG.json"
AUTOFIX_MAX_ITER_CAP = 10


def _git(target: Path, args: list[str], timeout: int = 60) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            ["git", *args], cwd=str(target), text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
        )
        return {"ok": proc.returncode == 0, "code": proc.returncode,
                "out": (proc.stdout or "").strip(), "err": (proc.stderr or "").strip()}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "code": -1, "out": "", "err": str(exc)}


def has_git(target: Path) -> bool:
    return (target / ".git").exists() and shutil.which("git") is not None


def _zip_target(target: Path, zip_base: Path) -> Path:
    import zipfile
    archive = Path(str(zip_base) + ".zip")
    skip = {".git", "node_modules", ".venv", "__pycache__"}
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in target.rglob("*"):
            rel = p.relative_to(target)
            if any(part in skip for part in rel.parts):
                continue
            if p.is_file():
                try:
                    zf.write(p, rel)
                except OSError:
                    continue
    return archive


def create_checkpoint(target: Path) -> dict[str, Any]:
    """Create a hard rollback point BEFORE any agent edit. Auto-fix is allowed
    only when git can make a real checkpoint commit. A zip backup is useful for
    manual recovery, but it is not a safe automatic rollback boundary, so it is
    deliberately not used by the auto-fix loop."""
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    if not has_git(target):
        return {
            "ok": False,
            "kind": "git_required",
            "error": "Auto-fix requires a git repo and git on PATH so rollback can be automatic.",
        }

    add = _git(target, ["add", "-A"])
    if not add["ok"]:
        return {"ok": False, "kind": "git", "error": add["err"] or add["out"] or "git add failed"}

    commit = _git(target, ["commit", "--allow-empty", "-m", f"forge-autofix checkpoint {ts}"])
    if not commit["ok"]:
        return {
            "ok": False,
            "kind": "git",
            "error": commit["err"] or commit["out"] or "git commit checkpoint failed",
        }

    head = _git(target, ["rev-parse", "HEAD"])
    if not head["ok"] or not head["out"]:
        return {"ok": False, "kind": "git", "error": head["err"] or "could not resolve HEAD"}

    status = _git(target, ["status", "--porcelain"])
    if not status["ok"]:
        return {"ok": False, "kind": "git", "error": status["err"] or "git status failed"}
    if status["out"].strip():
        return {
            "ok": False,
            "kind": "git",
            "error": "working tree is not clean after checkpoint; aborting auto-fix",
        }

    return {"ok": True, "kind": "git", "ref": head["out"], "ts": ts}


def rollback_checkpoint(target: Path, checkpoint: dict[str, Any]) -> dict[str, Any]:
    """Undo agent edits. Auto rollback is intentionally git-only."""
    if checkpoint.get("kind") == "git" and checkpoint.get("ref"):
        r = _git(target, ["reset", "--hard", str(checkpoint["ref"])])
        c = _git(target, ["clean", "-fd"])
        return {"ok": bool(r["ok"] and c["ok"]),
                "detail": ((r["err"] or "") + " " + (c["err"] or "")).strip()}
    return {"ok": False, "detail": "No git checkpoint available for automatic rollback."}


def _config_models(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize both config schemas into a list of model dicts.
    New:   {"models":[{"name","kind","command":[...]}], "selected":"name"}
    Legacy:{"agent_command":[...]}  -> a single model named 'default'."""
    models = cfg.get("models")
    if isinstance(models, list) and models:
        return [m for m in models if isinstance(m, dict) and m.get("name")]
    legacy = cfg.get("agent_command")
    if isinstance(legacy, list) and legacy:
        return [{"name": "default", "kind": "cli", "command": legacy}]
    return []


def read_agent_config(target: Path) -> dict[str, Any] | None:
    """Resolve the SELECTED code-editing agent. The command is trusted ONLY from
    this local file — never from HTTP. The browser may pick a model by NAME, but
    the command/endpoint/keys live here. Only `kind:"cli"` models can edit code."""
    cfg = read_json(target / AUTOFIX_CONFIG, default=None)
    if not isinstance(cfg, dict) or not cfg.get("enabled"):
        return None
    models = _config_models(cfg)
    if not models:
        return None
    selected = cfg.get("selected")
    chosen = next((m for m in models if m.get("name") == selected), None) or models[0]
    if chosen.get("kind", "cli") != "cli":
        return None  # api-kind models draft text; they cannot edit code
    command = chosen.get("command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
        return None
    return {"command": command, "model_name": chosen.get("name"), "kind": "cli"}


def list_models(target: Path) -> dict[str, Any]:
    """Return configured model NAMES + kind only (never commands or keys) for the
    UI selector. Read-only; safe to expose to the browser."""
    cfg = read_json(target / AUTOFIX_CONFIG, default=None)
    if not isinstance(cfg, dict):
        return {"enabled": False, "models": [], "selected": None, "present": False}
    out = []
    for m in _config_models(cfg):
        cmd = m.get("command")
        out.append({
            "name": m.get("name"),
            "kind": m.get("kind", "cli"),
            "runnable": bool(isinstance(cmd, list) and cmd) or m.get("kind") == "api",
        })
    selected = cfg.get("selected") or (out[0]["name"] if out else None)
    return {"enabled": bool(cfg.get("enabled")), "models": out, "selected": selected, "present": True}


def select_model(target: Path, name: str) -> dict[str, Any]:
    """Persist the selected model NAME. Refuses names not already defined in the
    local config, so the browser cannot introduce a new command/endpoint."""
    path = target / AUTOFIX_CONFIG
    cfg = read_json(path, default=None)
    if not isinstance(cfg, dict):
        raise ValueError("No AUTOFIX_CONFIG.json in this target. Create it to enable onboard AI.")
    names = [m.get("name") for m in _config_models(cfg)]
    if name not in names:
        raise ValueError(f"Model '{name}' is not defined in AUTOFIX_CONFIG.json.")
    cfg["selected"] = name
    write_json(path, cfg)
    return {"selected": name}


# Built-in agent presets. Commands come from THIS server catalog only — the
# browser never supplies a command, only a preset id (+ optional model name).
AGENT_PRESETS = [
    {"id": "claude-code", "label": "Claude Code (cloud)", "kind": "cli",
     "command": ["claude", "-p"], "needs_model": False, "model_default": "",
     "notes": "Requires the `claude` CLI on PATH."},
    {"id": "aider-ollama", "label": "Aider + Ollama (local)", "kind": "cli",
     "command": ["aider", "--model", "ollama/{model}", "--yes", "--message"],
     "needs_model": True, "model_default": "llama3",
     "notes": "Local model via Ollama. Requires `aider` + a running Ollama."},
    {"id": "aider-anthropic", "label": "Aider + Claude (cloud)", "kind": "cli",
     "command": ["aider", "--model", "{model}", "--yes", "--message"],
     "needs_model": True, "model_default": "claude-3-5-sonnet",
     "notes": "Requires `aider` + ANTHROPIC_API_KEY."},
    {"id": "aider-openai", "label": "Aider + OpenAI (cloud)", "kind": "cli",
     "command": ["aider", "--model", "{model}", "--yes", "--message"],
     "needs_model": True, "model_default": "gpt-4o",
     "notes": "Requires `aider` + OPENAI_API_KEY."},
]


def list_model_presets() -> dict[str, Any]:
    """Static catalog (no secrets, no target needed) for the 'Add a model' picker."""
    return {"presets": [
        {"id": p["id"], "label": p["label"], "kind": p["kind"],
         "needs_model": p.get("needs_model", False),
         "model_default": p.get("model_default", ""), "notes": p.get("notes", "")}
        for p in AGENT_PRESETS
    ]}


def enable_model(target: Path, preset_id: str, model_name: str | None) -> dict[str, Any]:
    """Write AUTOFIX_CONFIG.json for the operator from a preset. The command is
    built from the server-side AGENT_PRESETS catalog; the only browser-supplied
    value is the model name, inserted as a single argv element (never a shell)."""
    preset = next((p for p in AGENT_PRESETS if p["id"] == preset_id), None)
    if preset is None:
        raise ValueError(f"Unknown preset '{preset_id}'.")
    model = (model_name or preset.get("model_default") or "").strip()
    if preset.get("needs_model") and not model:
        raise ValueError("This preset needs a model name.")
    command = [part.replace("{model}", model) if "{model}" in part else part for part in preset["command"]]

    path = target / AUTOFIX_CONFIG
    cfg = read_json(path, default=None)
    if not isinstance(cfg, dict):
        cfg = {"enabled": True, "models": [], "selected": None}
    models = cfg.get("models")
    if not isinstance(models, list):
        models = []
        legacy = cfg.get("agent_command")
        if isinstance(legacy, list) and legacy:
            models.append({"name": "default", "kind": "cli", "command": legacy})

    name = preset["label"] + ((" (" + model + ")") if model else "")
    models = [m for m in models if not (isinstance(m, dict) and m.get("name") == name)]
    models.append({"name": name, "kind": preset["kind"], "command": command, "preset_id": preset_id})
    cfg["models"] = models
    cfg["selected"] = name
    cfg["enabled"] = True
    write_json(path, cfg)
    return {"selected": name, "enabled": True, "count": len(models)}


def run_agent(target: Path, command: list[str], prompt: str, timeout: int = 900) -> dict[str, Any]:
    """Invoke the operator-configured builder agent, prompt appended as the final
    arg (list-form, no shell). The agent is trusted to edit app code; the loop's
    protected-file drift check is what enforces it does not touch the contract."""
    argv = list(command) + [prompt]
    try:
        proc = subprocess.run(
            argv, cwd=str(target), text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
        )
        return {"ok": proc.returncode == 0, "code": proc.returncode,
                "out": proc.stdout or "", "err": proc.stderr or ""}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "code": -1, "out": "", "err": str(exc)}


def build_fix_prompt(target: Path, blocker: dict[str, Any]) -> str:
    return (
        f"You are fixing ONE issue in the application at {target}.\n"
        "Fix ONLY application code. Do NOT modify MANIFEST.json, forge/policy/, or any protected "
        "truth/audit/release/integrity/finalization engine files. Do not fake proof or weaken any gate.\n\n"
        f"Issue [{blocker.get('source')}] {blocker.get('id', '')}:\n{blocker.get('message', '')}\n\n"
        "Make the minimal change that resolves this issue, then stop."
    )


# ---------------------------------------------------------------------------
# Phase 3 (additive): per-task testing log for Begin Testing / Run Full Check.
# Documents, in order, what the gate chain did on this run. Does not change
# gate logic, verdicts, or any existing event/endpoint.
# ---------------------------------------------------------------------------


def build_external_fix_prompt(target: Path) -> dict[str, Any]:
    """Write forge/FIX_PROMPT.md — a guarded prompt for an EXTERNAL AI platform to
    read the forge papers and refactor app code. Plain string building (3.11-safe).
    This is the 'external' arm of the fix choice tree; onboard AI is the auto-fix loop."""
    blockers = collect_blockers(target)
    manifest = manifest_summary(target)
    project = manifest.get("project") or target.name

    lines: list[str] = []
    lines.append("# Forge Fix Prompt — " + str(project))
    lines.append("")
    lines.append("Generated (UTC): " + utc_now())
    lines.append("Target: " + str(target))
    lines.append("")
    lines.append("## Your job")
    lines.append("Fix the application code so it satisfies its Forge contract. Forge is the referee; you are the builder.")
    lines.append("")
    lines.append("## Read these first (context)")
    for doc in [
        "FORGE_OPERATOR_LOOP.md", "INTENT_TO_MANIFEST.md", "PLAN_OF_ACTION.md",
        "forge/reports/RECONCILIATION_REPORT.md", "forge/reports/TRUTH_REPORT.json",
        "forge/reports/AUDIT_REPORT.json", "forge/manifest/MANIFEST.json",
    ]:
        lines.append("- " + doc)
    lines.append("")
    lines.append("## Rules (non-negotiable)")
    lines.append("- Fix ONLY application code.")
    lines.append("- Do NOT modify MANIFEST.json, forge/policy/, or any truth/audit/release/integrity/finalization engine files.")
    lines.append("- Do NOT fake proof or weaken any gate. If it can lie, it is not done.")
    lines.append("")
    lines.append("## Blocking items to resolve (" + str(len(blockers)) + ")")
    if not blockers:
        lines.append("- (none in current reports — run Forge to refresh)")
    else:
        for i, b in enumerate(blockers, start=1):
            src = str(b.get("source", ""))
            bid = str(b.get("id", "") or "")
            msg = str(b.get("message", ""))
            lines.append(str(i) + ". [" + src + "] " + bid + " — " + msg)
    lines.append("")
    lines.append("## After you fix")
    lines.append("Stop. The operator re-runs the Forge gate chain to verify. Repeat until release-gate PASS.")

    text = "\n".join(lines) + "\n"
    out = target / "forge" / "FIX_PROMPT.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return {"path": "forge/FIX_PROMPT.md", "blocker_count": len(blockers), "prompt": text}


def write_testing_log(
    target: Path,
    rows: list[dict[str, Any]],
    ship_status: str | None,
    blocker_count: int,
) -> str:
    """Write forge/reports/TESTING_LOG_<ts>.md documenting each gate command
    in order. Plain string building only (no nested f-strings) so this stays
    Python 3.11-safe. Returns the path relative to target."""
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    lines: list[str] = []
    lines.append("# Testing Log")
    lines.append("")
    lines.append("Target: " + str(target))
    lines.append("Generated (UTC): " + utc_now())
    lines.append("")
    lines.append("## Gate sequence (in order)")
    lines.append("")
    for i, row in enumerate(rows, start=1):
        command = str(row.get("command"))
        verdict = row.get("verdict")
        ok = row.get("ok")
        elapsed = row.get("elapsed")
        outcome = verdict if verdict else ("ok" if ok else "exit")
        elapsed_str = str(elapsed) if elapsed is not None else "n/a"
        line = str(i) + ". " + command + " — " + str(outcome) + " (" + elapsed_str + "s)"
        lines.append(line)
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("Ship status: " + str(ship_status))
    lines.append("Blocker count: " + str(blocker_count))
    lines.append("")
    text = "\n".join(lines)
    rel_path = "forge/reports/TESTING_LOG_" + ts + ".md"
    out_path = target / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    return rel_path


def write_handoff(target: Path) -> dict[str, Any]:
    """Phase 5 (additive): recognize a release-gate pass and write
    forge/HANDOFF.md — a complete handoff doc for whoever picks this app up
    next. ALWAYS writes (even when not yet SHIP) so the doc always reflects
    the real ship_status; the header says SHIPPED only when ship_status is
    SHIP. Plain string building only (list of lines + "\n".join, no f-strings
    anywhere, nested or otherwise) so this stays Python 3.11-safe. Read-only
    against gate logic — this only reads read_state(target) and writes one
    markdown file."""
    state = read_state(target)
    manifest = state.get("manifest") or {}
    reports = state.get("reports") or []
    blockers = state.get("blockers") or []
    prosecution = state.get("prosecution") or {}
    release = state.get("release") or {}
    ship_status = release.get("ship_status")

    lines: list[str] = []
    lines.append("# Handoff")
    lines.append("")
    if ship_status == "SHIP":
        lines.append("STATUS: SHIPPED")
    else:
        lines.append("STATUS: NOT YET SHIPPED")
    lines.append("")
    lines.append("Project: " + str(manifest.get("project")))
    lines.append("Generated (UTC): " + utc_now())
    lines.append("Target: " + str(target))
    lines.append("")
    lines.append("## Release verdict")
    lines.append("")
    lines.append("Ship status: " + str(ship_status))
    lines.append("release-gate verdict: " + str(release.get("release_gate_verdict")))
    lines.append("audit verdict: " + str(release.get("audit_verdict")))
    lines.append("")
    lines.append("## Manifest")
    lines.append("")
    lines.append("Project: " + str(manifest.get("project")))
    lines.append("Mode: " + str(manifest.get("mode")))
    lines.append("Behavior count: " + str(manifest.get("behavior_count")))
    lines.append("Required behavior count: " + str(manifest.get("required_behavior_count")))
    lines.append("Manifest locked: " + str(manifest.get("manifest_locked")))
    manifest_hash = str(manifest.get("manifest_hash") or "")
    lines.append("Manifest hash (first 16): " + manifest_hash[:16])
    lines.append("")
    lines.append("## Report verdicts")
    lines.append("")
    if not reports:
        lines.append("- (no reports found)")
    else:
        for r in reports:
            name = str(r.get("name"))
            verdict = str(r.get("verdict"))
            generated = str(r.get("generated_utc"))
            lines.append("- " + name + ": " + verdict + " (" + generated + ")")
    lines.append("")
    lines.append("## Prosecution / arbitration")
    lines.append("")
    lines.append("A present: " + str(prosecution.get("a_exists")))
    lines.append("B present: " + str(prosecution.get("b_exists")))
    lines.append("Comparison verdict: " + str(prosecution.get("comparison_verdict")))
    lines.append("Disagreement count: " + str(prosecution.get("disagreement_count")))
    lines.append("Arbitration present: " + str(prosecution.get("arbitration_exists")))
    lines.append("")
    lines.append("## Open blockers")
    lines.append("")
    lines.append("Blocker count: " + str(len(blockers)))
    if not blockers:
        lines.append("- (none)")
    else:
        for i, b in enumerate(blockers, start=1):
            src = str(b.get("source", ""))
            bid = str(b.get("id", "") or "")
            msg = str(b.get("message", ""))
            lines.append(str(i) + ". [" + src + "] " + bid + " — " + msg)
    lines.append("")
    lines.append("## Key artifacts")
    lines.append("")
    artifact_candidates = [
        "forge/final/FINAL_SNAPSHOT.json",
        "forge/final/LOCK",
        "forge/manifest/MANIFEST.json",
        "forge/PLAN_OF_ACTION.md",
        "forge/reports/RECONCILIATION_REPORT.md",
    ]
    present_any = False
    for rel in artifact_candidates:
        p = target / rel
        if p.exists():
            lines.append("- " + rel)
            present_any = True
    testing_logs = sorted((target / "forge" / "reports").glob("TESTING_LOG_*.md"))
    if testing_logs:
        latest = testing_logs[-1]
        rel_latest = "forge/reports/" + latest.name
        lines.append("- " + rel_latest + " (latest testing log)")
        present_any = True
    if not present_any:
        lines.append("- (no key artifacts found yet)")
    lines.append("")
    lines.append("## Next steps for whoever picks this up")
    lines.append("")
    lines.append("1. Read this HANDOFF.md, then forge/PLAN_OF_ACTION.md for the ordered remediation list.")
    lines.append("2. Check the Release verdict above; if not SHIP, see Open blockers for what remains.")
    lines.append("3. Re-run Run Full Check (narrated) to regenerate current verdicts before making changes.")
    lines.append("4. Do not edit forge/manifest/MANIFEST.json, forge/policy/, or protected engine files directly.")
    lines.append("5. When release-gate PASSes, this document is regenerated automatically.")
    lines.append("")

    text = "\n".join(lines) + "\n"
    out_path = target / "forge" / "HANDOFF.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    return {"path": "forge/HANDOFF.md", "ship_status": ship_status, "wrote": True}


INDEX_HTML = r'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Forgetastic Control Panel</title>
  <style>
    :root { --bg:#0b0f14; --panel:#121923; --panel2:#172231; --text:#e6edf3; --muted:#9fb1c3; --line:#2a3748; --bad:#ff6b6b; --good:#5fe38b; --warn:#ffd166; --blue:#7ab7ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Arial, Helvetica, sans-serif; background:var(--bg); color:var(--text); }
    header { padding:18px 22px; border-bottom:1px solid var(--line); background:#0f1620; position:sticky; top:0; z-index:5; }
    h1 { margin:0; font-size:22px; }
    .summary { color:var(--muted); margin-top:6px; font-size:14px; }
    .wrap { padding:18px; display:grid; grid-template-columns: 360px 1fr; gap:16px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px; box-shadow:0 2px 10px rgba(0,0,0,.18); }
    .card h2 { font-size:15px; margin:0 0 10px; text-transform:uppercase; letter-spacing:.05em; color:#cbd8e6; }
    label { font-size:12px; color:var(--muted); display:block; margin:10px 0 4px; }
    input, textarea, select { width:100%; background:#0a111a; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:10px; font-size:13px; }
    textarea { min-height:150px; font-family: Consolas, monospace; }
    button { background:#1e62a6; color:white; border:0; border-radius:8px; padding:9px 11px; cursor:pointer; font-weight:700; font-size:12px; margin:4px 4px 4px 0; }
    button.secondary { background:#2a3748; }
    button.danger { background:#9f2d38; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(210px,1fr)); gap:10px; }
    .stat { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:10px; }
    .stat .k { color:var(--muted); font-size:12px; }
    .stat .v { font-size:18px; margin-top:3px; font-weight:700; }
    .good { color:var(--good); } .bad { color:var(--bad); } .warn { color:var(--warn); } .muted { color:var(--muted); } .blue { color:var(--blue); }
    .pipeline { display:flex; flex-wrap:wrap; gap:8px; }
    .stage { border:1px solid var(--line); border-radius:999px; padding:7px 10px; font-size:12px; background:#0a111a; }
    .PASS { border-color:#2d8f4e; color:var(--good); }
    .FAIL, .BLOCKED { border-color:#ba3b46; color:var(--bad); }
    .STALE, .UNKNOWN { border-color:#b58b2b; color:var(--warn); }
    .MISSING { color:var(--muted); }
    pre { white-space:pre-wrap; word-break:break-word; background:#05080d; border:1px solid var(--line); padding:12px; border-radius:10px; max-height:360px; overflow:auto; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid var(--line); padding:7px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:12px; }
    .blocker { background:#1f1115; border:1px solid #61303a; border-radius:8px; padding:10px; margin:8px 0; }
    .toolbar { display:flex; flex-wrap:wrap; gap:4px; }
    .tiny { font-size:11px; color:var(--muted); }
    .ship { font-size:32px; font-weight:900; letter-spacing:.04em; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .projlist { max-height:220px; overflow:auto; margin:4px 0; display:flex; flex-direction:column; gap:3px; }
    .projbtn { display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; margin:0; background:#172231; }
    .projbtn:hover { background:#1e62a6; }
    .browser { max-height:240px; overflow:auto; border:1px solid var(--line); border-radius:8px; padding:8px; margin:6px 0; background:#0a111a; }
    .browser .path { font-size:11px; color:var(--muted); word-break:break-all; margin-bottom:6px; }
    .browser .row { padding:4px 6px; cursor:pointer; border-radius:6px; }
    .browser .row:hover { background:#1e62a6; }
    #liveLog { max-height:300px; overflow:auto; }
    @media (max-width: 980px) { .wrap { grid-template-columns:1fr; } .split { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<header>
  <h1>Forgetastic Control Panel</h1>
  <div class="summary">Referee, not player. The UI runs Forge gates; Claude/Cursor/AppFinisher fixes app code; release-gate decides ship/no-ship.</div>
</header>
<main class="wrap">
  <aside>
    <div class="card">
      <h2>Target App</h2>
      <label>Search your app builds</label>
      <input id="projSearch" placeholder="type to filter folders..." oninput="renderProjects()" />
      <div id="projList" class="projlist"></div>
      <label>Or paste an absolute folder path</label>
      <input id="target" placeholder="D:\\AI Builds-OM\\0_PROJECTS\\Gigtastic" />
      <button class="secondary" onclick="toggleBrowser()">Browse folders…</button>
      <div id="browser" class="browser" style="display:none;"></div>
      <button onclick="loadTarget()">Load Target App</button>
      <button class="secondary" onclick="refresh()">Refresh</button>
      <button class="secondary" onclick="useSelf()">Use Forgetastic Folder</button>
      <div class="tiny" id="targetHint"></div>
    </div>

    <div class="card">
      <h2>Release Verdict</h2>
      <div id="ship" class="ship muted">UNKNOWN</div>
      <div id="releaseDetails" class="tiny"></div>
    </div>

    <div class="card">
      <h2>Protected Files</h2>
      <div id="protectedBox" class="tiny">Load a target.</div>
    </div>

    <div class="card">
      <h2>CLI Commands</h2>
      <div class="toolbar" id="cmdButtons"></div>
    </div>
  </aside>

  <section>
    <div id="successBanner" class="card" style="display:none; border-color:#2d8f4e; background:#0e1f14;">
      <div class="ship good">✓ 100% — SHIP</div>
      <div class="tiny" id="successDetails"></div>
      <button onclick="writeHandoff()">📝 Write HANDOFF.md</button>
    </div>

    <div class="card" style="border-color:#1e62a6;">
      <h2>Next Step</h2>
      <div id="nextLabel" class="v" style="font-size:18px;">—</div>
      <div id="nextWhy" class="tiny" style="margin:6px 0;"></div>
      <div id="nextRef" class="tiny blue"></div>
      <button id="nextBtn" onclick="doNext()" style="margin-top:8px;">Next</button>
    </div>

    <div class="card">
      <h2>Run Full Check — narrated</h2>
      <button onclick="runSequence()">▶ Run Full Check</button>
      <div id="progressStepper" class="pipeline"></div>
      <span class="tiny">Runs the non-destructive gate chain and narrates each step.</span>
      <pre id="liveLog" style="margin-top:10px;">Idle. Press Run Full Check to watch Forge work through the pipeline.</pre>
    </div>

    <div class="card" style="border-color:#9f2d38;">
      <h2>Auto-Fix Loop — experimental</h2>
      <div class="tiny">Lets your configured builder agent edit THIS app's code in a loop: checkpoint → agent fixes one blocker → protected-file drift hard-stop → re-run gates → repeat until SHIP or stuck. OFF by default. Requires <code>forge/state/AUTOFIX_CONFIG.json</code> with <code>{"enabled":true,"agent_command":[...]}</code>. Output streams to the log above.</div>
      <label style="margin-top:8px;"><input type="checkbox" id="autofixEnable" onchange="toggleAutofix()" style="width:auto; margin-right:6px;" />Enable auto-edit (I understand this modifies app code)</label>
      <label>AI model — local or cloud</label>
      <select id="modelSelect" onchange="selectModel()"></select>
      <div class="tiny" id="modelHint"></div>
      <label>Add a model — one click, no JSON editing</label>
      <select id="presetSelect" onchange="onPresetChange()"></select>
      <input id="presetModel" placeholder="model name (e.g. llama3)" style="display:none;" />
      <button class="secondary" onclick="enableModelPreset()">Enable this model</button>
      <div class="tiny" id="presetHint"></div>
      <label>Max iterations (1–10)</label>
      <input id="autofixMax" type="number" min="1" max="10" value="3" />
      <button id="autofixBtn" class="danger" onclick="runAutofix()" disabled>▶ Run Auto-Fix Loop</button>
      <div class="tiny" id="autofixHint"></div>
    </div>

    <div class="card">
      <h2>Pipeline</h2>
      <div id="pipeline" class="pipeline"></div>
    </div>

    <div class="grid">
      <div class="stat"><div class="k">Project</div><div id="project" class="v">—</div></div>
      <div class="stat"><div class="k">Manifest</div><div id="manifestStatus" class="v">—</div></div>
      <div class="stat"><div class="k">Required Behaviors</div><div id="requiredCount" class="v">—</div></div>
      <div class="stat"><div class="k">Current Stage</div><div id="currentStage" class="v">—</div></div>
    </div>

    <div class="card" id="manifestCard" style="border-color:#7ab7ff;">
      <h2>Manifest — Reconcile &amp; Author</h2>
      <div class="tiny">No manifest yet? <b>Reconcile</b> drafts behaviors from the app's intent docs + code (proposals only — never auto-required, never auto-locked). Review/edit the JSON, mark the real ones <code>"required": true</code>, tick approved, and Save. Then press <b>Next Step</b> to lint &amp; lock.</div>
      <button onclick="runReconcile()">🔧 Reconcile — draft from intent + code</button>
      <button class="secondary" onclick="loadCurrentManifest()">Load current manifest</button>
      <div id="behaviorList" style="max-height:300px; overflow:auto; margin:8px 0;"></div>
      <button class="secondary" onclick="markAllRequired()">Mark all required</button>
      <button onclick="saveBehaviors()">✓ Save behaviors + approve</button>
      <div class="tiny">Tick the behaviors that are genuinely intended, set severity, then Save. (Raw JSON below for full control.)</div>
      <textarea id="manifestEditor" placeholder="Reconcile or Load current to populate, then edit the JSON…" style="min-height:160px;"></textarea>
      <label><input type="checkbox" id="operatorApprove" style="width:auto; margin-right:6px;" />Operator approved — I confirm these behaviors are genuinely intended</label>
      <button onclick="saveManifestEdit()">Approve &amp; Save</button>
      <div class="tiny" id="manifestEditHint"></div>
    </div>

    <div class="split">
      <div class="card">
        <h2>Manifest Status</h2>
        <div id="manifestBox"></div>
      </div>
      <div class="card" id="guidedCard">
        <h2>Guided Next Steps</h2>
        <button class="secondary" onclick="copyBlockers()">Copy all blockers for agent</button>
        <button class="secondary" onclick="genFixPrompt()">📄 Generate external AI fix prompt</button>
        <div id="guided"></div>
      </div>
    </div>

    <div class="card">
      <h2>Reports</h2>
      <div id="reports"></div>
    </div>

    <div class="card">
      <h2>Prosecution / Arbitration Import</h2>
      <div class="split">
        <div>
          <label>Prosecutor A JSON</label>
          <textarea id="reviewA"></textarea>
          <button onclick="importReview('A')">Import A</button>
        </div>
        <div>
          <label>Prosecutor B JSON</label>
          <textarea id="reviewB"></textarea>
          <button onclick="importReview('B')">Import B</button>
        </div>
      </div>
      <label>Arbitration JSON</label>
      <textarea id="reviewArb"></textarea>
      <button onclick="importReview('ARBITRATION')">Import Arbitration</button>
      <div id="prosecutionBox" class="tiny"></div>
    </div>

    <div class="card">
      <h2>Record Runtime Proof</h2>
      <label>Behavior</label>
      <select id="proofBehavior"></select>
      <div class="split">
        <div>
          <label>Proof Type</label>
          <select id="proofType">
            <option>MANUAL</option>
            <option>CLI</option>
            <option>TEST</option>
            <option>API</option>
            <option>UI</option>
            <option>INTEGRATION</option>
          </select>
        </div>
        <div>
          <label>Environment</label>
          <select id="proofEnvironment">
            <option>LOCAL</option>
            <option>DEV</option>
            <option>STAGING</option>
            <option>PROD</option>
            <option>ANY</option>
          </select>
        </div>
      </div>
      <label>Status</label>
      <select id="proofStatus">
        <option value="">— choose based on the real run —</option>
        <option value="PASS">PASS</option>
        <option value="FAIL">FAIL</option>
        <option value="ENVIRONMENTAL">ENVIRONMENTAL</option>
      </select>
      <label>Runner</label>
      <input id="proofRunner" placeholder="e.g. pytest, manual, npm test" />
      <label>Command</label>
      <input id="proofCommand" placeholder="the exact command run" />
      <label>Input Summary</label>
      <input id="proofInputSummary" placeholder="what was tested" />
      <label>Expected Summary</label>
      <input id="proofExpectedSummary" placeholder="what was expected" />
      <label>Actual Summary</label>
      <input id="proofActualSummary" placeholder="what actually happened" />
      <label>Artifacts (comma-separated paths)</label>
      <input id="proofArtifacts" placeholder="forge/evidence/run1.log, ..." />
      <label>Confidence (1-6)</label>
      <input id="proofConfidence" type="number" min="1" max="6" />
      <label>Session ID (optional)</label>
      <input id="proofSessionId" placeholder="optional" />
      <button id="proveBtn" onclick="recordProof()" style="margin-top:10px;">Record Proof</button>
      <div class="tiny" id="proveHint"></div>
      <hr style="border-color:var(--line); margin:12px 0;" />
      <button id="runAdapterBtn" class="secondary" onclick="runAdapter()">▶ Run &amp; Prove (Node adapter)</button>
      <div class="tiny">For JS/Node apps: installs if needed, starts the app via its declared script (start.bat / npm run dev / npm start) on an open port, checks the main route, and automatically records proof for the Behavior selected above. Output streams to the Run Full Check live log.</div>
    </div>

    <div class="card">
      <h2>Last Command</h2>
      <pre id="output">No command run yet.</pre>
    </div>
  </section>
</main>
<script>
const commands = ["status","validate-order","manifest-lint","lock-manifest","structure","enforce","drift","done-gate","prosecution-bundle","arbitration-bundle","deployment-gate","verify-artifacts","integrity","truth","audit","finalize-gate","finalize","release-gate","report-status","doctor"];
// Mirrors GATE_SEQUENCE server-side (Phase 3 progress stepper fallback).
const GATE_SEQUENCE_CLIENT = ["status","manifest-lint","structure","enforce","drift","done-gate","deployment-gate","verify-artifacts","integrity","truth","audit","release-gate"];
let lastState = null;
function el(id){ return document.getElementById(id); }
function target(){ return el('target').value.trim(); }
function clsStatus(s){ return s || 'UNKNOWN'; }
function safeText(x){ return (x===null || x===undefined) ? '' : String(x); }
function setOutput(obj){ el('output').textContent = typeof obj === 'string' ? obj : JSON.stringify(obj,null,2); }
function initButtons(){ el('cmdButtons').innerHTML = commands.map(c => `<button onclick="runCmd('${c}')">${c}</button>`).join(''); }
function useSelf(){ el('target').value = window.__CORE_ROOT__ || ''; loadState(); }
async function api(path, body){
  const res = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || res.statusText); }
  return data;
}
async function loadState(){
  try {
    const q = encodeURIComponent(target());
    const res = await fetch(`/api/state?target=${q}`);
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    lastState = data;
    render(data);
  } catch(e){ setOutput('STATE ERROR: '+e.message); }
}
async function bootstrap(){
  try { const data = await api('/api/bootstrap', {target: target()}); setOutput(data); await refresh(); }
  catch(e){ setOutput('BOOTSTRAP ERROR: '+e.message); }
}
async function runCmd(command){
  try { const data = await api('/api/run', {target: target(), command}); setOutput(formatRun(data)); await refresh(); }
  catch(e){ setOutput('COMMAND ERROR: '+e.message); }
}
function formatRun(r){ return `$ ${r.cmdline ? r.cmdline.join(' ') : r.command}\nexit_code: ${r.exit_code}\nelapsed: ${r.elapsed_seconds}s\n\nSTDOUT\n${r.stdout||''}\n\nSTDERR\n${r.stderr||''}`; }
async function importReview(kind){
  const text = kind==='A' ? el('reviewA').value : kind==='B' ? el('reviewB').value : el('reviewArb').value;
  try { const data = await api('/api/import-review', {target: target(), kind, json_text:text}); setOutput(formatRun(data)); await refresh(); }
  catch(e){ setOutput('IMPORT ERROR: '+e.message); }
}
async function recordProof(){
  const artifactsRaw = (el('proofArtifacts').value || '').split(',').map(s=>s.trim()).filter(Boolean);
  const payload = {
    target: target(),
    manifest_id: el('proofBehavior').value,
    proof_type: el('proofType').value,
    environment: el('proofEnvironment').value,
    status: el('proofStatus').value,
    runner: el('proofRunner').value,
    command: el('proofCommand').value,
    input_summary: el('proofInputSummary').value,
    expected_summary: el('proofExpectedSummary').value,
    actual_summary: el('proofActualSummary').value,
    artifacts: artifactsRaw,
    confidence: el('proofConfidence').value,
  };
  const sessionId = (el('proofSessionId').value || '').trim();
  if(sessionId){ payload.session_id = sessionId; }
  try { const data = await api('/api/prove', payload); setOutput(formatRun(data)); await refresh(); }
  catch(e){ setOutput('PROVE ERROR: '+e.message); }
}
function render(s){
  el('targetHint').textContent = `${s.target} | bootstrapped: ${s.bootstrapped}`;
  const m = s.manifest || {};
  el('project').textContent = m.project || '—';
  el('manifestStatus').innerHTML = m.exists ? (m.manifest_locked ? '<span class="good">LOCKED</span>' : '<span class="warn">UNLOCKED</span>') : '<span class="bad">MISSING</span>';
  el('requiredCount').textContent = m.required_behavior_count ?? '—';
  el('currentStage').textContent = (s.state && s.state.project_stage) || '—';
  el('pipeline').innerHTML = (s.stages||[]).map(st => `<span class="stage ${clsStatus(st.status)}">${st.stage}: ${st.status}</span>`).join('');
  const ship = s.release?.ship_status || 'UNKNOWN';
  el('ship').textContent = ship;
  el('ship').className = 'ship ' + (ship==='SHIP' ? 'good' : ship==='DO NOT SHIP' ? 'bad' : 'muted');
  el('releaseDetails').textContent = `release-gate: ${s.release?.release_gate_verdict || 'missing'} | audit: ${s.release?.audit_verdict || 'missing'}`;
  renderManifest(m);
  renderGuided(s.blockers||[]);
  renderReports(s.reports||[]);
  renderProtected(s.protected||{});
  renderProsecution(s.prosecution||{});
  renderProofBehaviors(m);
  renderBehaviorEditor(m);
  updateSuccess(s);
  updateAutofixGate();
}
function renderProofBehaviors(m){
  const sel = el('proofBehavior');
  const behaviors = (m.manifest && m.manifest.behaviors) || [];
  const locked = !!m.manifest_locked;
  if(!behaviors.length){
    sel.innerHTML = '<option value="" disabled selected>No behaviors declared</option>';
  } else {
    sel.innerHTML = behaviors.map(b => `<option value="${safeText(b.id)}">${safeText(b.id)} — ${safeText(b.title)}</option>`).join('');
  }
  const btn = el('proveBtn');
  btn.disabled = !locked || !behaviors.length;
  const adapterBtn = el('runAdapterBtn');
  if(adapterBtn){ adapterBtn.disabled = !locked || !behaviors.length; }
  el('proveHint').textContent = locked ? '' : 'Lock the manifest before recording proof.';
}
function updateSuccess(s){
  const ship = s.release?.ship_status;
  const banner = el('successBanner');
  if(ship === 'SHIP'){
    banner.style.display = 'block';
    const m = s.manifest || {};
    el('successDetails').textContent = `${m.project||''}: ${m.required_behavior_count||0} required behaviors proven at the locked contract. release-gate PASS.`;
  } else {
    banner.style.display = 'none';
  }
}
// ---- Handoff (Phase 5) ----
async function writeHandoff(){
  if(!target()){ setOutput('Load a target first.'); return; }
  try {
    const data = await api('/api/write-handoff', {target: target()});
    setOutput('Wrote '+data.path+' (ship_status: '+data.ship_status+').');
    await refresh();
  } catch(e){ setOutput('HANDOFF ERROR: '+e.message); }
}
// ---- Behavior checklist (friendly manifest curation) ----
function renderBehaviorEditor(m){
  const box = el('behaviorList'); if(!box){ return; }
  const behaviors = (m && m.manifest && m.manifest.behaviors) || [];
  if(!behaviors.length){ box.innerHTML = '<div class="tiny muted">No behaviors yet — click Reconcile to propose some from the app\'s intent + code.</div>'; return; }
  let rows = '<table><tr><th>Req</th><th>ID</th><th>Title</th><th>Severity</th></tr>';
  rows += behaviors.map((b,i) => {
    const sev = b.severity || 'MAJOR';
    return `<tr>
      <td><input type="checkbox" class="bhv-req" data-i="${i}" ${b.required?'checked':''} style="width:auto;"></td>
      <td>${safeText(b.id)}</td>
      <td>${safeText(b.title)}</td>
      <td><select class="bhv-sev" data-i="${i}" style="width:auto;">
        <option ${sev==='MINOR'?'selected':''}>MINOR</option>
        <option ${sev==='MAJOR'?'selected':''}>MAJOR</option>
        <option ${sev==='CRITICAL'?'selected':''}>CRITICAL</option>
      </select></td></tr>`;
  }).join('');
  box.innerHTML = rows + '</table>';
}
function markAllRequired(){ Array.from(document.querySelectorAll('.bhv-req')).forEach(c => { c.checked = true; }); }
async function saveBehaviors(){
  const cur = lastState && lastState.manifest && lastState.manifest.manifest;
  if(!cur){ setOutput('No manifest yet — Load a target / Reconcile first.'); return; }
  const manifest = JSON.parse(JSON.stringify(cur));
  manifest.behaviors = manifest.behaviors || [];
  Array.from(document.querySelectorAll('.bhv-req')).forEach(c => { const i=+c.dataset.i; if(manifest.behaviors[i]){ manifest.behaviors[i].required = c.checked; } });
  Array.from(document.querySelectorAll('.bhv-sev')).forEach(s => { const i=+s.dataset.i; if(manifest.behaviors[i]){ manifest.behaviors[i].severity = s.value; } });
  manifest.operator_approved = true;
  try {
    const data = await api('/api/save-manifest', {target: target(), manifest});
    setOutput(`Saved: ${data.behavior_count} behavior(s), ${data.required_count} required, approved=${data.operator_approved}.\nPress Next Step — it will run manifest-lint, then Lock.`);
    await refresh();
  } catch(e){ setOutput('SAVE BEHAVIORS ERROR: '+e.message); }
}
// ---- Reconcile + manifest editor (Phase 2) ----
async function runReconcile(){
  if(!target()){ setOutput('Load a target app first.'); return; }
  setOutput('Reconciling intent + code …');
  try {
    const data = await api('/api/reconcile', {target: target()});
    el('manifestEditor').value = JSON.stringify(data.draft, null, 2);
    el('manifestEditHint').textContent = `${data.behavior_count} proposed behavior(s) — all origin=intent, required=false. Mark the real ones required, then Approve & Save.`;
    setOutput(`Reconcile: ${data.intent_count} intent statement(s), code dirs [${(data.code_dirs||[]).join(', ')}] → ${data.behavior_count} proposed behavior(s).\nWrote DRAFT_MANIFEST.json, RECONCILIATION_REPORT.md, PLAN_OF_ACTION.md.\nReview/edit above → tick approved → Approve & Save.`);
  } catch(e){ setOutput('RECONCILE ERROR: '+e.message); }
}
function loadCurrentManifest(){
  const m = lastState && lastState.manifest && lastState.manifest.manifest;
  if(!m){ setOutput('No manifest yet — Load a target first.'); return; }
  el('manifestEditor').value = JSON.stringify(m, null, 2);
  el('operatorApprove').checked = !!m.operator_approved;
}
async function saveManifestEdit(){
  let m;
  try { m = JSON.parse(el('manifestEditor').value); } catch(e){ setOutput('Editor is not valid JSON: '+e.message); return; }
  m.operator_approved = el('operatorApprove').checked;
  try {
    const data = await api('/api/save-manifest', {target: target(), manifest: m});
    setOutput(`Saved: ${data.behavior_count} behavior(s) (${data.required_count} required), approved=${data.operator_approved}.\nNow press Next Step — it will run manifest-lint, then Lock.`);
    await refresh();
  } catch(e){ setOutput('SAVE ERROR: '+e.message); }
}
function renderManifest(m){
  if(!m.exists){ el('manifestBox').innerHTML = '<span class="bad">No MANIFEST.json. Bootstrap or create manifest.</span>'; return; }
  let warn = (m.warnings||[]).map(w=>`<li class="warn">${w}</li>`).join('');
  el('manifestBox').innerHTML = `<div><b>${safeText(m.project)}</b></div><div class="tiny">${safeText(m.purpose)}</div><br>
  <table><tr><th>Mode</th><td>${safeText(m.mode)}</td></tr><tr><th>Approved</th><td>${m.operator_approved}</td></tr><tr><th>Locked</th><td>${m.manifest_locked}</td></tr><tr><th>Hash</th><td>${safeText(m.manifest_hash).slice(0,16)}...</td></tr><tr><th>Behaviors</th><td>${m.behavior_count} (${m.required_behavior_count} required)</td></tr><tr><th>Severity</th><td>${JSON.stringify(m.severity_counts)}</td></tr></table>
  ${warn ? '<h3 class="warn">Warnings</h3><ul>'+warn+'</ul>' : '<div class="good">No manifest quality warnings detected.</div>'}`;
}
function renderGuided(blockers){
  const box = el('guided');
  if(!blockers.length){ box.innerHTML = '<div class="good">No blocking items in current reports. Run the full check to confirm.</div>'; return; }
  box.innerHTML = blockers.map((b,i) => `<div class="blocker"><b>${i+1}. [${safeText(b.source)}] ${safeText(b.id)}</b><br>${safeText(b.message)}<br><button class="secondary" style="margin-top:6px;" onclick="copyFix(${i})">Copy fix prompt</button></div>`).join('');
}
function copyFix(i){
  const b = (lastState && lastState.blockers || [])[i];
  if(!b){ return; }
  const text = `App: ${lastState.target}\n\nFix ONLY app code. Do NOT modify MANIFEST.json, forge/policy/, or protected truth/audit/release engine code. Do not fake proof.\n\nIssue ${i+1} [${b.source}] ${b.id||''}:\n${b.message}\n\nAfter fixing, we will re-run the Forge gates to verify.`;
  navigator.clipboard.writeText(text).then(()=>setOutput('Copied fix prompt for issue '+(i+1)+'.\n\n'+text));
}
// ---- Project picker (Phase 1) ----
let allProjects = [];
async function loadProjects(){
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    allProjects = data.projects || [];
    renderProjects();
  } catch(e){ /* non-fatal */ }
}
function renderProjects(){
  const q = (el('projSearch').value||'').toLowerCase();
  const list = allProjects.filter(p => p.name.toLowerCase().includes(q));
  const box = el('projList');
  box.innerHTML = list.map(p => `<button class="projbtn" data-path="${encodeURIComponent(p.path)}">${p.name}<span class="tiny ${p.bootstrapped?'good':(p.has_forge?'warn':'muted')}">${p.bootstrapped?'forge ✓':(p.has_forge?'forge/':'—')}</span></button>`).join('') || '<div class="tiny muted">No matching folders.</div>';
  Array.from(box.querySelectorAll('.projbtn')).forEach(btn => btn.addEventListener('click', ()=>{ el('target').value = decodeURIComponent(btn.dataset.path); refresh(); }));
}
// ---- Next-step driver (Phase 2) ----
let currentNext = null;
async function loadNext(){
  try {
    const q = encodeURIComponent(target());
    const res = await fetch(`/api/next?target=${q}`);
    const n = await res.json();
    if(n.error){ return; }
    renderNext(n);
  } catch(e){ /* non-fatal */ }
}
function renderNext(n){
  currentNext = n;
  el('nextLabel').textContent = n.label || '—';
  el('nextWhy').textContent = n.why || '';
  el('nextRef').textContent = n.ref ? ('See '+n.ref) : '';
  const btn = el('nextBtn');
  const labels = {bootstrap:'Bootstrap Forge', command:(n.label||('Run '+n.command)), sequence:'▶ Run Full Check', fix:'Jump to blockers ↓', manual:'Author manifest ↓', done:'Done ✓', select:'Pick a folder'};
  btn.textContent = labels[n.kind] || 'Next';
  btn.disabled = (n.kind==='done' || n.kind==='select');
}
async function doNext(){
  const n = currentNext; if(!n){ return; }
  if(n.kind==='bootstrap'){ await bootstrap(); await refresh(); return; }
  if(n.kind==='command'){
    if(n.confirm && !confirm(n.label+' — this is a controlled, hard-to-undo step. Continue?')){ return; }
    await runCmd(n.command); await refresh(); return;
  }
  if(n.kind==='sequence'){ await runSequence(); return; }
  if(n.kind==='fix'){ el('guidedCard').scrollIntoView({behavior:'smooth'}); return; }
  if(n.kind==='manual'){
    const c = el('manifestCard'); if(c){ c.scrollIntoView({behavior:'smooth'}); }
    const bc = lastState && lastState.manifest && lastState.manifest.behavior_count;
    if(!bc){ await runReconcile(); }   // no behaviors yet → auto-draft proposals
    return;
  }
}
// ---- Narrated run (Phase 3) ----
function appendLog(t){ const p = el('liveLog'); p.textContent += t; p.scrollTop = p.scrollHeight; }
function startLog(title){ el('liveLog').textContent = '=== '+title+' ===\n\n'; }
// ---- Progress stepper (Phase 3) — separate visual row, driven by the same stream ----
function resetStepper(cmds){
  const list = (cmds && cmds.length) ? cmds : GATE_SEQUENCE_CLIENT;
  const box = el('progressStepper');
  if(!box){ return; }
  box.innerHTML = list.map(c => `<span class="stage" data-cmd="${c}">${c}</span>`).join('');
}
function stepperMark(command, status){
  const box = el('progressStepper');
  if(!box){ return; }
  const chip = Array.from(box.children).find(c => c.dataset.cmd === command);
  if(!chip){ return; }
  if(status === 'running'){ chip.className = 'stage'; chip.style.opacity = '0.55'; }
  else { chip.style.opacity = '1'; chip.className = 'stage ' + status; }
}
function narrate(ev){
  if(ev.type==='start'){ appendLog(`Running ${ev.commands.length} gates on ${ev.target}\n\n`); resetStepper(ev.commands); }
  else if(ev.type==='step-start'){ appendLog(`▶ ${ev.command} ...`); stepperMark(ev.command, 'running'); }
  else if(ev.type==='step-done'){ const v = ev.verdict ? (' '+ev.verdict) : (ev.ok ? ' OK' : (' exit '+ev.exit_code)); appendLog(`${ev.ok?' ✔':' ✘'}${v} (${ev.elapsed}s)\n`); stepperMark(ev.command, (ev.ok && ev.verdict!=='FAIL') ? 'PASS' : 'FAIL'); }
  else if(ev.type==='step-error'){ appendLog(` ✘ ${ev.message}\n`); stepperMark(ev.command, 'FAIL'); }
  else if(ev.type==='log-written'){ appendLog(`Testing log: ${ev.path}\n`); }
  else if(ev.type==='final'){ appendLog(`\n${ev.ship_status==='SHIP'?'✓ SHIP':'DO NOT SHIP'} — ${ev.blocker_count} blocker(s) remaining.\n`); }
  else if(ev.type==='handoff-written'){ appendLog('Handoff written: '+ev.path+'\n'); }
  else if(ev.type==='error'){ appendLog(`\nERROR: ${ev.message}\n`); }
}
async function runSequence(){
  if(!target()){ setOutput('Pick a target app first.'); return; }
  startLog('RUN FULL CHECK');
  try {
    const q = encodeURIComponent(target());
    const res = await fetch(`/api/run-sequence?target=${q}`);
    if(!res.body){ appendLog('Streaming not supported by this browser.\n'); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for(;;){
      const {done, value} = await reader.read();
      if(done){ break; }
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for(const line of lines){ if(!line.trim()){ continue; } let ev; try { ev = JSON.parse(line); } catch(e){ continue; } narrate(ev); }
    }
  } catch(e){ appendLog('\nSTREAM ERROR: '+e.message+'\n'); }
  await refresh();
}
// ---- Node/Vite run adapter (Item B) ----
function narrateAdapter(ev){
  if(ev.type==='start'){ appendLog(`Running Node/Vite adapter on ${ev.target} for behavior ${ev.behavior}\n\n`); }
  else if(ev.type==='step-start'){ appendLog(`▶ ${ev.step}: ${ev.message||''}\n`); }
  else if(ev.type==='step-done'){ appendLog(`  ${ev.status || (ev.ok ? 'OK' : 'DONE')}${ev.message?(' — '+ev.message):''}\n`); }
  else if(ev.type==='step-error'){ appendLog(`  ✘ ${ev.step||''} ERROR: ${ev.message}\n`); }
  else if(ev.type==='artifact'){ appendLog(`  artifact: ${ev.path}\n`); }
  else if(ev.type==='final'){ appendLog(`\nAdapter result: ${ev.status} (artifact: ${ev.artifact||'none'})\n`); }
  else if(ev.type==='error'){ appendLog(`\nERROR: ${ev.message}\n`); }
}
async function runAdapter(){
  if(!target()){ setOutput('Pick a target app first.'); return; }
  const behavior = el('proofBehavior').value;
  if(!behavior){ setOutput('Pick a Behavior in the Record Runtime Proof card first — the adapter needs to know which behavior this run proves.'); return; }
  startLog('NODE ADAPTER — RUN & PROVE');
  try {
    const q = encodeURIComponent(target());
    const b = encodeURIComponent(behavior);
    const res = await fetch(`/api/run-adapter?target=${q}&behavior=${b}`);
    if(!res.body){ appendLog('Streaming not supported by this browser.\n'); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for(;;){
      const {done, value} = await reader.read();
      if(done){ break; }
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for(const line of lines){ if(!line.trim()){ continue; } let ev; try { ev = JSON.parse(line); } catch(e){ continue; } narrateAdapter(ev); }
    }
  } catch(e){ appendLog('\nSTREAM ERROR: '+e.message+'\n'); }
  await refresh();
}
async function refresh(){ await loadState(); await loadNext(); await loadModels(); }
// ---- AI model selector (local or cloud; Phase 4) ----
async function loadModels(){
  const sel = el('modelSelect'); if(!sel){ return; }
  try {
    const res = await fetch(`/api/models?target=${encodeURIComponent(target())}`);
    const d = await res.json();
    if(!d.present){ sel.innerHTML = '<option value="">— none yet —</option>'; el('modelHint').textContent = 'No model configured — pick one below and click Enable.'; return; }
    if(!(d.models||[]).length){ sel.innerHTML = '<option value="">— none yet —</option>'; el('modelHint').textContent = 'Pick a model below and click Enable.'; return; }
    sel.innerHTML = d.models.map(m => `<option value="${safeText(m.name)}" ${m.name===d.selected?'selected':''}>${safeText(m.name)} (${safeText(m.kind)}${m.runnable?'':' — not runnable'})</option>`).join('');
    el('modelHint').textContent = d.enabled ? 'cli models edit code (auto-fix); api models draft text.' : 'Config present but "enabled" is false — onboard auto-fix stays off.';
  } catch(e){ /* non-fatal */ }
}
async function selectModel(){
  const name = el('modelSelect').value; if(!name){ return; }
  try { await api('/api/select-model', {target: target(), name}); setOutput('Selected AI model: '+name); }
  catch(e){ setOutput('MODEL SELECT ERROR: '+e.message); }
}
let PRESETS = [];
async function loadPresets(){
  const sel = el('presetSelect'); if(!sel){ return; }
  try {
    const res = await fetch('/api/model-presets');
    const d = await res.json();
    PRESETS = d.presets || [];
    sel.innerHTML = PRESETS.map(p => `<option value="${safeText(p.id)}">${safeText(p.label)}</option>`).join('');
    onPresetChange();
  } catch(e){ /* non-fatal */ }
}
function onPresetChange(){
  const p = PRESETS.find(x => x.id === el('presetSelect').value);
  const mi = el('presetModel');
  if(p && p.needs_model){ mi.style.display = 'block'; if(!mi.value){ mi.value = p.model_default || ''; } }
  else { mi.style.display = 'none'; }
  el('presetHint').textContent = p ? (p.notes || '') : '';
}
async function enableModelPreset(){
  if(!target()){ setOutput('Load a target app first.'); return; }
  const preset_id = el('presetSelect').value;
  const model = el('presetModel').value;
  try {
    const d = await api('/api/enable-model', {target: target(), preset_id, model});
    setOutput('Enabled AI model: '+d.selected+'  (written to forge/state/AUTOFIX_CONFIG.json)');
    await loadModels();
  } catch(e){ setOutput('ENABLE MODEL ERROR: '+e.message); }
}
// ---- External-AI fix prompt (fix choice tree; Phase 4) ----
async function genFixPrompt(){
  if(!target()){ setOutput('Load a target first.'); return; }
  try {
    const res = await fetch(`/api/fix-prompt?target=${encodeURIComponent(target())}`);
    const d = await res.json();
    if(d.error){ setOutput('FIX PROMPT ERROR: '+d.error); return; }
    setOutput('Wrote '+d.path+' ('+d.blocker_count+' blocker(s)). Give this to your external AI platform:\n\n'+d.prompt);
  } catch(e){ setOutput('FIX PROMPT ERROR: '+e.message); }
}
// ---- File explorer + Load Target (Phase 1) ----
let browserOpen = false;
function toggleBrowser(){
  browserOpen = !browserOpen;
  el('browser').style.display = browserOpen ? 'block' : 'none';
  if(browserOpen){ browseTo(target() || ''); }
}
async function browseTo(path){
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path||'')}`);
    const data = await res.json();
    renderBrowser(data);
  } catch(e){ el('browser').innerHTML = '<div class="tiny bad">Browse error: '+e.message+'</div>'; }
}
function renderBrowser(d){
  const box = el('browser');
  let html = `<div class="path">${safeText(d.path)}</div><div style="margin-bottom:6px;">`;
  if(d.parent){ html += `<button class="secondary" data-nav="${encodeURIComponent(d.parent)}">⬆ Up</button>`; }
  (d.drives||[]).forEach(dr => { html += `<button class="secondary" data-nav="${encodeURIComponent(dr)}">${safeText(dr)}</button>`; });
  html += `<button onclick="selectFolder()">✓ Select this folder</button></div>`;
  if(d.error){ html += `<div class="tiny bad">${safeText(d.error)}</div>`; }
  html += (d.dirs||[]).map(x => `<div class="row" data-nav="${encodeURIComponent(x.path)}">📁 ${safeText(x.name)}</div>`).join('') || '<div class="tiny muted">No sub-folders.</div>';
  box.innerHTML = html;
  box.__current = d.path;
  Array.from(box.querySelectorAll('[data-nav]')).forEach(elm => elm.addEventListener('click', ()=> browseTo(decodeURIComponent(elm.dataset.nav))));
}
function selectFolder(){
  const box = el('browser');
  if(box.__current){ el('target').value = box.__current; browserOpen = false; box.style.display = 'none'; }
}
async function loadTarget(){
  if(!target()){ setOutput('Enter or browse to a target folder first.'); return; }
  setOutput('Loading target and homing forge/ …');
  try {
    const data = await api('/api/load-target', {target: target()});
    const boot = data.bootstrap || {};
    setOutput('Loaded: '+target()+'\nforge/ homed'+(boot.created_manifest_template ? ' + draft manifest template created.' : '.'));
    await refresh();
  } catch(e){ setOutput('LOAD ERROR: '+e.message); }
}
// ---- Auto-Fix loop (Item C, experimental, OFF by default) ----
function toggleAutofix(){ updateAutofixGate(); }
function updateAutofixGate(){
  const locked = !!(lastState && lastState.manifest && lastState.manifest.manifest_locked);
  const enabled = !!(el('autofixEnable') && el('autofixEnable').checked);
  const btn = el('autofixBtn');
  if(btn){ btn.disabled = !(locked && enabled); }
  const hint = el('autofixHint');
  if(hint){ hint.textContent = !locked ? 'Lock the manifest first — use Next Step (author → lint → Lock).' : (enabled ? '' : 'Tick “Enable auto-edit” to run.'); }
}
function narrateAutofix(ev){
  const t = ev.type;
  if(t==='start'){ appendLog(`Auto-Fix loop — max ${ev.max_iterations} iteration(s). Agent configured: ${ev.agent_configured}\n`); }
  else if(t==='iteration'){ appendLog(`\n=== Iteration ${ev.n} ===\n`); }
  else if(t==='gate'){ appendLog(`  ${ev.command}: ${ev.verdict || (ev.ok?'ok':'fail')}\n`); }
  else if(t==='status'){ appendLog(`  → ${ev.ship} | ${ev.blocker_count} blocker(s)\n`); }
  else if(t==='checkpoint'){ appendLog(`  checkpoint (${ev.kind}) ${ev.ref||''}\n`); }
  else if(t==='agent-start'){ appendLog(`  agent fixing: ${ev.blocker}\n`); }
  else if(t==='agent-done'){ appendLog(`  agent done (ok=${ev.ok}, exit=${ev.code})\n`); }
  else if(t==='contract-drift'){ appendLog(`  ✘ CONTRACT DRIFT: ${(ev.changed||[]).join(', ')}\n`); }
  else if(t==='rollback'){ appendLog(`  rolled back (ok=${ev.ok}) ${ev.detail||''}\n`); }
  else if(t==='success'){ appendLog(`\n✓ ${ev.message}\n`); }
  else if(t==='step-error'){ appendLog(`  step error [${ev.command||''}]: ${ev.message||''}\n`); }
  else if(t==='stuck' || t==='halt' || t==='done' || t==='final'){ appendLog(`\n${ev.message}\n`); }
  else if(t==='error'){ appendLog(`\nERROR: ${ev.message}\n`); }
}
async function runAutofix(){
  if(!el('autofixEnable').checked){ return; }
  if(!target()){ setOutput('Pick a target app first.'); return; }
  if(!confirm('Auto-Fix will let your configured agent EDIT this app\'s code in a loop (git checkpoint each pass, protected-file hard-stop + rollback on contract drift). Continue?')){ return; }
  startLog('AUTO-FIX LOOP');
  try {
    const q = encodeURIComponent(target());
    const mx = encodeURIComponent(el('autofixMax').value || '3');
    const res = await fetch(`/api/auto-fix?target=${q}&max=${mx}`);
    if(!res.body){ appendLog('Streaming not supported by this browser.\n'); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for(;;){
      const {done, value} = await reader.read();
      if(done){ break; }
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for(const line of lines){ if(!line.trim()){ continue; } let ev; try { ev = JSON.parse(line); } catch(e){ continue; } narrateAutofix(ev); }
    }
  } catch(e){ appendLog('\nAUTOFIX ERROR: '+e.message+'\n'); }
  await refresh();
}
function renderReports(reports){
  el('reports').innerHTML = `<table><tr><th>Report</th><th>Status</th><th>Verdict</th><th>Generated</th><th>Hash</th></tr>` + reports.map(r=>{
    let status = !r.exists ? 'MISSING' : r.stale ? 'STALE' : r.json_error ? 'JSON ERROR' : 'OK';
    let klass = status==='OK' ? 'good' : status==='STALE' ? 'warn' : 'bad';
    return `<tr><td>${r.name}</td><td class="${klass}">${status}</td><td>${safeText(r.verdict)}</td><td>${safeText(r.generated_utc)}</td><td>${safeText(r.manifest_hash).slice(0,12)}</td></tr>`;
  }).join('') + `</table>`;
}
function renderProtected(p){
  if(!p.protected_count){ el('protectedBox').innerHTML = 'No protected files detected yet.'; return; }
  let changed = p.changed_after_lock || [];
  el('protectedBox').innerHTML = `<div>Protected files: ${p.protected_count}</div><div>Baseline exists: ${p.baseline_exists}</div>` +
    (p.warning ? `<div class="bad"><b>CONTRACT DRIFT DETECTED</b></div>${changed.map(c=>`<div class="tiny bad">${c.path}</div>`).join('')}` : `<div class="good">No protected-file drift detected.</div>`);
}
function renderProsecution(p){
  el('prosecutionBox').innerHTML = `A: ${p.a_exists} | B: ${p.b_exists} | comparison: ${p.comparison_verdict || 'missing'} | disagreements: ${p.disagreement_count || 0} | arbitration: ${p.arbitration_exists}`;
}
function copyBlockers(){
  if(!lastState){ return; }
  const blockers = lastState.blockers || [];
  const text = `Target: ${lastState.target}\nShip status: ${lastState.release?.ship_status}\n\nFix app code only. Do not weaken MANIFEST.json, forge/policy/, protected release/truth/audit code, or proof ledgers.\n\nBlocking items:\n` + blockers.map((b,i)=>`${i+1}. [${b.source}] ${b.id||''} ${b.message}`).join('\n');
  navigator.clipboard.writeText(text).then(()=>setOutput('Copied blockers for Claude/Cursor.\n\n'+text));
}
async function initPanel(){
  const res = await fetch('/api/core');
  const data = await res.json();
  window.__CORE_ROOT__ = data.core_root;
  initButtons();
  await loadProjects();
  await loadPresets();
  await refresh();
}
initPanel();
</script>
</body>
</html>
'''


class Handler(BaseHTTPRequestHandler):
    server_version = "ForgetasticControlPanel/1.0"

    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            if parsed.path in {"/", "/index.html"}:
                body = INDEX_HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path == "/favicon.ico":
                # Browsers auto-request this; answer 204 so the console stays clean.
                self.send_response(204)
                self.end_headers()
                return
            if parsed.path == "/api/core":
                self._send_json({"core_root": str(core_root()), "version": APP_VERSION})
                return
            if parsed.path == "/api/state":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                self._send_json(read_state(target))
                return
            if parsed.path == "/api/projects":
                self._send_json(list_projects())
                return
            if parsed.path == "/api/browse":
                qs = parse_qs(parsed.query)
                self._send_json(list_dir((qs.get("path") or [None])[0]))
                return
            if parsed.path == "/api/models":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                self._send_json(list_models(target))
                return
            if parsed.path == "/api/model-presets":
                self._send_json(list_model_presets())
                return
            if parsed.path == "/api/fix-prompt":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                self._send_json(build_external_fix_prompt(target))
                return
            if parsed.path == "/api/next":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                self._send_json(next_step(target))
                return
            if parsed.path == "/api/run-sequence":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                self._run_sequence_stream(target)
                return
            if parsed.path == "/api/run-adapter":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                behavior = (qs.get("behavior") or [""])[0]
                self._run_adapter_stream(target, behavior)
                return
            if parsed.path == "/api/auto-fix":
                qs = parse_qs(parsed.query)
                target = resolve_target((qs.get("target") or [None])[0])
                try:
                    max_iter = int((qs.get("max") or ["3"])[0])
                except ValueError:
                    max_iter = 3
                self._auto_fix_stream(target, max_iter)
                return
            self._send_json({"error": "Not found"}, 404)
        except Exception as exc:
            self._send_json({"error": str(exc)}, 500)

    def _run_sequence_stream(self, target: Path) -> None:
        """Stream the non-destructive gate chain as newline-delimited JSON events."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(obj: dict[str, Any]) -> None:
            try:
                self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
            except OSError:
                pass

        try:
            if not target_has_cli(target):
                emit({"type": "error", "message": "Not bootstrapped. Run Bootstrap first."})
                return
            emit({"type": "start", "commands": GATE_SEQUENCE, "target": str(target)})
            testing_log_rows: list[dict[str, Any]] = []
            for command in GATE_SEQUENCE:
                emit({"type": "step-start", "command": command})
                try:
                    res = run_cli(target, command)
                except Exception as exc:  # noqa: BLE001
                    emit({"type": "step-error", "command": command, "message": str(exc)})
                    testing_log_rows.append({"command": command, "ok": False, "verdict": None, "elapsed": None})
                    continue
                verdict = command_verdict(target, command)
                emit({
                    "type": "step-done",
                    "command": command,
                    "exit_code": res.get("exit_code"),
                    "ok": res.get("ok"),
                    "elapsed": res.get("elapsed_seconds"),
                    "verdict": verdict,
                })
                testing_log_rows.append({
                    "command": command,
                    "ok": res.get("ok"),
                    "verdict": verdict,
                    "elapsed": res.get("elapsed_seconds"),
                })
            final = read_state(target)
            ship_status = (final.get("release") or {}).get("ship_status")
            blocker_count = len(final.get("blockers") or [])
            log_path = write_testing_log(target, testing_log_rows, ship_status, blocker_count)
            emit({"type": "log-written", "path": log_path})
            emit({
                "type": "final",
                "ship_status": ship_status,
                "blocker_count": blocker_count,
            })
            if ship_status == "SHIP":
                try:
                    handoff_res = write_handoff(target)
                    emit({"type": "handoff-written", "path": handoff_res.get("path")})
                except Exception as exc:  # noqa: BLE001 - never let handoff writing break the stream
                    pass
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "message": str(exc)})

    def _run_adapter_stream(self, target: Path, behavior: str) -> None:
        """Item B: Node/Vite run adapter. For a target with package.json:
        installs (only if node_modules is missing), starts the app via its
        OWN declared start method (start.bat / npm run dev / npm start) on
        an open port, polls its main route, captures output as an evidence
        artifact, and records the outcome via record_proof. Streams progress
        as ndjson, mirroring _run_sequence_stream. Never runs an arbitrary
        command and always terminates the child process."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(obj: dict[str, Any]) -> None:
            try:
                self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
            except OSError:
                pass

        log_parts: list[str] = []

        def log(text: str) -> None:
            log_parts.append(text)

        proc: subprocess.Popen | None = None
        log_file_handle = None
        log_file_path: Path | None = None

        try:
            behavior = (behavior or "").strip()
            if not behavior:
                emit({"type": "error", "message": "No behavior selected. Pick the manifest behavior "
                                                    "this run proves (Record Runtime Proof card) before "
                                                    "starting the adapter."})
                return

            manifest = manifest_summary(target)
            if not manifest.get("manifest_locked"):
                emit({"type": "error", "message": "Manifest is not locked. Lock the manifest before recording adapter proof."})
                return
            valid_ids = {str(b.get("id")) for b in (manifest.get("manifest") or {}).get("behaviors", [])
                         if isinstance(b, dict) and b.get("id")}
            if behavior not in valid_ids:
                emit({"type": "error", "message": f"Behavior '{behavior}' is not declared in the locked manifest."})
                return

            if not (target / "package.json").exists():
                emit({"type": "error", "message": "No package.json — adapter is for Node/JS apps."})
                return

            emit({"type": "start", "target": str(target), "behavior": behavior})

            status: str | None = None
            actual_summary = ""
            start_desc: str | None = None
            start_cmd_display: str | None = None

            npm = npm_executable()
            if not npm:
                emit({"type": "step-done", "step": "install", "status": "ENVIRONMENTAL",
                      "message": "npm not found on PATH."})
                status = "ENVIRONMENTAL"
                actual_summary = "npm executable not found on PATH; cannot install or start the app."
                log("npm not found on PATH.\n")
            else:
                node_modules = target / "node_modules"
                if node_modules.exists():
                    log("node_modules present; skipping npm install.\n")
                    emit({"type": "step-done", "step": "install", "status": "SKIPPED",
                          "message": "node_modules present."})
                else:
                    emit({"type": "step-start", "step": "install", "message": "npm install (node_modules missing)"})
                    install_res = run_npm_install(target, timeout=300)
                    log(f"$ npm install (cwd={target})\n"
                        f"exit_code={install_res['exit_code']} elapsed={install_res['elapsed_seconds']}s\n")
                    log("---- npm install STDOUT ----\n" + (install_res.get("stdout") or "") + "\n")
                    log("---- npm install STDERR ----\n" + (install_res.get("stderr") or "") + "\n")
                    if not install_res["ok"]:
                        emit({"type": "step-done", "step": "install", "status": "ENVIRONMENTAL", "ok": False,
                              "exit_code": install_res["exit_code"]})
                        status = "ENVIRONMENTAL"
                        actual_summary = f"npm install failed (exit {install_res['exit_code']})."
                    else:
                        emit({"type": "step-done", "step": "install", "status": "PASS", "ok": True,
                              "elapsed": install_res["elapsed_seconds"]})

                if status is None:
                    start_info = detect_start_command(target)
                    if not start_info:
                        emit({"type": "step-done", "step": "start", "status": "ENVIRONMENTAL",
                              "message": "No start.bat, and no 'dev' or 'start' script in package.json."})
                        status = "ENVIRONMENTAL"
                        actual_summary = "No declared start method found (start.bat / dev script / start script)."
                    else:
                        start_desc = start_info["label"]
                        start_cmd_display = start_info["display"]
                        port = find_open_port("127.0.0.1")
                        env = os.environ.copy()
                        env["PORT"] = str(port)
                        emit({"type": "step-start", "step": "start",
                              "message": f"Starting via {start_desc} on port {port}"})
                        log(f"$ {start_cmd_display} (PORT={port}, cwd={target})\n")

                        try:
                            fd, tmp_name = tempfile.mkstemp(suffix=".log", prefix="forge_adapter_")
                            os.close(fd)
                            log_file_path = Path(tmp_name)
                            log_file_handle = open(log_file_path, "w", encoding="utf-8", errors="replace")
                            proc = subprocess.Popen(
                                start_info["cmd"],
                                cwd=str(target),
                                env=env,
                                stdout=log_file_handle,
                                stderr=subprocess.STDOUT,
                                text=True,
                            )
                        except OSError as exc:
                            emit({"type": "step-done", "step": "start", "status": "ENVIRONMENTAL",
                                  "message": f"Failed to launch: {exc}"})
                            status = "ENVIRONMENTAL"
                            actual_summary = f"Failed to launch start command ({start_cmd_display}): {exc}"
                            proc = None

                        if proc is not None:
                            emit({"type": "step-done", "step": "start", "status": "PASS", "pid": proc.pid,
                                  "port": port})
                            url = f"http://127.0.0.1:{port}/"
                            emit({"type": "step-start", "step": "route-check", "message": f"Polling {url}"})
                            route_res = check_route(url, total_timeout=30.0)

                            # Stop the app now that we're done needing it running — capture its
                            # output before writing the evidence artifact.
                            _terminate_process(proc)
                            proc = None
                            try:
                                log_file_handle.flush()
                                log_file_handle.close()
                            except Exception:
                                pass
                            log_file_handle = None
                            try:
                                app_output = log_file_path.read_text(encoding="utf-8", errors="replace")
                            except Exception:
                                app_output = "(could not read app output)\n"
                            log(f"---- {start_desc} stdout/stderr ----\n{app_output}\n")

                            if route_res["reachable"]:
                                status = "PASS"
                                actual_summary = (
                                    f"App started via {start_desc} on port {port}; {url} responded "
                                    f"HTTP {route_res['status_code']} within {route_res['elapsed_seconds']}s."
                                )
                                emit({"type": "step-done", "step": "route-check", "status": "PASS",
                                      "status_code": route_res["status_code"],
                                      "elapsed": route_res["elapsed_seconds"]})
                            else:
                                status = "FAIL"
                                actual_summary = (
                                    f"App started via {start_desc} on port {port}, but {url} did not respond "
                                    f"successfully within {route_res['elapsed_seconds']}s "
                                    f"(last error: {route_res.get('error')})."
                                )
                                emit({"type": "step-done", "step": "route-check", "status": "FAIL",
                                      "error": route_res.get("error"), "elapsed": route_res["elapsed_seconds"]})

            # Always write the captured log as an evidence artifact, whatever happened.
            evidence_dir = target / "forge" / "evidence"
            evidence_dir.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            artifact_path = evidence_dir / f"adapter_{ts}.log"
            artifact_path.write_text("".join(log_parts) or "(no output captured)\n", encoding="utf-8")
            artifact_rel = str(artifact_path.relative_to(target)).replace("\\", "/")
            emit({"type": "artifact", "path": artifact_rel})

            if status is None:
                status = "ENVIRONMENTAL"
                actual_summary = actual_summary or "Adapter did not complete a route check."

            command_used = start_cmd_display or "(none run)"
            emit({"type": "step-start", "step": "record-proof",
                  "message": f"Recording proof for {behavior} as {status}"})
            try:
                proof_res = record_proof(target, {
                    "manifest_id": behavior,
                    "proof_type": "INTEGRATION",
                    "environment": "LOCAL",
                    "runner": "node-adapter",
                    "command": command_used,
                    "input_summary": "Automated Node/Vite run adapter: install (if needed) + start + "
                                      "main-route check.",
                    "expected_summary": "App installs, starts on an open port via its declared start "
                                         "method, and its main route (/) responds with a successful "
                                         "HTTP status.",
                    "actual_summary": actual_summary,
                    "status": status,
                    "artifacts": [artifact_rel] if artifact_rel else [],
                    "confidence": "3",
                })
                emit({"type": "step-done", "step": "record-proof", "ok": proof_res.get("ok"),
                      "exit_code": proof_res.get("exit_code")})
            except Exception as exc:  # noqa: BLE001 - surface, don't crash the stream
                emit({"type": "step-error", "step": "record-proof", "message": str(exc)})

            emit({"type": "final", "status": status, "artifact": artifact_rel})
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "message": str(exc)})
        finally:
            # Safety net: guarantee no orphan server survives this request even
            # if an exception occurred before the explicit stop above.
            if proc is not None:
                _terminate_process(proc)
            if log_file_handle is not None:
                try:
                    log_file_handle.close()
                except Exception:
                    pass
            if log_file_path is not None:
                try:
                    log_file_path.unlink()
                except Exception:
                    pass

    def _auto_fix_stream(self, target: Path, max_iterations: int) -> None:
        """Item C: guardrailed auto-fix loop. Each iteration: re-run the gate
        chain; if SHIP, stop; else (only if an agent is configured) checkpoint,
        let the agent fix ONE blocker, hard-stop+rollback on protected-file
        drift, and repeat until SHIP, no progress, or the iteration cap.
        Streams ndjson like the other live views."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(obj: dict[str, Any]) -> None:
            try:
                self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
            except OSError:
                pass

        try:
            if not target_has_cli(target):
                emit({"type": "error", "message": "Not bootstrapped. Run Bootstrap first."})
                return
            summary = manifest_summary(target)
            if not summary.get("manifest_locked"):
                emit({"type": "error", "message": "Manifest is not locked. Lock the manifest before auto-fix."})
                return

            cap = max(1, min(int(max_iterations or 3), AUTOFIX_MAX_ITER_CAP))
            agent = read_agent_config(target)
            baseline = current_protected_hashes(target)
            emit({"type": "start", "target": str(target), "max_iterations": cap,
                  "agent_configured": agent is not None})

            prev_count: int | None = None
            for i in range(1, cap + 1):
                emit({"type": "iteration", "n": i})

                # 1. Re-run the non-destructive gate chain.
                for command in GATE_SEQUENCE:
                    try:
                        res = run_cli(target, command)
                    except Exception as exc:  # noqa: BLE001
                        emit({"type": "step-error", "command": command, "message": str(exc)})
                        continue
                    emit({"type": "gate", "command": command,
                          "verdict": command_verdict(target, command), "ok": res.get("ok")})

                state = read_state(target)
                ship = (state.get("release") or {}).get("ship_status")
                blockers = state.get("blockers") or []
                count = len(blockers)
                emit({"type": "status", "ship": ship, "blocker_count": count})
                append_jsonl(target / CONTROL_LOG,
                             {"event": "autofix-iter", "n": i, "ship": ship,
                              "blockers": count, "utc": utc_now()})

                if ship == "SHIP":
                    emit({"type": "success", "message": "release-gate PASS — shipped."})
                    return
                if count == 0:
                    emit({"type": "done", "message": "No blockers remain, but not yet SHIP. "
                          "Remaining steps are manual (prosecution / finalize)."})
                    return
                if agent is None:
                    emit({"type": "halt", "message": "Auto-edit is not configured. Create "
                          "forge/state/AUTOFIX_CONFIG.json with {\"enabled\": true, "
                          "\"agent_command\": [...]} to enable code edits. Blockers reported above; "
                          "fix them via the copy-prompt workflow instead."})
                    return
                if prev_count is not None and count >= prev_count:
                    emit({"type": "stuck", "message": f"No progress ({count} blocker(s); was {prev_count}). "
                          "Stopping to avoid an unproductive loop."})
                    return

                # 2. Checkpoint BEFORE any edit. Abort if it fails.
                cp = create_checkpoint(target)
                if not cp.get("ok"):
                    emit({"type": "error", "message": "Checkpoint failed; aborting before any edit: "
                          + str(cp.get("error"))})
                    return
                emit({"type": "checkpoint", "kind": cp.get("kind"), "ref": cp.get("ref")})

                # 3. Agent fixes ONE blocker.
                blocker = blockers[0]
                prompt = build_fix_prompt(target, blocker)
                emit({"type": "agent-start", "blocker": blocker.get("id") or blocker.get("source")})
                ares = run_agent(target, agent["command"], prompt)
                emit({"type": "agent-done", "ok": ares.get("ok"), "code": ares.get("code")})

                # 4. Protected-file drift check → HARD STOP + rollback.
                post = current_protected_hashes(target)
                if post != baseline:
                    changed = sorted(k for k in set(baseline) | set(post) if baseline.get(k) != post.get(k))
                    emit({"type": "contract-drift", "changed": changed,
                          "message": "Protected files changed during the agent pass. HARD STOP + rollback."})
                    rb = rollback_checkpoint(target, cp)
                    emit({"type": "rollback", "ok": rb.get("ok"), "detail": rb.get("detail")})
                    return

                prev_count = count

            emit({"type": "final", "message": f"Reached max iterations ({cap}). Stopping."})
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "message": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_body()
            if self.path == "/api/bootstrap":
                target = resolve_target(body.get("target"))
                self._send_json(bootstrap_target(target))
                return
            if self.path == "/api/load-target":
                # Load = commit target + auto-home forge/ (bootstrap), then return state.
                target = resolve_target(body.get("target"))
                boot = bootstrap_target(target)
                self._send_json({"bootstrap": boot, "state": read_state(target)})
                return
            if self.path == "/api/reconcile":
                target = resolve_target(body.get("target"))
                self._send_json(reconcile(target))
                return
            if self.path == "/api/save-manifest":
                target = resolve_target(body.get("target"))
                manifest = body.get("manifest")
                self._send_json(save_manifest(target, manifest))
                return
            if self.path == "/api/select-model":
                target = resolve_target(body.get("target"))
                self._send_json(select_model(target, str(body.get("name", ""))))
                return
            if self.path == "/api/enable-model":
                target = resolve_target(body.get("target"))
                self._send_json(enable_model(target, str(body.get("preset_id", "")), body.get("model")))
                return
            if self.path == "/api/run":
                target = resolve_target(body.get("target"))
                command = str(body.get("command", ""))
                self._send_json(run_cli(target, command))
                return
            if self.path == "/api/import-review":
                target = resolve_target(body.get("target"))
                kind = str(body.get("kind", "")).upper().strip()
                text = str(body.get("json_text", ""))
                self._send_json(import_review(target, kind, text))
                return
            if self.path == "/api/prove":
                target = resolve_target(body.get("target"))
                self._send_json(record_proof(target, body))
                return
            if self.path == "/api/write-handoff":
                target = resolve_target(body.get("target"))
                self._send_json(write_handoff(target))
                return
            self._send_json({"error": "Not found"}, 404)
        except Exception as exc:
            self._send_json({"error": str(exc)}, 400)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (utc_now(), format % args))


def serve(host: str, port: int, open_browser: bool = True) -> None:
    actual_port = find_open_port(host, port)
    url = f"http://{host}:{actual_port}"
    httpd = ThreadingHTTPServer((host, actual_port), Handler)
    print(f"{APP_NAME} {APP_VERSION}")
    print(f"Core root: {core_root()}")
    print(f"Open: {url}")
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        httpd.server_close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="0 = choose open port")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    serve(args.host, args.port, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
