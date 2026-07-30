import httpx
import pytest

from benchmarks.capability_driver import (
    _create_binding,
    build_capability_run_request,
    summarize_capability_outcomes,
    validate_capability_ledger,
)
from benchmarks.scenario import CapabilityBenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger, RunSample


def _capability_scenario(scenario_id: str) -> CapabilityBenchmarkScenario:
    scenario = load_scenario_manifest(profile="capability").get(scenario_id)
    assert isinstance(scenario, CapabilityBenchmarkScenario)
    return scenario


def _layers(request: dict[str, object]) -> list[dict[str, object]]:
    composition = request["composition"]
    assert isinstance(composition, dict)
    layers = composition["layers"]
    assert isinstance(layers, list)
    assert all(isinstance(layer, dict) for layer in layers)
    return layers


def test_capability_requests_use_real_runtime_shell_config_and_drive_layer_types() -> None:
    config = _capability_scenario("capability_config_pull_c1")
    drive = _capability_scenario("capability_drive_pull_c1")

    config_request = build_capability_run_request(
        scenario=config,
        benchmark_run_id="config-run",
        binding_ref="binding:workspace",
        session_snapshot=None,
        suspend=False,
    )
    drive_request = build_capability_run_request(
        scenario=drive,
        benchmark_run_id="drive-run",
        binding_ref="binding:workspace",
        session_snapshot={"layers": {}},
        suspend=True,
    )

    assert [layer["type"] for layer in _layers(config_request)] == [
        "plain.prompt",
        "dify.execution_context",
        "dify.runtime",
        "dify.shell",
        "dify.config",
        "dify.plugin.llm",
    ]
    assert [layer["type"] for layer in _layers(drive_request)] == [
        "plain.prompt",
        "dify.execution_context",
        "dify.runtime",
        "dify.shell",
        "dify.drive",
        "dify.plugin.llm",
    ]
    assert drive_request["session_snapshot"] == {"layers": {}}
    assert drive_request["on_exit"] == {"default": "suspend", "layers": {}}


def test_capability_requests_support_legacy_direct_shell_provider_contract() -> None:
    scenario = _capability_scenario("capability_shell_noop_c1")

    request = build_capability_run_request(
        scenario=scenario,
        benchmark_run_id="legacy-run",
        binding_ref=None,
        session_snapshot=None,
        suspend=False,
    )

    layers = _layers(request)
    assert [layer["type"] for layer in layers] == [
        "plain.prompt",
        "dify.execution_context",
        "dify.shell",
        "dify.plugin.llm",
    ]
    shell = layers[2]
    assert shell["deps"] == {"execution_context": "execution_context"}


@pytest.mark.anyio
async def test_capability_binding_detection_falls_back_on_legacy_agent() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(status_code=404))

    async with httpx.AsyncClient(transport=transport, base_url="http://agent") as client:
        binding_ref, workspace_ref = await _create_binding(client, "legacy-block")

    assert binding_ref is None
    assert workspace_ref is None


def test_capability_ledger_validates_file_roundtrip_control_and_data_plane() -> None:
    scenario = _capability_scenario("capability_file_roundtrip_16m_c1")
    ledger = FakeDependencyLedger(
        profile="capability",
        benchmark_run_id="file-run",
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        model_calls=2,
        tool_calls=1,
        text_chunks=1,
        model_stream_items=2,
        dependency_budget_ms=20,
        model_start_elapsed_ms=[10, 10],
        stub_calls={
            "file_upload_request": 1,
            "signed_upload": 1,
            "file_download_request": 2,
            "signed_download": 1,
        },
        stub_elapsed_ms=[1, 1, 1, 1, 1],
        payload_bytes=scenario.payload_bytes * 2,
        payload_sha256=["upload", "download"],
    )

    assert validate_capability_ledger(ledger=ledger, scenario=scenario)
    ledger.stub_calls["file_download_request"] = 1
    assert not validate_capability_ledger(ledger=ledger, scenario=scenario)


def test_capability_outcomes_expose_useful_payload_throughput() -> None:
    sample = RunSample(
        profile="capability",
        target="candidate",
        scenario_id="capability_file_roundtrip_16m_c1",
        block_id="block",
        pair_index=0,
        benchmark_run_id="run",
        admitted=True,
        terminal_status="succeeded",
        terminal_e2e_ms=50,
        payload_bytes=16 * 1024 * 1024,
        ledger_valid=True,
        event_replay_valid=True,
        cleanup_valid=True,
    )

    outcomes = summarize_capability_outcomes(samples=[sample], elapsed_seconds=4, max_active=1)

    assert outcomes.successful_operations_per_second == 0.25
    assert outcomes.useful_payload_mib_per_second == 4
    assert outcomes.service_time_mean_ms == 50
