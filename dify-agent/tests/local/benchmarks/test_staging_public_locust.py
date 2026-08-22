from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

from pydantic import BaseModel, SecretStr

from benchmarks.staging_public_locust import (
    StagingPublicSmokeRequest,
    bounded_end_user,
    run_staging_public_smoke,
)
from benchmarks.staging_public_schemas import (
    STAGING_PUBLIC_SCENARIO_SEQUENCE,
    StagingPublicCleanupResult,
    StagingPublicLoadResult,
    StagingPublicRunSample,
    StagingPublicSmokeExecution,
)


class _Settings(BaseModel):
    service_api_base_url: str = "https://api-staging.example/v1/"
    api_key: SecretStr
    config_expected_sha256: str = "a" * 64


def _execution() -> StagingPublicSmokeExecution:
    samples = []
    for scenario in STAGING_PUBLIC_SCENARIO_SEQUENCE:
        samples.append(
            StagingPublicRunSample(
                scenario_id=scenario,
                benchmark_run_id=f"smoke-123.{scenario}",
                admitted=True,
                http_status_code=200,
                conversation_reused=scenario != "basic",
                response_headers_ms=1,
                time_to_first_sse_ms=2,
                time_to_first_answer_ms=3,
                terminal_e2e_ms=4,
                event_count=2,
                answer_bytes=10,
                terminal_status="succeeded",
                deterministic_markers_valid=True,
                shell_evidence_valid=scenario == "shell",
                config_materialized_item_count=13 if scenario == "config" else 0,
                config_materialized_bytes=53_248 if scenario == "config" else 0,
                config_materialized_sha256="a" * 64 if scenario == "config" else None,
                config_sha_valid=scenario == "config",
            )
        )
    return StagingPublicSmokeExecution(
        samples=samples,
        cleanup=StagingPublicCleanupResult(
            attempted=True,
            http_status_code=204,
            conversation_deleted=True,
            complete=True,
        ),
        load=StagingPublicLoadResult(
            spawned_users=1,
            observed_max_active=1,
            elapsed_seconds=1,
            locust_version="2.44.4",
        ),
    )


def test_parent_import_does_not_load_or_patch_locust() -> None:
    script = "import ssl,sys; import benchmarks.staging_public_locust; assert 'locust' not in sys.modules"
    process = subprocess.run(  # noqa: S603 - fixed interpreter and test script.
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
    )

    assert process.returncode == 0, process.stderr


def test_parent_uses_secret_free_subprocess_wire(monkeypatch) -> None:
    secret = "secret-never-write"
    observed: dict[str, object] = {}

    def fake_run(argv, **kwargs):
        observed["argv"] = argv
        observed["environment"] = kwargs["env"]
        request_path = Path(argv[argv.index("--request") + 1])
        result_path = Path(argv[argv.index("--result") + 1])
        observed["request"] = request_path.read_text(encoding="utf-8")
        result_path.write_text(_execution().model_dump_json(), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid")
    monkeypatch.setenv("LOCUST_SKIP_MONKEY_PATCH", "1")
    monkeypatch.setattr(subprocess, "run", fake_run)
    execution = run_staging_public_smoke(
        StagingPublicSmokeRequest(
            invocation_id="smoke-123",
            settings=_Settings(api_key=SecretStr(secret)),
            timeout_seconds=5,
        )
    )

    assert execution.model_dump() == _execution().model_dump()
    assert secret not in json.dumps(observed["argv"])
    assert secret not in str(observed["request"])
    environment = observed["environment"]
    assert isinstance(environment, dict)
    assert environment["BENCH_STAGING_API_KEY"] == secret
    assert "HTTPS_PROXY" not in environment
    assert "LOCUST_SKIP_MONKEY_PATCH" not in environment


def test_isolated_worker_imports_locust_in_a_clean_interpreter() -> None:
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603 - fixed interpreter/module argv.
        [sys.executable, "-m", "benchmarks.staging_public_locust_worker", "--help"],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
    )

    assert process.returncode == 0, process.stderr
    assert "--request" in process.stdout
    assert "--result" in process.stdout


def test_bounded_end_user_is_stable_safe_and_bounded() -> None:
    first = bounded_end_user("unsafe user/" + "x" * 200)
    second = bounded_end_user("unsafe user/" + "x" * 200)

    assert first == second
    assert len(first) <= 80
    assert " " not in first
    assert "/" not in first


def test_bounded_end_user_preserves_uniqueness_when_truncated() -> None:
    long_prefix = "x" * 120

    first = bounded_end_user(f"{long_prefix}.w0")
    second = bounded_end_user(f"{long_prefix}.w1")

    assert len(first) <= 80
    assert len(second) <= 80
    assert first != second
