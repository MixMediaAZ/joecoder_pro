from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path


def sha256_dict(data: dict) -> str:
    """
    Deterministic SHA256 hash of dict.

    IMPORTANT: Must sort keys for determinism.
    """
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def hmac_sha256(message: str, secret: str) -> str:
    """
    HMAC-SHA256 signature of a message using a shared secret.

    Args:
        message: String to sign
        secret: Shared secret key

    Returns:
        Hex-encoded HMAC-SHA256 signature
    """
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def hmac_sha256_dict(data: dict, secret: str) -> str:
    """
    Deterministic HMAC-SHA256 signature of dict using a shared secret.

    IMPORTANT: Keys are sorted for determinism; same dict always produces same signature.

    Args:
        data: Dict to sign
        secret: Shared secret key

    Returns:
        Hex-encoded HMAC-SHA256 signature
    """
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hmac_sha256(canonical, secret)


def sha256_file(file_path: Path | str) -> str:
    """
    Compute SHA256 hash of a file by reading in chunks.

    Args:
        file_path: Path to file

    Returns:
        Hex-encoded SHA256 hash

    Raises:
        OSError: If file cannot be read
    """
    if isinstance(file_path, str):
        file_path = Path(file_path)

    hasher = hashlib.sha256()
    with file_path.open("rb") as f:
        while True:
            chunk = f.read(8192)  # 8KB chunks
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()
