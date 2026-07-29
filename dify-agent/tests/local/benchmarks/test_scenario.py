from benchmarks.scenario import load_scenario_manifest


def test_checked_in_scenarios_have_expected_dependency_budgets() -> None:
    manifest = load_scenario_manifest()

    single = manifest.get("single_100_chunks_c1")
    tool_loop = manifest.get("three_tool_rounds_100_chunks_c1")

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
