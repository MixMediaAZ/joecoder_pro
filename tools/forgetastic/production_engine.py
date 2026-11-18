# tools/forgetastic/production_engine.py (BUILD 11)

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .common import load_json, save_json, utc_now_iso, sha256_dict

DEPLOYMENT_GATE_PATH = Path("forge/reports/DEPLOYMENT_GATE.json")
PRODUCTION_CONFIG_PATH = Path("forge/policy/PRODUCTION.json")


def _deployment_gate_path(root: Path) -> Path:
    return root / DEPLOYMENT_GATE_PATH


def _production_config_path(root: Path) -> Path:
    return root / PRODUCTION_CONFIG_PATH


def default_production_config() -> dict[str, Any]:
    """
    Default production configuration with strict, fail-safe-secure settings.

    Key security-first defaults:
    - require_live_runtime_proof: True (mandate real execution proof)
    - min_proof_confidence_level: 1 (only strongest tier proofs allowed)
    - require_command_artifact_binding: True (cryptographic proof binding)
    - enforce_determinism: True (isolated execution with repeated runs)
    """
    return {
        "production_enforced": True,
        "system_freeze_mode": False,
        "project_owner": "",
        "completion_deadline_utc": "",
        "deployment_targets": [],
        "stale_project_days": 30,
        "require_live_runtime_proof": True,
        "require_owner_signoff": False,
        "min_proof_confidence_level": 1,
        "require_command_artifact_binding": True,
        "enforce_determinism": True,
        "created_utc": utc_now_iso(),
        "updated_utc": utc_now_iso(),
    }


def ensure_production_config(root: Path) -> dict[str, Any]:
    path = _production_config_path(root)
    if not path.exists():
        payload = default_production_config()
        save_json(path, payload)
        return payload
    return load_json(path, default={}) or {}


def save_production_config(root: Path, cfg: dict[str, Any]) -> None:
    cfg["updated_utc"] = utc_now_iso()
    save_json(_production_config_path(root), cfg)


def validate_production_config(cfg: dict[str, Any], profile_mode: str = "STANDARD") -> dict[str, Any]:
    """
    Validate production configuration against strict security hardening rules.

    For RELEASE profile, enforces unforgeable proof and determinism:
    - deployment_targets must be non-empty (at least one target defined)
    - require_live_runtime_proof must be True (mandatory)
    - require_owner_signoff must be True (mandatory)
    - project_owner must be non-empty string
    - min_proof_confidence_level must be <= 2 (high-confidence proofs only)
    - require_command_artifact_binding must be True (cryptographic proof binding)
    - enforce_determinism must be True (isolated subprocess execution)

    Args:
        cfg: Production config dict
        profile_mode: Project mode (STANDARD, RELEASE, etc.)

    Returns:
        Dict with verdict (PASS/FAIL) and blocking_items list
    """
    blocking_items: list[dict[str, Any]] = []

    if profile_mode == "RELEASE":
        deployment_targets = cfg.get("deployment_targets") or []
        require_live_proof = bool(cfg.get("require_live_runtime_proof", False))
        require_owner = bool(cfg.get("require_owner_signoff", False))
        owner = str(cfg.get("project_owner", "")).strip()
        min_confidence = int(cfg.get("min_proof_confidence_level", 5))
        require_binding = bool(cfg.get("require_command_artifact_binding", False))
        enforce_determ = bool(cfg.get("enforce_determinism", False))

        if not deployment_targets:
            blocking_items.append({
                "id": "DEPLOYMENT_TARGETS",
                "message": "RELEASE profile requires at least one deployment target (non-empty deployment_targets)",
            })

        if not require_live_proof:
            blocking_items.append({
                "id": "LIVE_PROOF",
                "message": "RELEASE profile requires require_live_runtime_proof=True (mandatory: proof must come from live execution)",
            })

        if not require_owner:
            blocking_items.append({
                "id": "OWNER_SIGNOFF",
                "message": "RELEASE profile requires require_owner_signoff=True (owner must approve release)",
            })

        if not owner:
            blocking_items.append({
                "id": "PROJECT_OWNER",
                "message": "RELEASE profile requires non-empty project_owner field",
            })

        if min_confidence > 2:
            blocking_items.append({
                "id": "MIN_CONFIDENCE",
                "message": f"RELEASE profile requires min_proof_confidence_level <= 2 (found {min_confidence}; only highest-confidence proofs allowed)",
            })

        if not require_binding:
            blocking_items.append({
                "id": "ARTIFACT_BINDING",
                "message": "RELEASE profile requires require_command_artifact_binding=True (mandatory: proofs must be cryptographically bound to commands)",
            })

        if not enforce_determ:
            blocking_items.append({
                "id": "DETERMINISM",
                "message": "RELEASE profile requires enforce_determinism=True (mandatory: tests must be deterministic across isolated runs)",
            })

    return {
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "profile_mode": profile_mode,
    }


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def _days_until(deadline_utc: str | None) -> float | None:
    parsed = _parse_utc(deadline_utc)
    if not parsed:
        return None
    delta = parsed - datetime.now(UTC)
    return delta.total_seconds() / 86400.0


def _days_since(timestamp_utc: str | None) -> float | None:
    parsed = _parse_utc(timestamp_utc)
    if not parsed:
        return None
    delta = datetime.now(UTC) - parsed
    return delta.total_seconds() / 86400.0


