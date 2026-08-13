from __future__ import annotations

import json
from pathlib import Path
from benchmarks.staging_public_results import (
    build_staging_public_environment,
    finalize_staging_public_smoke,
)
from benchmarks.staging_public_schemas import (
    StagingPublicCleanupResult,
    StagingPublicLoadResult,
    StagingPublicRunSample,
    StagingPublicScenarioId,
    StagingPublicSmokeExecution,
)


def _sample(scenario_id: StagingPublicScenarioId) -> StagingPublicRunSample:
    return StagingPublicRunSample(
        scenario_id=scenario_id,
        benchmark_run_id=f"run.{scenario_id}",
        admitted=True,
        http_status_code=200,
        conversation_reused=scenario_id != "basic",
        response_headers_ms=1,
        time_to_first_sse_ms=2,
        time_to_first_answer_ms=3,
        terminal_e2e_ms=4,
        event_count=2,
        answer_bytes=10,
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        shell_evidence_valid=scenario_id == "shell",
        config_materialized_item_count=13 if scenario_id == "config" else 0,
        config_materialized_bytes=53_248 if scenario_id == "config" else 0,
        config_materialized_sha256="a" * 64 if scenario_id == "config" else None,
        config_sha_valid=scenario_id == "config",
    )


def _environment():
    return build_staging_public_environment(
        invocation_id="smoke",
        service_api_base_url="https://api-staging.dify.dev/v1/",
        harness_commit="a" * 40,
        harness_dirty=True,
        target_commit="f" * 40,
        scenario_manifest_sha256="b" * 64,
        deterministic_plugin_version="0.1.2",
        deterministic_plugin_package_sha256="c" * 64,
        config_expected_sha256="d" * 64,
        edge_version="1.16.1",
        edge_server="cloudflare",
    )


def _execution(samples: list[StagingPublicRunSample]) -> StagingPublicSmokeExecution:
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
            stats={"entries": []},
        ),
    )


def test_finalize_writes_schema_v3_smoke_only_artifacts(tmp_path: Path) -> None:
    result, success = finalize_staging_public_smoke(
        artifact_dir=tmp_path,
        environment=_environment(),
        execution=_execution([_sample("basic"), _sample("shell"), _sample("config")]),
    )

    assert success
    assert result.schema_version == 3
    assert result.mode == "staging-public-e2e"
    assert result.smoke_only
    assert result.confidence == "low_confidence"
    assert result.capacity_assessment == "not_applicable"
    assert result.status == "passed"
    expected = {
        "result.json",
        "report.md",
        "samples.jsonl",
        "environment.json",
        "locust-stats.json",
        "cleanup.json",
        "logs",
    }
    assert {path.name for path in tmp_path.iterdir()} == expected
    assert len((tmp_path / "samples.jsonl").read_text().splitlines()) == 3
    report = (tmp_path / "report.md").read_text()
    assert "Capacity: **N/A**" in report
    assert "Successful transactions: **3/3 (100.00%)**" in report
    assert "low_confidence" in report
    assert "CPU-ms" not in report
    assert "Redis commands" not in report
    assert "E2B s/" not in report
    assert "Public edge x-version / server: `1.16.1` / `cloudflare`" in report
    assert "Deterministic plugin expected package:" in report
    assert "`local_expected_package`" in report
    payload = json.loads((tmp_path / "result.json").read_text())
    assert payload["environment"]["target_commit"] == "f" * 40
    assert payload["environment"]["deterministic_plugin_package_evidence"] == "local_expected_package"
    assert payload["environment"]["config_expected_sha256"] == "d" * 64
    assert "e2b" not in payload
    assert "redis" not in payload


def test_incomplete_sequence_is_failed_not_capacity_data(tmp_path: Path) -> None:
    result, success = finalize_staging_public_smoke(
        artifact_dir=tmp_path,
        environment=_environment(),
        execution=_execution([_sample("basic"), _sample("shell")]),
    )

    assert not success
    assert result.status == "failed"
    assert result.capacity_assessment == "not_applicable"
    assert any("scenario sequence was incomplete" in error for error in result.errors)


def test_result_requires_one_conversation_and_proven_cleanup(tmp_path: Path) -> None:
    samples = [_sample("basic"), _sample("shell"), _sample("config")]
    samples[1].conversation_reused = False
    execution = _execution(samples)
    execution.cleanup = StagingPublicCleanupResult(complete=True)

    result, success = finalize_staging_public_smoke(
        artifact_dir=tmp_path,
        environment=_environment(),
        execution=execution,
    )

    assert not success
    assert any("one conversation chain" in error for error in result.errors)
    assert "public conversation cleanup was incomplete" in result.errors
