import pytest
from pydantic import ValidationError

from core.workflow.file_reference import build_file_reference
from models.agent_config_entities import (
    AgentKnowledgeSpaceConfig,
    AgentSoulConfig,
    AgentSoulKnowledgeConfig,
    AgentSoulModelSettings,
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
    effective_declared_outputs,
)


def test_agent_soul_model_settings_preserves_plugin_declared_parameters() -> None:
    settings = AgentSoulModelSettings.model_validate(
        {
            "temperature": 0.7,
            "enable_thinking": True,
            "thinking_budget": 4096,
        }
    )

    dumped = settings.model_dump(mode="json", exclude_none=True)

    assert dumped["temperature"] == 0.7
    assert dumped["enable_thinking"] is True
    assert dumped["thinking_budget"] == 4096


@pytest.mark.parametrize(
    "response_format",
    [
        "text",
        "json_schema",
        {"type": "text"},
        {"type": "json_schema", "json_schema": {"name": "response", "schema": {"type": "object"}}},
        None,
    ],
)
def test_agent_model_response_format_preserves_plugin_and_legacy_shapes(response_format: object) -> None:
    settings = AgentSoulModelSettings.model_validate({"response_format": response_format})

    assert settings.model_dump(mode="json", exclude_none=True) == (
        {"response_format": response_format} if response_format is not None else {}
    )


@pytest.mark.parametrize("response_format", [[], ["text"], 1, True])
def test_agent_model_response_format_rejects_non_string_or_object_values(response_format: object) -> None:
    with pytest.raises(ValidationError, match="response_format"):
        AgentSoulModelSettings.model_validate({"response_format": response_format})


def test_file_default_value_accepts_canonical_reference_mapping() -> None:
    reference = build_file_reference(record_id="tool-file-1")

    config = DeclaredOutputConfig.model_validate(
        {
            "name": "report",
            "type": "file",
            "failure_strategy": {
                "on_failure": "default_value",
                "default_value": {
                    "transfer_method": "tool_file",
                    "reference": reference,
                },
            },
        }
    )

    assert config.type == DeclaredOutputType.FILE


def test_file_default_value_rejects_legacy_file_id_shape() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "report",
                "type": "file",
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": {
                        "file_id": "legacy-file-id",
                    },
                },
            }
        )


def test_file_default_value_rejects_non_canonical_reference() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "report",
                "type": "file",
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": {
                        "transfer_method": "tool_file",
                        "reference": "raw-tool-file-uuid",
                    },
                },
            }
        )


def test_array_file_default_value_accepts_canonical_mappings() -> None:
    first_reference = build_file_reference(record_id="tool-file-1")
    second_reference = build_file_reference(record_id="tool-file-2")

    config = DeclaredOutputConfig.model_validate(
        {
            "name": "reports",
            "type": "array",
            "array_item": {"type": "file"},
            "failure_strategy": {
                "on_failure": "default_value",
                "default_value": [
                    {"transfer_method": "tool_file", "reference": first_reference},
                    {"transfer_method": "tool_file", "reference": second_reference},
                ],
            },
        }
    )

    assert config.type == DeclaredOutputType.ARRAY


def test_array_file_default_value_rejects_legacy_item_shape() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "reports",
                "type": "array",
                "array_item": {"type": "file"},
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": [{"file_id": "legacy-file-id"}],
                },
            }
        )


def test_declared_array_item_rejects_nested_arrays_and_non_object_children() -> None:
    with pytest.raises(ValueError, match="nested arrays"):
        DeclaredArrayItem(type=DeclaredOutputType.ARRAY)

    with pytest.raises(ValueError, match="array_item.children"):
        DeclaredArrayItem(
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="label", type=DeclaredOutputType.STRING)],
        )


def test_declared_output_child_validates_shape_and_defaults() -> None:
    file_child = DeclaredOutputChildConfig(name="report", type=DeclaredOutputType.FILE)
    assert file_child.file is not None

    array_child = DeclaredOutputChildConfig(name="items", type=DeclaredOutputType.ARRAY)
    assert array_child.array_item is not None
    assert array_child.array_item.type == DeclaredOutputType.OBJECT

    with pytest.raises(ValueError, match="output child name"):
        DeclaredOutputChildConfig(name="bad-name", type=DeclaredOutputType.STRING)

    with pytest.raises(ValueError, match="file metadata"):
        DeclaredOutputChildConfig(name="title", type=DeclaredOutputType.STRING, file={})

    with pytest.raises(ValueError, match="array_item is only allowed"):
        DeclaredOutputChildConfig(
            name="title",
            type=DeclaredOutputType.STRING,
            array_item={"type": DeclaredOutputType.STRING},
        )

    with pytest.raises(ValueError, match="children is only allowed"):
        DeclaredOutputChildConfig(
            name="title",
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="label", type=DeclaredOutputType.STRING)],
        )


