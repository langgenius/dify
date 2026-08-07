from benchmarks.scenario import CapacityScenario, config_file_name, config_skill_name, load_scenario_manifest


def test_manifest_contains_only_the_five_capacity_workloads() -> None:
    manifest = load_scenario_manifest()

    assert [scenario.id for scenario in manifest.scenarios] == [
        "basic",
        "shell",
        "resume",
        "config",
        "file",
    ]
    assert manifest.get("file").payload_bytes == 16 * 1024 * 1024
    assert manifest.get("file").version == 2


def test_scenario_derives_shell_tool_rounds() -> None:
    scenario = load_scenario_manifest().get("shell")

    assert scenario.tool_rounds == 1
    assert scenario.expected_model_stream_items == 2


def test_config_scenario_verifies_materialized_content_with_one_shell_round() -> None:
    scenario = load_scenario_manifest().get("config")

    assert scenario.version == 2
    assert scenario.model_rounds == 2
    assert scenario.tool_rounds == 1
    assert scenario.expected_model_stream_items == 2


def test_config_item_names_are_unique_to_one_run() -> None:
    assert config_skill_name("run-a", 2) == "skill-2-run-a"
    assert config_file_name("run-b", 4) == "file-4-run-b.bin"


def test_basic_rejects_an_extra_model_round() -> None:
    payload = load_scenario_manifest().get("basic").model_dump()
    payload["model_rounds"] = 2

    try:
        CapacityScenario.model_validate(payload)
    except ValueError as exc:
        assert "requires 1 model rounds" in str(exc)
    else:
        raise AssertionError("invalid basic scenario was accepted")
