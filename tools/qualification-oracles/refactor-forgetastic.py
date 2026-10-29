#!/usr/bin/env python3
"""Independent Forgetastic refactor oracle (behaviors F1–F8).

Bound to sealed criteria:
  .jc/certification/SEALED-CRITERIA-realproject-refactor-forgetastic.json
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

EXPECTED_CRITERIA_SHA256 = "9545e6db2766e32ba8e130929eaaf248a4a8f8d88e3d0a3e3091fc1b9f3b3eda"
REPO_ROOT = Path(__file__).resolve().parents[2]
CRITERIA_PATH = REPO_ROOT / ".jc" / "certification" / "SEALED-CRITERIA-realproject-refactor-forgetastic.json"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run(cmd: list[str], cwd: Path, timeout: int = 120, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged = {**os.environ, **(env or {})}
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        env=merged,
        check=False,
    )


def http_json(url: str, timeout: float = 5.0) -> tuple[int, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = body
            return int(resp.status), parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        return int(exc.code), parsed


def ensure_criteria() -> str:
    raw = CRITERIA_PATH.read_bytes()
    digest = sha256_bytes(raw)
    if digest != EXPECTED_CRITERIA_SHA256:
        raise SystemExit(f"sealed criteria hash mismatch: {digest}")
    return digest


def python_bin(target: Path) -> str:
    return sys.executable or "python"


def prepare_workspace(target: Path) -> Path:
    """Use target itself when it already has Forgetastic CLI; otherwise fail closed."""
    cli = target / "tools" / "forgetastic" / "cli.py"
    if not cli.exists():
        raise SystemExit(f"Forgetastic CLI missing under target: {cli}")
    # Ensure importable package root.
    tools_init = target / "tools" / "__init__.py"
    if not tools_init.exists():
        tools_init.write_text("# Namespace package for Forgetastic.\n", encoding="utf-8")
    return target


def cli(target: Path, *args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return run([python_bin(target), "main.py", *args], cwd=target, timeout=timeout)


def ensure_manifest(target: Path) -> None:
    manifest = target / "forge" / "manifest" / "MANIFEST.json"
    if manifest.exists():
        return
    manifest.parent.mkdir(parents=True, exist_ok=True)
    template = {
        "project": target.name,
        "mode": "STANDARD",
        "purpose": "Oracle fixture manifest for independent refactor verification.",
        "operator_approved": False,
        "manifest_locked": False,
        "users": [],
        "behaviors": [{"id": "B1", "severity": "MINOR", "statement": "oracle behavior"}],
        "failures": [],
        "integrations": [],
        "assumptions": [],
        "out_of_scope": [],
    }
    # Prefer shared save_json when available; fall back for pre-refactor trees.
    try:
        sys.path.insert(0, str(target))
        from tools.forgetastic.common import save_json  # type: ignore

        save_json(manifest, template)
    except Exception:
        manifest.write_text(json.dumps(template, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def import_common(target: Path):
    sys.path.insert(0, str(target))
    from tools.forgetastic import common as common  # type: ignore

    return common


def behavior_f1(target: Path) -> dict[str, Any]:
    init = cli(target, "init")
    ensure_manifest(target)
    status = cli(target, "status")
    out = (status.stdout or "") + (status.stderr or "")
    passed = init.returncode == 0 and status.returncode == 0 and "STATUS" in out and "project_stage:" in out
    return {
        "passed": passed,
        "detail": f"init={init.returncode}; status={status.returncode}; hasSTATUS={'STATUS' in out}",
    }


def behavior_f2(target: Path) -> dict[str, Any]:
    ensure_manifest(target)
    # Force a state write via CLI status so Control Panel can read it.
    status = cli(target, "status")
    state_path = target / "forge" / "state" / "STATE.json"
    if not state_path.exists():
        return {"passed": False, "detail": "STATE.json missing after CLI status"}
    before = state_path.read_bytes()
    port = free_port()
    env = {**os.environ, "PYTHONPATH": str(target)}
    proc = subprocess.Popen(
        [python_bin(target), "-m", "tools.forgetastic.control_panel", "--host", "127.0.0.1", "--port", str(port), "--no-browser"],
        cwd=str(target),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.time() + 15
        core_ok = False
        while time.time() < deadline:
            if proc.poll() is not None:
                logs = proc.stdout.read() if proc.stdout else ""
                return {"passed": False, "detail": f"control panel exited {proc.returncode}: {logs[:400]}"}
            try:
                code, body = http_json(f"{base}/api/core")
                if code == 200 and isinstance(body, dict) and body.get("core_root"):
                    core_ok = True
                    break
            except Exception:
                time.sleep(0.15)
        if not core_ok:
            return {"passed": False, "detail": "control panel failed to answer /api/core"}
        q = urllib.parse.quote(str(target.resolve()))
        code, panel_state = http_json(f"{base}/api/state?target={q}")
        after = state_path.read_bytes()
        same_bytes = after == before
        panel_has_stage = isinstance(panel_state, dict) and (
            "project_stage" in panel_state or "state" in panel_state or "target" in panel_state
        )
        passed = status.returncode == 0 and code == 200 and same_bytes and panel_has_stage
        return {
            "passed": passed,
            "detail": f"status={status.returncode}; api={code}; sameStateBytes={same_bytes}; panelKeys={list(panel_state)[:8] if isinstance(panel_state, dict) else type(panel_state).__name__}",
        }
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


def behavior_f3(target: Path) -> dict[str, Any]:
    common = import_common(target)
    path = target / "forge" / "state" / "ORACLE_ATOMIC.json"
    original = {"marker": "prior", "n": 1}
    common.save_json(path, original)
    prior_bytes = path.read_bytes()

    real_rename = os.rename
    real_replace = getattr(os, "replace", None)
    injected = {"hit": False}

    def boom(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        injected["hit"] = True
        raise OSError("oracle-injected rename/replace failure")

    os.rename = boom  # type: ignore[assignment]
    if real_replace is not None:
        os.replace = boom  # type: ignore[assignment]
    try:
        try:
            common.save_json(path, {"marker": "new", "n": 2})
            write_failed = False
        except OSError:
            write_failed = True
    finally:
        os.rename = real_rename  # type: ignore[assignment]
        if real_replace is not None:
            os.replace = real_replace  # type: ignore[assignment]

    try:
        after_bytes = path.read_bytes()
    except FileNotFoundError:
        after_bytes = b""
    parseable = False
    try:
        if after_bytes:
            parsed = json.loads(after_bytes.decode("utf-8"))
            parseable = parsed == original
    except Exception:
        parseable = False
    passed = injected["hit"] and write_failed and after_bytes == prior_bytes and parseable and len(after_bytes) > 0
    return {
        "passed": passed,
        "detail": f"injected={injected['hit']}; writeFailed={write_failed}; byteIdentical={after_bytes == prior_bytes}; parseable={parseable}; bytesAfter={len(after_bytes)}",
    }


def behavior_f4(target: Path) -> dict[str, Any]:
    common = import_common(target)
    path = target / "forge" / "ledger" / "ORACLE_CONCURRENT.jsonl"
    if path.exists():
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    total = 40

    def writer(idx: int) -> None:
        common.append_jsonl(path, {"oracle_id": idx, "payload": f"event-{idx}"})

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(writer, range(total)))

    text = path.read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if line.strip()]
    rows = []
    bad = 0
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            bad += 1
    ids = sorted({int(row["oracle_id"]) for row in rows if isinstance(row, dict) and "oracle_id" in row})
    passed = bad == 0 and len(lines) == total and ids == list(range(total))
    return {
        "passed": passed,
        "detail": f"lines={len(lines)}; uniqueIds={len(ids)}; badLines={bad}; expected={total}",
    }


def behavior_f5(target: Path) -> dict[str, Any]:
    common = import_common(target)
    json_path = target / "forge" / "state" / "ORACLE_UTF8.json"
    jsonl_path = target / "forge" / "ledger" / "ORACLE_UTF8.jsonl"
    payload = {"msg": "café — 你好", "n": 3}
    common.save_json(json_path, payload)
    if jsonl_path.exists():
        jsonl_path.unlink()
    common.append_jsonl(jsonl_path, payload)

    # Fresh interpreter read
    probe = run(
        [
            python_bin(target),
            "-c",
            (
                "import json,sys; from pathlib import Path; "
                f"p=Path(r'{json_path}'); q=Path(r'{jsonl_path}'); "
                "print(json.dumps({'json':json.loads(p.read_text(encoding='utf-8')),"
                "'jsonl':json.loads(q.read_text(encoding='utf-8').splitlines()[0]),"
                "'nl':repr(q.read_bytes()[-1:])}))"
            ),
        ],
        cwd=target,
        timeout=60,
    )
    if probe.returncode != 0:
        return {"passed": False, "detail": f"fresh read failed: {(probe.stderr or probe.stdout)[:300]}"}
    data = json.loads(probe.stdout.strip())
    nl_ok = data.get("nl") in {"b'\\n'", "b\"\\n\""}
    passed = data.get("json") == payload and data.get("jsonl") == payload and nl_ok
    return {"passed": passed, "detail": f"jsonMatch={data.get('json')==payload}; jsonlMatch={data.get('jsonl')==payload}; nl={data.get('nl')}"}


def _defines_private_persistence(path: Path) -> list[str]:
    """Private durable writers that must not diverge from common primitives."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    hits: list[str] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in {"write_json", "append_jsonl", "save_json"}:
            hits.append(node.name)
    return hits


