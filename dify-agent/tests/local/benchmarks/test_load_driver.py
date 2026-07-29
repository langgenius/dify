import pytest

from benchmarks.load_driver import (
    build_create_run_request,
    redis_command_call_deltas,
    summarize_run_outcomes,
    validate_ledger,
)
from benchmarks.scenario import load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger, RedisSnapshot, RunSample


def test_no_tool_request_uses_only_prompt_context_and_model_layers() -> None:
    scenario = load_scenario_manifest().get("single_1_chunk_c1")

    request = build_create_run_request(scenario=scenario, benchmark_run_id="bench-run-1")

    composition = request["composition"]
    assert isinstance(composition, dict)
    layers = composition["layers"]
    assert isinstance(layers, list)
    assert [layer["name"] for layer in layers] == ["prompt", "execution_context", "llm"]
    credentials = layers[-1]["config"]["credentials"]
    assert credentials == {
        "benchmark_run_id": "bench-run-1",
        "scenario_id": "single_1_chunk_c1",
        "scenario_version": 1,
    }


def test_tool_request_exposes_deterministic_tool_contract() -> None:
    scenario = load_scenario_manifest().get("three_tool_rounds_100_chunks_c1")

    request = build_create_run_request(scenario=scenario, benchmark_run_id="bench-run-tools")

    composition = request["composition"]
    assert isinstance(composition, dict)
    layers = composition["layers"]
    assert isinstance(layers, list)
    tool_layer = layers[-1]
    assert tool_layer["name"] == "tools"
    tool = tool_layer["config"]["tools"][0]
    assert tool["tool_name"] == "benchmark_tool"
    assert tool["parameters_json_schema"]["required"] == ["query"]
    assert tool["credentials"]["benchmark_run_id"] == "bench-run-tools"


def test_ledger_validation_checks_all_deterministic_counts() -> None:
    scenario = load_scenario_manifest().get("three_tool_rounds_100_chunks_c1")
    ledger = FakeDependencyLedger(
        benchmark_run_id="bench-run-tools",
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        model_calls=3,
        tool_calls=2,
        text_chunks=100,
        model_stream_items=102,
        tool_response_bytes=2048,
        dependency_budget_ms=139,
        model_start_elapsed_ms=[10, 10, 10],
    )

    assert validate_ledger(ledger=ledger, scenario=scenario) is True
    ledger.model_stream_items = 101
    assert validate_ledger(ledger=ledger, scenario=scenario) is False


def test_redis_command_delta_excludes_harness_introspection() -> None:
    before = RedisSnapshot(command_calls={"set": 2, "xadd": 1, "info": 5, "scan": 0})
    after = RedisSnapshot(command_calls={"set": 6, "xadd": 4, "info": 6, "scan": 1})

    assert redis_command_call_deltas(before, after) == {"set": 4, "xadd": 3}


def test_run_outcomes_distinguish_attempted_admitted_terminal_and_successful() -> None:
    samples = [
        RunSample(
            target="baseline",
            scenario_id="scenario",
            block_id="block",
            pair_index=0,
            benchmark_run_id="success",
            run_id="run-success",
            admitted=True,
            terminal_status="succeeded",
            event_count=5,
        ),
        RunSample(
            target="baseline",
            scenario_id="scenario",
            block_id="block",
            pair_index=0,
            benchmark_run_id="failed",
            run_id="run-failed",
            admitted=True,
            terminal_status="failed",
            failure_kind="terminal_failed",
            event_count=3,
        ),
        RunSample(
            target="baseline",
            scenario_id="scenario",
            block_id="block",
            pair_index=0,
            benchmark_run_id="rejected",
            admitted=False,
            terminal_status="not_terminal",
            failure_kind="admission_error",
        ),
    ]

    outcomes = summarize_run_outcomes(
        samples=samples,
        elapsed_seconds=2,
        max_active_runs=2,
    )

    assert outcomes.attempted_runs == 3
    assert outcomes.admitted_runs == 2
    assert outcomes.terminal_runs == 2
    assert outcomes.successful_runs == 1
    assert outcomes.admission_rate == pytest.approx(2 / 3)
    assert outcomes.terminal_rate == 1
    assert outcomes.success_rate == 0.5
    assert outcomes.terminal_runs_per_second == 1
    assert outcomes.successful_runs_per_second == 0.5
    assert outcomes.events_per_successful_run == 5
    assert outcomes.max_active_runs == 2
