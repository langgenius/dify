from __future__ import annotations

import json
import math
from copy import deepcopy

import pytest
from pydantic import ValidationError

from core.tools.entities.ui_entities import (
    A2UI_CATALOG_ID,
    DIFY_UI_JSON_ENVELOPE_KEY,
    MAX_UI_PARTS_PAYLOAD_BYTES,
    MAX_UI_PARTS_PER_MESSAGE,
    A2UIComponent,
    MessageUIPart,
    ToolUIMessage,
    build_ui_part_id,
    extract_ui_message_from_json,
    parse_history_ui_parts,
    parse_tool_ui_messages,
    validate_tool_ui_message_batch,
    validate_ui_part_batch,
)


def _valid_ui_message() -> dict:
    return {
        "protocol": "a2ui",
        "protocol_version": "v0.9.1",
        "messages": [
            {
                "version": "v0.9.1",
                "createSurface": {
                    "surfaceId": "weather",
                    "catalogId": A2UI_CATALOG_ID,
                },
            },
            {
                "version": "v0.9.1",
                "updateDataModel": {
                    "surfaceId": "weather",
                    "value": {"temperature": 23},
                },
            },
            {
                "version": "v0.9.1",
                "updateComponents": {
                    "surfaceId": "weather",
                    "components": [
                        {
                            "id": "root",
                            "component": "Card",
                            "title": "Shanghai",
                            "children": ["temperature"],
                        },
                        {
                            "id": "temperature",
                            "component": "Metric",
                            "label": "Temperature",
                            "value": {"path": "/temperature"},
                            "unit": "°C",
                        },
                    ],
                },
            },
        ],
        "fallback": "Shanghai: 23°C",
    }


def _ui_message(surface_id: str, *, large: bool = False) -> ToolUIMessage:
    value = deepcopy(_valid_ui_message())
    for message in value["messages"]:
        operation = message.get("createSurface") or message.get("updateDataModel") or message.get("updateComponents")
        operation["surfaceId"] = surface_id
    if large:
        value["messages"][1]["updateDataModel"]["value"] = ["x" * 4096] * 20
    return ToolUIMessage.model_validate(value)


def _ui_part(index: int, *, large: bool = False, sequence: int = 1) -> MessageUIPart:
    ui_message = _ui_message(f"surface-{index}", large=large)
    return MessageUIPart.from_tool_ui_message(
        part_id=f"call-{index}:{ui_message.surface_id}",
        sequence=sequence,
        ui_message=ui_message,
    )


def test_tool_ui_message_accepts_fixed_catalog_surface() -> None:
    ui_message = ToolUIMessage.model_validate(_valid_ui_message())

    assert ui_message.surface_id == "weather"
    assert ui_message.messages[-1].update_components is not None
    part = MessageUIPart.from_tool_ui_message(
        part_id="call-1:weather",
        sequence=1,
        ui_message=ui_message,
    )
    assert part.part_id == "call-1:weather"
    assert part.messages[0].create_surface.catalog_id == A2UI_CATALOG_ID  # type: ignore[union-attr]


def test_tool_ui_message_rejects_custom_component_props() -> None:
    invalid = _valid_ui_message()
    invalid["messages"][-1]["updateComponents"]["components"][1]["className"] = "custom"

    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(invalid)


def test_tool_ui_message_rejects_image_and_omits_it_from_the_catalog_schema() -> None:
    invalid = _valid_ui_message()
    invalid["messages"][-1]["updateComponents"]["components"] = [
        {
            "id": "root",
            "component": "Image",
            "src": "https://attacker.example/tracker.png",
            "alt": "tracker",
        }
    ]

    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(invalid)

    schema = A2UIComponent.model_json_schema()
    assert "Image" not in json.dumps(schema)
    assert "src" not in schema["properties"]
    assert "alt" not in schema["properties"]


def test_data_model_allows_non_executable_arbitrary_keys() -> None:
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["value"] = {
        "action": "forecast",
        "theme": "weather",
        "style": "windy",
    }

    ui_message = ToolUIMessage.model_validate(value)

    assert ui_message.messages[1].update_data_model is not None
    assert ui_message.messages[1].update_data_model.value["action"] == "forecast"


@pytest.mark.parametrize("unsafe_key", ["__proto__", "constructor", "prototype"])
def test_data_model_rejects_prototype_pollution_keys(unsafe_key: str) -> None:
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["value"] = {"safe": {unsafe_key: "polluted"}}

    with pytest.raises(ValidationError, match="forbidden keys"):
        ToolUIMessage.model_validate(value)


def test_data_model_rejects_excessive_depth_and_nodes() -> None:
    too_deep: object = "leaf"
    for _ in range(17):
        too_deep = {"nested": too_deep}
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["value"] = too_deep
    with pytest.raises(ValidationError, match="nested too deeply"):
        ToolUIMessage.model_validate(value)

    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["value"] = list(range(2000))
    with pytest.raises(ValidationError, match="too many nodes"):
        ToolUIMessage.model_validate(value)