def test_declared_output_child_schema_matches_nullable_serialization() -> None:
    config = DeclaredOutputConfig(
        name="response",
        type=DeclaredOutputType.OBJECT,
        children=[DeclaredOutputChildConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    child = config.model_dump(mode="json")["children"][0]

    assert child["file"] is None
    assert child["array_item"] is None

    children_schema = DeclaredOutputConfig.model_json_schema(mode="serialization")["properties"]["children"]
    child_properties = children_schema["items"]["properties"]
    assert {"type": "null"} in child_properties["file"]["anyOf"]
    assert {"type": "null"} in child_properties["array_item"]["anyOf"]


def test_declared_output_validates_shape_and_defaults() -> None:
    file_output = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)
    assert file_output.file is not None

    array_output = DeclaredOutputConfig(name="items", type=DeclaredOutputType.ARRAY)
    assert array_output.array_item is not None
    assert array_output.array_item.type == DeclaredOutputType.OBJECT

    default_failure_strategy = DeclaredOutputConfig.model_validate(
        {"name": "summary", "type": "string", "failure_strategy": None}
    )
    assert default_failure_strategy.failure_strategy.on_failure == "stop"

    with pytest.raises(ValueError, match="output name"):
        DeclaredOutputConfig(name="bad-name", type=DeclaredOutputType.STRING)

    with pytest.raises(ValueError, match="file metadata"):
        DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, file={})

    with pytest.raises(ValueError, match="array_item is only allowed"):
        DeclaredOutputConfig(
            name="summary",
            type=DeclaredOutputType.STRING,
            array_item={"type": DeclaredOutputType.STRING},
        )

    with pytest.raises(ValueError, match="children is only allowed"):
        DeclaredOutputConfig(
            name="summary",
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="title", type=DeclaredOutputType.STRING)],
        )

    with pytest.raises(ValueError, match="output check is only allowed"):
        DeclaredOutputConfig.model_validate(
            {
                "name": "summary",
                "type": "string",
                "check": {
                    "enabled": True,
                    "prompt": "Compare output",
                    "benchmark_file_ref": {"name": "expected.pdf"},
                },
            }
        )


def test_workflow_node_job_reserves_system_output_names() -> None:
    for name in ("text", "switch", "_session"):
        with pytest.raises(ValueError, match=f"declared output name '{name}' is reserved"):
            WorkflowNodeJobConfig.model_validate({"declared_outputs": [{"name": name, "type": "string"}]})

    node_job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {"name": "files", "type": "string"},
                {"name": "json", "type": "string"},
            ]
        }
    )
    assert [output.name for output in node_job.declared_outputs] == ["files", "json"]


def test_effective_declared_outputs_prepends_optional_system_text() -> None:
    custom = DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING)

    effective = effective_declared_outputs([custom])

    assert [output.name for output in effective] == ["text", "summary"]
    assert effective[0].type == DeclaredOutputType.STRING
    assert effective[0].required is False


@pytest.mark.parametrize(
    ("enabled", "count", "expected"),
    [(False, 0, ["text"]), (False, 1, ["text"]), (False, 2, ["text"]), (True, 2, ["text", "switch"])],
)
def test_effective_outputs_follow_route_selection_contract(enabled: bool, count: int, expected: list[str]) -> None:
    job = WorkflowNodeJobConfig.model_validate(
        {
            "output_routes": {
                "enabled": enabled,
                "routes": [{"id": str(index), "name": "condition"} for index in range(count)],
            }
        }
    )
    assert [output.name for output in effective_declared_outputs([], job.output_routes)] == expected


@pytest.mark.parametrize("count", [0, 1])
def test_enabled_output_routes_require_at_least_two_routes(count: int) -> None:
    with pytest.raises(ValueError, match="at least two routes"):
        WorkflowNodeJobConfig.model_validate(
            {"output_routes": {"enabled": True, "routes": [{"id": str(index)} for index in range(count)]}}
        )


