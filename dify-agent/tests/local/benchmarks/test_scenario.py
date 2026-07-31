from benchmarks.scenario import CapacityScenario, load_scenario_manifest


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


def test_scenario_derives_shell_tool_rounds() -> None:
    scenario = load_scenario_manifest().get("shell")

    assert scenario.tool_rounds == 1
    assert scenario.expected_model_stream_items == 2


def test_basic_rejects_an_extra_model_round() -> None:
    payload = load_scenario_manifest().get("basic").model_dump()
    payload["model_rounds"] = 2

    try:
        CapacityScenario.model_validate(payload)
    except ValueError as exc:
        assert "requires 1 model rounds" in str(exc)
    else:
        raise AssertionError("invalid basic scenario was accepted")