def test_data_model_rejects_cumulative_depth_from_pointer_patches() -> None:
    value = _valid_ui_message()
    value["messages"][1] = {
        "version": "v0.9.1",
        "updateDataModel": {
            "surfaceId": "weather",
            "path": "/" + "/".join(f"level-{index}" for index in range(16)),
            "value": {"leaf": "too deep after materialization"},
        },
    }

    with pytest.raises(ValidationError, match="nested too deeply"):
        ToolUIMessage.model_validate(value)


def test_data_model_rejects_cumulative_nodes_from_object_patches() -> None:
    value = _valid_ui_message()
    value["messages"][1:1] = [
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "value": {"left": list(range(999))},
            },
        },
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "path": "/right",
                "value": list(range(999)),
            },
        },
    ]
    value["messages"].pop(3)

    with pytest.raises(ValidationError, match="too many nodes"):
        ToolUIMessage.model_validate(value)


def test_data_model_materializes_root_replacements_and_array_patches() -> None:
    value = _valid_ui_message()
    value["messages"][1:2] = [
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "value": {"discarded": list(range(1500))},
            },
        },
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "path": "/",
                "value": {"days": []},
            },
        },
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "path": "/days/0",
                "value": {"temperature": 23},
            },
        },
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "path": "/days/1",
                "value": {"temperature": 24},
            },
        },
    ]

    ui_message = ToolUIMessage.model_validate(value)

    assert len(ui_message.messages) == 6


def test_data_model_rejects_array_patch_gaps() -> None:
    value = _valid_ui_message()
    value["messages"][1:2] = [
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "value": {"days": []},
            },
        },
        {
            "version": "v0.9.1",
            "updateDataModel": {
                "surfaceId": "weather",
                "path": "/days/2",
                "value": {"temperature": 23},
            },
        },
    ]

    with pytest.raises(ValidationError, match="array index"):
        ToolUIMessage.model_validate(value)


@pytest.mark.parametrize(
    ("component", "props"),
    [
        ("Metric", {"label": "Temperature", "value": math.inf}),
        ("KeyValue", {"label": "Humidity", "value": math.nan}),
        ("Progress", {"label": "Loading", "value": -math.inf}),
    ],
)
def test_components_reject_non_finite_numbers(component: str, props: dict[str, object]) -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"] = [{"id": "root", "component": component, **props}]

    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(value)


@pytest.mark.parametrize("number", [math.inf, -math.inf, math.nan])
def test_data_model_rejects_non_finite_numbers(number: float) -> None:
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["value"] = {"number": number}

    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(value)


def test_progress_requires_an_accessible_label() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"] = [{"id": "root", "component": "Progress", "value": 50}]

    with pytest.raises(ValidationError, match="requires properties.*label"):
        ToolUIMessage.model_validate(value)


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (
            lambda value: value["messages"].pop(0),
            "first A2UI message must be createSurface",
        ),
        (
            lambda value: value["messages"][-1]["updateComponents"]["components"].pop(0),
            "component with id 'root'",
        ),
        (
            lambda value: value["messages"][-1]["updateComponents"]["components"][0].update({"children": ["missing"]}),
            "unknown child",
        ),
    ],
)
def test_tool_ui_message_rejects_invalid_surface_graph(mutate, expected: str) -> None:
    invalid = _valid_ui_message()
    mutate(invalid)

    with pytest.raises(ValidationError, match=expected):
        ToolUIMessage.model_validate(invalid)


def test_tool_ui_message_rejects_component_cycle() -> None:
    invalid = _valid_ui_message()
    invalid["messages"][-1]["updateComponents"]["components"][1] = {
        "id": "temperature",
        "component": "Column",
        "children": ["root"],
    }

    with pytest.raises(ValidationError, match="cycle"):
        ToolUIMessage.model_validate(invalid)


def test_tool_ui_message_accepts_rooted_component_tree() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"] = [
        {"id": "root", "component": "Column", "children": ["summary", "details"]},
        {"id": "summary", "component": "Row", "children": ["temperature", "condition"]},
        {
            "id": "temperature",
            "component": "Metric",
            "label": "Temperature",
            "value": 23,
            "unit": "°C",
        },
        {"id": "condition", "component": "Badge", "text": "Sunny"},
        {"id": "details", "component": "Text", "text": "Light wind"},
    ]

    ui_message = ToolUIMessage.model_validate(value)

    assert ui_message.messages[-1].update_components is not None
    assert len(ui_message.messages[-1].update_components.components) == 5


