"""Local entrypoint for the explicitly confirmed Staging public E2E smoke."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from zipfile import BadZipFile, ZipFile

from pydantic import SecretStr

from benchmarks.staging_public_locust import (
    STAGING_PUBLIC_SCENARIO_SEQUENCE,
    StagingPublicSmokeRequest,
    run_staging_public_smoke,
)
from benchmarks.staging_public_protocol import StagingPublicProtocolSettings
from benchmarks.staging_public_results import (
    build_staging_public_environment,
    finalize_staging_public_smoke,
)
from benchmarks.staging_public_schemas import StagingPublicCleanupResult


DEFAULT_STAGING_PUBLIC_BASE_URL = "https://api-staging.dify.dev/v1/"
DEFAULT_CONFIG_EXPECTED_SHA256 = "318fdd5b5ef72c47b2df2890d724cf8fbb4764dee352911f9de8535af4748dc3"
STAGING_PUBLIC_CONFIRMATION = "RUN_STAGING_BENCHMARK"
TARGET_COMMIT = "f5e1f1590f3e179b3ab28c1df5984667691fd86a"
DETERMINISTIC_PLUGIN_VERSION = "0.1.4"
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")


def main() -> int:
    api_key: str | None = None
    artifact_dir: Path | None = None
    failure_artifacts_written = False
    try:
        args = _parse_args()
        if os.environ.get("BENCH_CONFIRM_STAGING_RUN") != STAGING_PUBLIC_CONFIRMATION:
            raise RuntimeError("public Staging smoke requires BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK")
        api_key = os.environ.get("BENCH_STAGING_API_KEY")
        if not api_key:
            raise RuntimeError("BENCH_STAGING_API_KEY must be provided through the environment")
        run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        if not _RUN_ID_RE.fullmatch(run_id):
            raise ValueError("run id must contain only benchmark-safe identity characters")
        current_artifact_dir: Path = args.results_root / f"{run_id}-staging-public-smoke"
        artifact_dir = current_artifact_dir
        plugin_package = args.plugin_package
        if not plugin_package.is_file():
            raise RuntimeError(f"deterministic plugin package was not found: {plugin_package}")
        plugin_version = _plugin_package_version(plugin_package)
        if plugin_version != DETERMINISTIC_PLUGIN_VERSION:
            raise RuntimeError(
                "deterministic plugin package version did not match the public smoke contract: "
                f"expected {DETERMINISTIC_PLUGIN_VERSION}, found {plugin_version}"
            )
        plugin_package_sha256 = _sha256(plugin_package)
        scenario_manifest_sha256 = _public_scenario_manifest_sha256()
        commit, dirty = _git_identity()
        settings = StagingPublicProtocolSettings(
            service_api_base_url=args.service_api_base_url,
            api_key=SecretStr(api_key),
            config_expected_sha256=args.config_expected_sha256,
        )
        current_artifact_dir.mkdir(parents=True, exist_ok=False)
        try:
            execution = run_staging_public_smoke(StagingPublicSmokeRequest(invocation_id=run_id, settings=settings))
        except (OSError, RuntimeError, ValueError) as exc:
            message = _redact_failure(str(exc), api_key)
            _write_worker_failure_artifacts(
                artifact_dir=current_artifact_dir,
                failure_kind=_worker_failure_kind(message),
                message=message,
            )
            failure_artifacts_written = True
            raise
        environment = build_staging_public_environment(
            invocation_id=run_id,
            service_api_base_url=settings.service_api_base_url,
            harness_commit=commit,
            harness_dirty=dirty,
            target_commit=TARGET_COMMIT,
            scenario_manifest_sha256=scenario_manifest_sha256,
            deterministic_plugin_version=plugin_version,
            deterministic_plugin_package_sha256=plugin_package_sha256,
            config_expected_sha256=settings.config_expected_sha256,
            edge_version=next((sample.edge_version for sample in execution.samples if sample.edge_version), None),
            edge_server=next((sample.edge_server for sample in execution.samples if sample.edge_server), None),
        )
        _, success = finalize_staging_public_smoke(
            artifact_dir=current_artifact_dir,
            environment=environment,
            execution=execution,
        )
        print(current_artifact_dir)
        return 0 if success else 1
    except (OSError, RuntimeError, ValueError) as exc:
        message = _redact_failure(str(exc), api_key)
        print(f"staging public smoke failed: {message}", file=sys.stderr)
        if failure_artifacts_written and artifact_dir is not None:
            print(f"staging public smoke diagnostics: {artifact_dir}", file=sys.stderr)
        return 2


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-api-base-url", default=DEFAULT_STAGING_PUBLIC_BASE_URL)
    parser.add_argument(
        "--config-expected-sha256",
        default=os.environ.get("BENCH_CONFIG_EXPECTED_SHA256", DEFAULT_CONFIG_EXPECTED_SHA256),
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--plugin-package",
        type=Path,
        default=Path(__file__).with_name("build") / "staging" / "dify-agent-benchmark-model-0.1.4.difypkg",
    )
    parser.add_argument("--results-root", type=Path, default=Path(__file__).with_name("results"))
    return parser.parse_args()


def _git_identity() -> tuple[str, bool]:
    repository_root = Path(__file__).resolve().parents[2]
    revision = subprocess.run(  # noqa: S603 - fixed git argv.
        ["git", "rev-parse", "HEAD"],
        cwd=repository_root,
        capture_output=True,
        text=True,
        check=False,
    )
    status = subprocess.run(  # noqa: S603 - fixed git argv.
        ["git", "status", "--porcelain", "--", "dify-agent"],
        cwd=repository_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if revision.returncode != 0 or status.returncode != 0:
        raise RuntimeError("could not capture the public benchmark Git identity")
    return revision.stdout.strip(), bool(status.stdout.strip())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _plugin_package_version(path: Path) -> str:
    try:
        with ZipFile(path) as package:
            manifest = package.read("manifest.yaml").decode("utf-8")
    except (BadZipFile, KeyError, UnicodeDecodeError) as exc:
        raise RuntimeError("deterministic plugin package did not contain a valid manifest.yaml") from exc
    for line in manifest.splitlines():
        if line.startswith("version:"):
            version_value = line.partition(":")[2].strip().strip("\"'")
            if version_value:
                return version_value
            break
    raise RuntimeError("deterministic plugin package manifest did not declare a root version")


def _public_scenario_manifest_sha256() -> str:
    payload = json.dumps(
        {
            "mode": "staging-public-e2e",
            "requested_concurrency": 1,
            "scenario_version": 1,
            "sequence": STAGING_PUBLIC_SCENARIO_SEQUENCE,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _write_worker_failure_artifacts(
    *,
    artifact_dir: Path,
    failure_kind: str,
    message: str,
) -> None:
    """Persist fail-closed evidence when the isolated load worker cannot report."""

    logs_dir = artifact_dir / "logs"
    logs_dir.mkdir(exist_ok=True)
    diagnostics = {
        "status": "failed",
        "failure_stage": "locust_worker",
        "failure_kind": failure_kind,
        "error": message,
        "cleanup": "unknown",
        "normal_result_written": False,
    }
    cleanup = StagingPublicCleanupResult(
        attempted=False,
        conversation_deleted=False,
        complete=False,
        error="unknown: the Locust worker did not return cleanup evidence",
    )
    (artifact_dir / "diagnostics.json").write_text(
        json.dumps(diagnostics, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (artifact_dir / "cleanup.json").write_text(cleanup.model_dump_json(indent=2) + "\n", encoding="utf-8")
    (logs_dir / "worker-failure.log").write_text(
        f"status=failed\nfailure_stage=locust_worker\nfailure_kind={failure_kind}\ncleanup=unknown\nerror={message}\n",
        encoding="utf-8",
    )


def _worker_failure_kind(message: str) -> str:
    if "process timeout" in message:
        return "worker_timeout"
    if "invalid result" in message:
        return "worker_invalid_result"
    if "failed with exit" in message:
        return "worker_crash"
    return "worker_failure"


def _redact_failure(message: str, api_key: str | None) -> str:
    if api_key:
        message = message.replace(api_key, "[REDACTED]")
    return message[:2000]


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DEFAULT_CONFIG_EXPECTED_SHA256",
    "DEFAULT_STAGING_PUBLIC_BASE_URL",
    "STAGING_PUBLIC_CONFIRMATION",
    "main",
]