def behavior_f6(target: Path) -> dict[str, Any]:
    panel = target / "tools" / "forgetastic" / "control_panel.py"
    state = target / "tools" / "forgetastic" / "state_engine.py"
    ledger = target / "tools" / "forgetastic" / "ledger_engine.py"
    evidence = target / "tools" / "forgetastic" / "evidence_engine.py"
    private = {}
    for label, path in (("control_panel", panel), ("state_engine", state)):
        if path.exists():
            private[label] = _defines_private_persistence(path)
    # Shared imports required for ledger/evidence/state durable writers.
    required_imports = {
        "ledger_engine": "append_jsonl",
        "evidence_engine": "append_jsonl",
        "state_engine": "save_json",
    }
    import_ok: dict[str, bool] = {}
    for mod_name, symbol in required_imports.items():
        path = target / "tools" / "forgetastic" / f"{mod_name}.py"
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        import_ok[mod_name] = (
            f"from .common import" in text or "from tools.forgetastic.common" in text
        ) and symbol in text

    # Session log in state_engine must not keep a private open/append path after refactor.
    state_text = state.read_text(encoding="utf-8") if state.exists() else ""
    session_uses_common = "append_jsonl(" in state_text and "SESSION_LOG" in state_text
    # Prefer: no private defs in control_panel; session log uses common append_jsonl.
    no_private_panel = private.get("control_panel") == []
    passed = no_private_panel and session_uses_common and all(import_ok.values())
    return {
        "passed": passed,
        "detail": f"privateDefs={private}; importOk={import_ok}; sessionUsesCommonAppend={session_uses_common}",
    }