def test_tool_ui_message_rejects_duplicate_children() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"][0]["children"] = [
        "temperature",
        "temperature",
    ]

    with pytest.raises(ValidationError, match="duplicate ids"):
        ToolUIMessage.model_validate(value)


def test_tool_ui_message_rejects_root_as_child() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"].append(
        {"id": "orphan", "component": "Column", "children": ["root"]}
    )

    with pytest.raises(ValidationError, match="root component cannot be referenced"):
        ToolUIMessage.model_validate(value)


def test_tool_ui_message_rejects_component_with_multiple_parents() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"] = [
        {"id": "root", "component": "Row", "children": ["left", "right"]},
        {"id": "left", "component": "Column", "children": ["shared"]},
        {"id": "right", "component": "Column", "children": ["shared"]},
        {"id": "shared", "component": "Text", "text": "Shared"},
    ]

    with pytest.raises(ValidationError, match="multiple parents"):
        ToolUIMessage.model_validate(value)


def test_tool_ui_message_rejects_unreachable_component() -> None:
    value = _valid_ui_message()
    value["messages"][-1]["updateComponents"]["components"].append(
        {"id": "orphan", "component": "Text", "text": "Not reachable"}
    )

    with pytest.raises(ValidationError, match="unreachable from root"):
        ToolUIMessage.model_validate(value)


@pytest.mark.parametrize(
    "path",
    [
        "/weather/~2value",
        "/weather/__proto__/polluted",
        "/constructor/value",
    ],
)
def test_tool_ui_message_rejects_unsafe_json_pointers(path: str) -> None:
    invalid_binding = _valid_ui_message()
    invalid_binding["messages"][-1]["updateComponents"]["components"][1]["value"] = {"path": path}
    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(invalid_binding)

    invalid_update = _valid_ui_message()
    invalid_update["messages"][1]["updateDataModel"]["path"] = path
    with pytest.raises(ValidationError):
        ToolUIMessage.model_validate(invalid_update)


def test_data_model_update_path_rejects_large_array_index() -> None:
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["path"] = "/items/1001"

    with pytest.raises(ValidationError, match="array index"):
        ToolUIMessage.model_validate(value)


def test_json_pointer_rejects_more_than_sixteen_segments() -> None:
    value = _valid_ui_message()
    value["messages"][1]["updateDataModel"]["path"] = "/" + "/".join(f"level-{index}" for index in range(17))

    with pytest.raises(ValidationError, match="too many segments"):
        ToolUIMessage.model_validate(value)


def test_extract_ui_message_from_legacy_json_envelope() -> None:
    parsed = extract_ui_message_from_json({DIFY_UI_JSON_ENVELOPE_KEY: _valid_ui_message()})

    assert parsed is not None
    assert parsed.surface_id == "weather"
    assert extract_ui_message_from_json({"normal": "json"}) is None


def test_tool_ui_batch_enforces_count_and_payload_limits() -> None:
    validate_tool_ui_message_batch([_ui_message(f"surface-{index}") for index in range(16)])

    with pytest.raises(ValueError, match="more than"):
        validate_tool_ui_message_batch([_ui_message(f"surface-{index}") for index in range(17)])

    large_messages = [_ui_message(f"large-{index}", large=True) for index in range(7)]
    with pytest.raises(ValueError, match=str(MAX_UI_PARTS_PAYLOAD_BYTES)):
        validate_tool_ui_message_batch(large_messages)


def test_parse_tool_ui_messages_rejects_count_before_parsing_items() -> None:
    with pytest.raises(ValueError, match="more than"):
        parse_tool_ui_messages([object() for _ in range(MAX_UI_PARTS_PER_MESSAGE + 1)])


def test_ui_part_id_is_stable_unambiguous_and_bounded() -> None:
    first = build_ui_part_id("call:a", "b")
    second = build_ui_part_id("call", "a:b")

    assert first == build_ui_part_id("call:a", "b")
    assert first != second
    assert len(build_ui_part_id("x" * 10_000, "weather")) <= 512
    assert len(build_ui_part_id("\ud800", "weather")) <= 512


def test_history_ui_parts_ignore_invalid_stale_and_over_budget_items() -> None:
    first = _ui_part(0)
    newer = first.model_copy(update={"sequence": 2})
    raw_parts = [
        first.model_dump(mode="json"),
        {"part_id": "invalid"},
        newer.model_dump(mode="json"),
        *[_ui_part(index).model_dump(mode="json") for index in range(1, 18)],
    ]

    parts = parse_history_ui_parts(raw_parts)

    assert len(parts) == MAX_UI_PARTS_PER_MESSAGE
    assert parts[0].sequence == 2
    validate_ui_part_batch(parts)

    large_parts = parse_history_ui_parts([_ui_part(index, large=True).model_dump(mode="json") for index in range(7)])
    assert len(large_parts) < 7
    validate_ui_part_batch(large_parts)