def check_url(url: str, timeout_seconds: int = 10) -> dict[str, Any]:
    if not url:
        return {
            "url": url,
            "reachable": False,
            "status_code": None,
            "reason": "missing_url",
        }

    request = urllib.request.Request(url, headers={"User-Agent": "Forgetastic/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(256).decode("utf-8", errors="ignore")
            return {
                "url": url,
                "reachable": True,
                "status_code": response.getcode(),
                "reason": "ok",
                "body_preview": body,
            }
    except urllib.error.HTTPError as exc:
        return {
            "url": url,
            "reachable": False,
            "status_code": exc.code,
            "reason": f"http_error:{exc.code}",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "url": url,
            "reachable": False,
            "status_code": None,
            "reason": str(exc),
        }


def latest_live_proof(root: Path) -> dict[str, Any] | None:
    proof_path = root / "forge" / "evidence" / "RUNTIME_PROOF.jsonl"
    if not proof_path.exists():
        return None

    latest: dict[str, Any] | None = None
    with proof_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            if row.get("environment") == "PROD":
                latest = row

    return latest


def run_deployment_gate(root: Path) -> dict[str, Any]:
    from .manifest_lint import load_manifest

    manifest = load_manifest(root / "forge/manifest/MANIFEST.json")
    production = ensure_production_config(root)
    done_gate = load_json(root / "forge" / "reports" / "DONE_GATE.json", default={}) or {}
    final_snapshot = load_json(root / "forge" / "final" / "FINAL_SNAPSHOT.json", default={}) or {}
    project_state = load_json(root / "forge" / "state" / "STATE.json", default={}) or {}
    latest_prod_proof = latest_live_proof(root)

    blocking_items: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # Validate production config based on project mode (HARDENING #3)
    profile_mode = manifest.get("mode", "STANDARD") if manifest else "STANDARD"
    config_validation = validate_production_config(production, profile_mode)
    if config_validation.get("verdict") != "PASS":
        blocking_items.extend(config_validation.get("blocking_items", []))

    owner = str(production.get("project_owner", "")).strip()
    deadline_utc = str(production.get("completion_deadline_utc", "")).strip()
    stale_project_days = int(production.get("stale_project_days", 30))
    require_live_runtime_proof = bool(production.get("require_live_runtime_proof", False))
    require_owner_signoff = bool(production.get("require_owner_signoff", False))
    system_freeze_mode = bool(production.get("system_freeze_mode", False))

    if require_owner_signoff and not owner:
        blocking_items.append({"id": "PRODUCTION", "message": "project_owner is required"})

    if done_gate.get("verdict") != "PASS":
        blocking_items.append({"id": "DONE_GATE", "message": "Done gate must PASS before deployment gate can pass"})

    if not final_snapshot:
        blocking_items.append({"id": "FINAL_SNAPSHOT", "message": "Final snapshot is missing"})

    deadline_days = _days_until(deadline_utc)
    if deadline_utc:
        if deadline_days is not None and deadline_days < 0:
            blocking_items.append({"id": "DEADLINE", "message": "Completion deadline has passed"})
        elif deadline_days is not None and deadline_days <= 3:
            warnings.append({"id": "DEADLINE", "message": f"Completion deadline is near: {deadline_days:.2f} days remaining"})

    deployment_checks: list[dict[str, Any]] = []
    for target in production.get("deployment_targets", []) or []:
        base_url = str(target.get("base_url", "")).strip()
        health_url = str(target.get("healthcheck_url", "")).strip()
        check = {
            "name": target.get("name", "unnamed"),
            "base_url": check_url(base_url),
            "healthcheck_url": check_url(health_url),
            "required": bool(target.get("required", True)),
        }
        deployment_checks.append(check)

        if check["required"] and (base_url or health_url):
            if base_url and not check["base_url"]["reachable"]:
                blocking_items.append(
                    {"id": f"DEPLOY:{check['name']}", "message": f"Base URL not reachable: {check['base_url']['reason']}"}
                )
            if health_url and not check["healthcheck_url"]["reachable"]:
                blocking_items.append(
                    {"id": f"HEALTH:{check['name']}", "message": f"Healthcheck URL not reachable: {check['healthcheck_url']['reason']}"}
                )

    if require_live_runtime_proof:
        if not latest_prod_proof:
            blocking_items.append({"id": "LIVE_PROOF", "message": "At least one PROD runtime proof is required"})
        else:
            latest_status = str(latest_prod_proof.get("status", "")).upper()
            if latest_status != "PASS":
                blocking_items.append({"id": "LIVE_PROOF", "message": f"Latest PROD runtime proof is not PASS: {latest_status}"})

    last_check_utc = project_state.get("last_check_utc")
    staleness_days = _days_since(last_check_utc)
    if staleness_days is not None and staleness_days > stale_project_days:
        blocking_items.append(
            {"id": "STALE_PROJECT", "message": f"Project state is stale: {staleness_days:.2f} days since last check"}
        )

    report: dict[str, Any] = {
        "report_name": "DEPLOYMENT_GATE",
        "generated_utc": utc_now_iso(),
        "manifest_hash": sha256_dict(manifest) if manifest else None,
        "verdict": "PASS" if not blocking_items else "FAIL",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "summary": {
            "project_owner": owner,
            "deadline_utc": deadline_utc,
            "system_freeze_mode": system_freeze_mode,
            "deployment_target_count": len(deployment_checks),
            "latest_prod_proof_id": (latest_prod_proof or {}).get("proof_id"),
            "latest_prod_proof_status": (latest_prod_proof or {}).get("status"),
        },
        "deployment_checks": deployment_checks,
    }

    save_json(_deployment_gate_path(root), report)
    return report