def behavior_f7(target: Path) -> dict[str, Any]:
    common = import_common(target)
    path = target / "forge" / "state" / "ORACLE_LOCK.json"
    common.save_json(path, {"locked": False})

    # Hold an exclusive non-blocking lock in a background thread while attempting a write.
    held = threading.Event()
    release = threading.Event()
    holder_error: list[str] = []

    def holder() -> None:
        try:
            with path.open("r+", encoding="utf-8") as handle:
                if hasattr(common, "lock_file"):
                    common.lock_file(handle)
                else:
                    # Fall back to platform lock if common exports helpers via io.
                    from tools.forgetastic.common import io as io_mod  # type: ignore

                    io_mod.lock_file(handle)
                held.set()
                release.wait(10)
                if hasattr(common, "unlock_file"):
                    common.unlock_file(handle)
                else:
                    from tools.forgetastic.common import io as io_mod  # type: ignore

                    io_mod.unlock_file(handle)
        except Exception as exc:  # noqa: BLE001
            holder_error.append(str(exc))
            held.set()

    thread = threading.Thread(target=holder, daemon=True)
    thread.start()
    if not held.wait(3):
        release.set()
        return {"passed": False, "detail": "could not establish holder lock"}

    timed_out_or_failed = False
    detail = ""
    try:
        # Prefer an explicit lock-aware API when present.
        if hasattr(common, "save_json_locked"):
            try:
                common.save_json_locked(path, {"locked": True}, timeout_s=0.2)
                timed_out_or_failed = False
                detail = "save_json_locked unexpectedly succeeded"
            except Exception as exc:  # noqa: BLE001
                timed_out_or_failed = True
                detail = f"save_json_locked raised {type(exc).__name__}"
        else:
            # Probe that lock helpers exist and a contended lock fails closed.
            from tools.forgetastic.common import io as io_mod  # type: ignore

            with path.open("r+", encoding="utf-8") as handle:
                try:
                    io_mod.lock_file(handle)
                    # If this succeeds under contention, locking is not exclusive.
                    timed_out_or_failed = False
                    detail = "contended lock_file unexpectedly succeeded"
                    try:
                        io_mod.unlock_file(handle)
                    except Exception:
                        pass
                except Exception as exc:  # noqa: BLE001
                    timed_out_or_failed = True
                    detail = f"contended lock raised {type(exc).__name__}: {exc}"
    except Exception as exc:  # noqa: BLE001
        return {"passed": False, "detail": f"lock probe unavailable: {exc}; holder={holder_error}"}
    finally:
        release.set()
        thread.join(timeout=3)

    # Existing JSON must remain valid after the failed/contended attempt.
    try:
        remaining = json.loads(path.read_text(encoding="utf-8"))
        valid = isinstance(remaining, dict)
    except Exception:
        valid = False
    passed = timed_out_or_failed and valid and not holder_error
    return {"passed": passed, "detail": f"{detail}; stateValid={valid}; holderError={holder_error}"}


