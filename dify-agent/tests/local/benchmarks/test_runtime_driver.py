import asyncio

import httpx

from benchmarks.runtime_driver import (
    _START_MARKER,
    _collect_job_output,
    _expected_file_hash,
    _script_for,
    _validate_output,
    summarize_runtime_outcomes,
)
from benchmarks.scenario import RuntimeBenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import RunSample


def _runtime_scenario(scenario_id: str) -> RuntimeBenchmarkScenario:
    scenario = load_scenario_manifest(profile="runtime").get(scenario_id)
    assert isinstance(scenario, RuntimeBenchmarkScenario)
    return scenario


def test_runtime_scripts_use_unique_workspace_and_validate_deterministic_results() -> None:
    noop = _runtime_scenario("runtime_noop_c1")
    many_files = _runtime_scenario("runtime_1000_files_4k_c1")
    file_scenario = _runtime_scenario("runtime_file_16m_c1")

    assert _validate_output(noop, f"{_START_MARKER}\r\n{{\"ok\":true}}\r\n")
    many_files_output = (
        f"{_START_MARKER}\n"
        f'{{"payload_bytes":{many_files.payload_bytes},"sha256":"{_expected_file_hash(many_files)}"}}\n'
    )
    file_output = (
        f"{_START_MARKER}\n"
        f'{{"payload_bytes":{file_scenario.payload_bytes},"sha256":"{_expected_file_hash(file_scenario)}"}}\n'
    )
    assert _validate_output(many_files, many_files_output)
    assert _validate_output(file_scenario, file_output)
    assert "/state/bench-workspaces/operation-1" in _script_for(many_files, "operation-1")
    assert "shutil.rmtree(root)" in _script_for(file_scenario, "operation-2")


def test_runtime_output_collection_continues_after_terminal_truncated_window() -> None:
    async def scenario() -> None:
        requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal requests
            requests += 1
            assert request.url.path == "/v1/jobs/job-1/wait"
            return httpx.Response(
                200,
                json={
                    "job_id": "job-1",
                    "done": True,
                    "status": "succeeded",
                    "exit_code": 0,
                    "output": "second",
                    "offset": 11,
                    "truncated": False,
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://runtime") as client:
            output, first_output_ns, result = await _collect_job_output(
                client=client,
                initial={
                    "job_id": "job-1",
                    "done": True,
                    "status": "succeeded",
                    "exit_code": 0,
                    "output": f"{_START_MARKER}\nfirst",
                    "offset": 5,
                    "truncated": True,
                },
                output="",
                started_ns=0,
                first_output_ns=None,
            )

        assert requests == 1
        assert output.endswith("firstsecond")
        assert first_output_ns is not None
        assert result["truncated"] is False

    asyncio.run(scenario())


def test_runtime_outcomes_normalize_success_and_payload() -> None:
    sample = RunSample(
        profile="runtime",
        target="baseline",
        scenario_id="runtime_file_16m_c1",
        block_id="block",
        pair_index=0,
        benchmark_run_id="operation",
        admitted=True,
        terminal_status="succeeded",
        terminal_e2e_ms=20,
        payload_bytes=16 * 1024 * 1024,
        exit_code=0,
        ledger_valid=True,
        event_replay_valid=True,
        cleanup_valid=True,
    )

    outcomes = summarize_runtime_outcomes(samples=[sample], elapsed_seconds=2, max_active=1)

    assert outcomes.success_rate == 1
    assert outcomes.successful_operations_per_second == 0.5
    assert outcomes.useful_payload_mib_per_second == 8
    assert outcomes.service_time_mean_ms == 20