@pytest.mark.parametrize("ids", [[""], ["source"], ["fail-branch"], ["target"], ["same", "same"]])
def test_output_routes_reject_invalid_handle_identities(ids: list[str]) -> None:
    with pytest.raises(
        ValueError,
        match=(
            "(?:1 validation error for WorkflowNodeJobConfig\\\noutput_routes|1 "
            "validation error for WorkflowNodeJobConfig\\\noutput_routes\\.routes\\"
            ".0\\.id)"
        ),
    ):
        WorkflowNodeJobConfig.model_validate({"output_routes": {"routes": [{"id": id, "name": ""} for id in ids]}})


"""KnowledgeFS authoring and historical snapshot decoding contracts."""


def binding(**overrides: object) -> dict[str, object]:
    return {
        "id": "product",
        "control_space_id": "ba0b32b1-6c20-493b-96a7-f2d0031f6ba9",
        "name": "产品文档",
        **overrides,
    }


def test_knowledge_fs_round_trip_keeps_identity_and_missing_references() -> None:
    soul = AgentSoulConfig.model_validate({"knowledge": {"spaces": [binding(is_missing=True)]}})
    restored = AgentSoulConfig.model_validate_json(soul.model_dump_json())
    assert restored.knowledge == soul.knowledge
    assert restored.knowledge.spaces[0].is_missing
    assert restored.knowledge.sets == []


@pytest.mark.parametrize("value", ["bad-id", "../space", "00000000-0000-0000-0000-not-a-uuid00"])
def test_invalid_control_space_identifiers_are_rejected(value: str) -> None:
    with pytest.raises(ValidationError):
        AgentKnowledgeSpaceConfig.model_validate(binding(control_space_id=value))


@pytest.mark.parametrize("field", ["id", "name"])
@pytest.mark.parametrize("value", [" ", "line\nbreak", "null\x00byte"])
def test_alias_and_identity_cannot_inject_control_characters(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        AgentKnowledgeSpaceConfig.model_validate(binding(**{field: value}))


@pytest.mark.parametrize(
    ("field", "value"),
    [("id", "PRODUCT"), ("name", "产品文档"), ("control_space_id", "ba0b32b1-6c20-493b-96a7-f2d0031f6ba9")],
)
def test_duplicate_binding_identity_is_rejected(field: str, value: str) -> None:
    second = binding(id="second", name="Policies", control_space_id="a84a7a42-773a-4ce1-8c30-6b932bc7d6d3")
    second[field] = value
    with pytest.raises(ValidationError, match="unique"):
        AgentSoulKnowledgeConfig.model_validate({"spaces": [binding(), second]})


def test_alias_cannot_shadow_another_stable_id() -> None:
    with pytest.raises(ValidationError, match="shadow"):
        AgentSoulKnowledgeConfig.model_validate(
            {
                "spaces": [
                    binding(),
                    binding(
                        id="second",
                        name="PRODUCT",
                        control_space_id="a84a7a42-773a-4ce1-8c30-6b932bc7d6d3",
                    ),
                ]
            }
        )


def test_empty_historical_knowledge_is_still_readable() -> None:
    assert AgentSoulKnowledgeConfig.model_validate({"sets": []}).spaces == []


def test_mixed_legacy_and_knowledge_fs_config_round_trips() -> None:
    config = AgentSoulKnowledgeConfig.model_validate(
        {
            "spaces": [binding()],
            "sets": [
                {
                    "id": "old",
                    "name": "Old",
                    "datasets": [{"id": "old-dataset"}],
                    "query": {"mode": "generated_query"},
                    "retrieval": {"mode": "multiple", "top_k": 5},
                }
            ],
        }
    )

    assert AgentSoulKnowledgeConfig.model_validate_json(config.model_dump_json()) == config


@pytest.mark.parametrize("overrides", [{"id": "PRODUCT"}, {"name": "产品文档"}])
def test_mixed_bindings_cannot_share_identity(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="unique across Agent and Classic"):
        AgentSoulKnowledgeConfig.model_validate(
            {
                "spaces": [binding()],
                "sets": [
                    {
                        "id": "old",
                        "name": "Old",
                        "datasets": [{"id": "old-dataset"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 5},
                        **overrides,
                    }
                ],
            }
        )