def behavior_f8(target: Path) -> dict[str, Any]:
    """Frozen sample release-gate verdict fields must stay stable."""
    sys.path.insert(0, str(target))
    from tools.forgetastic.release_gate_engine import run_release_gate  # type: ignore
    from tools.forgetastic.common import save_json  # type: ignore

    sample = target / ".oracle-f8-sample"
    if sample.exists():
        # clean previous
        import shutil

        shutil.rmtree(sample, ignore_errors=True)
    for rel in (
        "forge/reports",
        "forge/manifest",
        "forge/policy",
        "forge/state",
        "forge/prosecution",
        "forge/evidence",
    ):
        (sample / rel).mkdir(parents=True, exist_ok=True)

    # Minimal failing-closed fixture: missing PASS reports => FAIL verdict, stable shape.
    save_json(sample / "forge/manifest/MANIFEST.json", {
        "project": "oracle-f8",
        "mode": "STANDARD",
        "purpose": "frozen",
        "operator_approved": True,
        "manifest_locked": True,
        "behaviors": [],
        "failures": [],
        "integrations": [],
        "assumptions": [],
        "out_of_scope": [],
    })
    save_json(sample / "forge/reports/AUDIT_REPORT.json", {"system_verdict": "PASS"})
    save_json(sample / "forge/reports/TRUTH_REPORT.json", {"verdict": "PASS"})
    save_json(sample / "forge/reports/INTEGRITY_REPORT.json", {"verdict": "PASS"})
    save_json(sample / "forge/reports/DEPLOYMENT_GATE.json", {"verdict": "PASS"})
    save_json(sample / "forge/prosecution/PROSECUTION_COMPARISON.json", {"verdict": "PASS"})

    first = run_release_gate(sample)
    second = run_release_gate(sample)
    keys = ("verdict", "blocking_items")
    stable = all(first.get(k) == second.get(k) for k in keys if k in first or k in second)
    has_verdict = "verdict" in first and first["verdict"] in {"PASS", "FAIL"}
    passed = stable and has_verdict and isinstance(first.get("blocking_items", []), list)
    return {
        "passed": passed,
        "detail": f"verdict={first.get('verdict')}; stable={stable}; blockers={len(first.get('blocking_items') or [])}",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Independent Forgetastic refactor oracle")
    parser.add_argument("--target", required=True, help="Disposable Forgetastic copy")
    parser.add_argument("--output", help="Optional JSON evidence path")
    args = parser.parse_args()

    criteria_sha = ensure_criteria()
    target = prepare_workspace(Path(args.target).resolve())
    results: dict[str, dict[str, Any]] = {}

    checks = [
        ("F1", behavior_f1),
        ("F2", behavior_f2),
        ("F3", behavior_f3),
        ("F4", behavior_f4),
        ("F5", behavior_f5),
        ("F6", behavior_f6),
        ("F7", behavior_f7),
        ("F8", behavior_f8),
    ]
    for behavior_id, fn in checks:
        try:
            results[behavior_id] = fn(target)
        except Exception as exc:  # noqa: BLE001
            results[behavior_id] = {"passed": False, "detail": f"harness: {type(exc).__name__}: {exc}"}

    payload = {
        "schemaVersion": 1,
        "oracle": "refactor-forgetastic",
        "target": str(target),
        "criteriaSha256": criteria_sha,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": results,
        "passed": len(results) == 8 and all(item.get("passed") for item in results.values()),
    }
    text = json.dumps(payload, indent=2) + "\n"
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
