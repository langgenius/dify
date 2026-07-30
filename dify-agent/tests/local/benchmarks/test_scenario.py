from benchmarks.scenario import (
    AgentBenchmarkScenario,
    CapabilityBenchmarkScenario,
    RuntimeBenchmarkScenario,
    load_scenario_manifest,
)


def test_checked_in_scenarios_have_expected_dependency_budgets() -> None:
    manifest = load_scenario_manifest()

    single = manifest.get("single_100_chunks_c1")
    tool_loop = manifest.get("three_tool_rounds_100_chunks_c1")
    assert isinstance(single, AgentBenchmarkScenario)
    assert isinstance(tool_loop, AgentBenchmarkScenario)

    assert single.dependency_budget_ms == 109
    assert single.expected_model_stream_items == 100
    assert tool_loop.tool_rounds == 2
    assert tool_loop.dependency_budget_ms == 139
    assert tool_loop.expected_model_stream_items == 102


def test_manifest_contains_only_stable_unique_scenario_ids() -> None:
    manifest = load_scenario_manifest()

    assert manifest.schema_version == 1
    assert [scenario.id for scenario in manifest.scenarios] == [
        "single_1_chunk_c1",
        "single_100_chunks_c1",
        "three_tool_rounds_100_chunks_c1",
        "three_tool_rounds_100_chunks_c10",
        "single_1000_chunks_c1",
    ]
    assert all(isinstance(scenario, AgentBenchmarkScenario) for scenario in manifest.scenarios)


def test_runtime_manifest_uses_runtime_specific_schema() -> None:
    manifest = load_scenario_manifest(profile="runtime")

    assert [scenario.id for scenario in manifest.scenarios] == [
        "runtime_noop_c1",
        "runtime_output_1m_c1",
        "runtime_1000_files_4k_c1",
        "runtime_file_16m_c1",
        "runtime_noop_c10",
    ]
    assert all(isinstance(scenario, RuntimeBenchmarkScenario) for scenario in manifest.scenarios)
    file_scenario = manifest.get("runtime_file_16m_c1")
    assert isinstance(file_scenario, RuntimeBenchmarkScenario)
    assert file_scenario.payload_bytes == 16 * 1024 * 1024


def test_capability_manifest_uses_capability_specific_schema() -> None:
    manifest = load_scenario_manifest(profile="capability")

    assert [scenario.id for scenario in manifest.scenarios] == [
        "capability_shell_noop_c1",
        "capability_shell_resume_c1",
        "capability_config_pull_c1",
        "capability_drive_pull_c1",
        "capability_file_roundtrip_16m_c1",
        "capability_shell_noop_c10",
    ]
    assert all(isinstance(scenario, CapabilityBenchmarkScenario) for scenario in manifest.scenarios)
    file_scenario = manifest.get("capability_file_roundtrip_16m_c1")
    assert isinstance(file_scenario, CapabilityBenchmarkScenario)
    assert file_scenario.payload_bytes == 16 * 1024 * 1024
