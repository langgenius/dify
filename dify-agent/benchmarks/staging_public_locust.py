"""Patch-free parent facade for the isolated public Staging Locust worker."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Protocol

from pydantic import SecretStr

from benchmarks.staging_public_schemas import (
    STAGING_PUBLIC_SCENARIO_SEQUENCE,
    StagingPublicSmokeExecution,
    StagingPublicWorkerRequest,
)


STAGING_PUBLIC_SMOKE_TIMEOUT_SECONDS = 600.0
_END_USER_PREFIX = "dify-bench-"
_END_USER_MAX_LENGTH = 80
_SAFE_END_USER_RE = re.compile(r"[^A-Za-z0-9_.:-]+")
_WORKER_ENVIRONMENT_KEYS = {
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PYTHONPATH",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONUNBUFFERED",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TZ",
    "VIRTUAL_ENV",
}


class _ProtocolSettings(Protocol):
    service_api_base_url: str
    api_key: SecretStr
    config_expected_sha256: str


@dataclass(frozen=True, slots=True)
class StagingPublicSmokeRequest:
    """Private parent inputs for one explicitly confirmed c1 smoke."""

    invocation_id: str
    settings: _ProtocolSettings = field(repr=False)
    timeout_seconds: float = STAGING_PUBLIC_SMOKE_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        if not self.invocation_id or len(self.invocation_id) > 120:
            raise ValueError("invocation_id must contain 1 to 120 characters")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")


def run_staging_public_smoke(request: StagingPublicSmokeRequest) -> StagingPublicSmokeExecution:
    """Execute Locust in a fresh interpreter before HTTP/SSL modules load."""

    api_key = request.settings.api_key.get_secret_value()
    if not api_key:
        raise ValueError("Service API key cannot be empty")
    wire_request = StagingPublicWorkerRequest(
        invocation_id=request.invocation_id,
        service_api_base_url=request.settings.service_api_base_url,
        config_expected_sha256=request.settings.config_expected_sha256,
        timeout_seconds=request.timeout_seconds,
    )
    with tempfile.TemporaryDirectory(prefix="dify-staging-public-") as temporary:
        temporary_path = Path(temporary)
        request_path = temporary_path / "request.json"
        result_path = temporary_path / "execution.json"
        request_path.write_text(wire_request.model_dump_json(), encoding="utf-8")
        environment = staging_public_worker_environment(api_key)
        try:
            process = subprocess.run(  # noqa: S603 - fixed interpreter/module argv.
                [
                    sys.executable,
                    "-m",
                    "benchmarks.staging_public_locust_worker",
                    "--request",
                    str(request_path),
                    "--result",
                    str(result_path),
                ],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True,
                text=True,
                check=False,
                env=environment,
                timeout=request.timeout_seconds + 30,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("isolated public Locust worker exceeded its process timeout") from exc
        if process.returncode not in {0, 1} or not result_path.is_file():
            diagnostic = _redact_worker_output(
                "\n".join(part.strip() for part in (process.stdout, process.stderr) if part.strip()),
                api_key,
            )
            suffix = f": {diagnostic}" if diagnostic else ""
            raise RuntimeError(f"isolated public Locust worker failed with exit {process.returncode}{suffix}")
        try:
            execution = StagingPublicSmokeExecution.model_validate_json(result_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("isolated public Locust worker returned an invalid result") from exc
    serialized = execution.model_dump_json()
    if api_key in serialized:
        raise RuntimeError("isolated public Locust worker leaked its Service API key")
    return execution


def bounded_end_user(invocation_id: str) -> str:
    """Create a stable, public-API-safe user identifier without secrets."""

    normalized = _SAFE_END_USER_RE.sub("-", invocation_id).strip("-.") or "smoke"
    candidate = _END_USER_PREFIX + normalized
    if len(candidate) <= _END_USER_MAX_LENGTH:
        return candidate
    digest = hashlib.sha256(invocation_id.encode()).hexdigest()[:12]
    prefix_length = _END_USER_MAX_LENGTH - len(digest) - 1
    return f"{candidate[:prefix_length]}-{digest}"


def staging_public_worker_environment(api_key: str) -> dict[str, str]:
    environment = {name: value for name, value in os.environ.items() if name in _WORKER_ENVIRONMENT_KEYS}
    environment["BENCH_STAGING_API_KEY"] = api_key
    return environment


def _redact_worker_output(value: str, api_key: str) -> str:
    return value.replace(api_key, "[REDACTED]")[:2000]


__all__ = [
    "STAGING_PUBLIC_SCENARIO_SEQUENCE",
    "STAGING_PUBLIC_SMOKE_TIMEOUT_SECONDS",
    "StagingPublicSmokeRequest",
    "bounded_end_user",
    "run_staging_public_smoke",
    "staging_public_worker_environment",
]
