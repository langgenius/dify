from __future__ import annotations

from benchmarks.staging_public_schemas import StagingPublicRunSample


def test_public_sample_success_requires_scenario_specific_evidence() -> None:
    basic = StagingPublicRunSample(
        scenario_id="basic",
        benchmark_run_id="smoke.basic",
        admitted=True,
        http_status_code=200,
        response_headers_ms=1,
        time_to_first_sse_ms=2,
        time_to_first_answer_ms=3,
        terminal_e2e_ms=4,
        event_count=2,
        terminal_status="succeeded",
        deterministic_markers_valid=True,
    )
    shell = StagingPublicRunSample(
        scenario_id="shell",
        benchmark_run_id="smoke.shell",
        admitted=True,
        http_status_code=200,
        response_headers_ms=1,
        time_to_first_sse_ms=2,
        time_to_first_answer_ms=3,
        terminal_e2e_ms=4,
        event_count=2,
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        shell_evidence_valid=True,
    )
    config = StagingPublicRunSample(
        scenario_id="config",
        benchmark_run_id="smoke.config",
        admitted=True,
        http_status_code=200,
        response_headers_ms=1,
        time_to_first_sse_ms=2,
        time_to_first_answer_ms=3,
        terminal_e2e_ms=4,
        event_count=2,
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        config_materialized_item_count=13,
        config_materialized_bytes=53_248,
        config_materialized_sha256="a" * 64,
        config_sha_valid=True,
    )

    assert basic.succeeded
    assert shell.succeeded
    assert config.succeeded
    assert not shell.model_copy(update={"shell_evidence_valid": False}).succeeded
    assert not config.model_copy(update={"config_sha_valid": False}).succeeded
    assert not basic.model_copy(update={"admitted": False}).succeeded
    assert not config.model_copy(update={"config_materialized_item_count": 12}).succeeded


def test_public_sample_schema_has_no_internal_resource_fields() -> None:
    fields = set(StagingPublicRunSample.model_fields)

    assert not fields.intersection(
        {
            "run_id",
            "binding_ref",
            "session_snapshot",
            "redis_commands_per_run",
            "agent_cpu_ms_per_run",
            "e2b_active_seconds",
            "sandbox_id",
            "pod_uid",
        }
    )
