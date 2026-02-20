from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from core.workflow.nodes.tool.entities import ToolEntity, ToolNodeData

# ==========================================================
# Fixtures
# ==========================================================


@pytest.fixture
def valid_tool_entity_payload():
    return {
        "provider_id": "provider-1",
        "provider_type": "plugin",  # VALID enum value
        "provider_name": "ProviderName",
        "tool_name": "tool_1",
        "tool_label": "Tool Label",
        "tool_configurations": {"key1": "value1", "key2": 123},
        "credential_id": "cred-1",
        "plugin_unique_identifier": "plugin-1",
    }


@pytest.fixture
def base_node_required_fields():
    return {
        "title": "Tool Node Title",  # required by BaseNodeData
    }


@pytest.fixture
def valid_tool_input_constant():
    return {"value": "constant_value", "type": "constant"}


@pytest.fixture
def valid_tool_input_variable():
    return {"value": ["var1", "var2"], "type": "variable"}


@pytest.fixture
def valid_tool_input_mixed():
    return {"value": "mixed_value", "type": "mixed"}


@pytest.fixture
def valid_tool_node_payload(valid_tool_entity_payload, base_node_required_fields):
    payload = {}
    payload.update(valid_tool_entity_payload)
    payload.update(base_node_required_fields)
    payload.update(
        {
            "tool_parameters": {"param1": {"value": "constant_value", "type": "constant"}},
            "tool_node_version": "v1",
        }
    )
    return payload


# ==========================================================
# ToolEntity Tests
# ==========================================================


def test_tool_entity_valid(valid_tool_entity_payload):
    entity = ToolEntity(**valid_tool_entity_payload)

    assert entity.provider_type == "plugin"
    assert entity.tool_configurations["key1"] == "value1"


def test_tool_entity_tool_configurations_not_dict(valid_tool_entity_payload):
    payload = valid_tool_entity_payload.copy()
    payload["tool_configurations"] = "invalid"

    with pytest.raises(ValidationError):
        ToolEntity(**payload)


@pytest.mark.parametrize("invalid_value", [None, [], {}, object()])
def test_tool_entity_tool_configurations_invalid_inner_values_not_validated(valid_tool_entity_payload, invalid_value):
    """
    Due to implementation bug in validator (mode='before'),
    inner values are not validated.
    This test ensures current behavior is covered.
    """
    payload = valid_tool_entity_payload.copy()
    payload["tool_configurations"] = {"key": invalid_value}

    # Should NOT raise (current implementation behavior)
    entity = ToolEntity(**payload)

    assert entity.tool_configurations["key"] == invalid_value


def test_tool_entity_optional_fields_none(valid_tool_entity_payload):
    payload = valid_tool_entity_payload.copy()
    payload["credential_id"] = None
    payload["plugin_unique_identifier"] = None

    entity = ToolEntity(**payload)

    assert entity.credential_id is None
    assert entity.plugin_unique_identifier is None


@pytest.mark.parametrize("invalid_enum", ["invalid", 123, None])
def test_tool_entity_invalid_provider_type(valid_tool_entity_payload, invalid_enum):
    payload = valid_tool_entity_payload.copy()
    payload["provider_type"] = invalid_enum

    with pytest.raises(ValidationError):
        ToolEntity(**payload)


# ==========================================================
# ToolInput Tests
# ==========================================================


def test_tool_input_constant_valid(valid_tool_input_constant):
    obj = ToolNodeData.ToolInput(**valid_tool_input_constant)
    assert obj.type == "constant"


@pytest.mark.parametrize("invalid", [set(), (), object()])
def test_tool_input_constant_invalid(invalid):
    with pytest.raises(ValidationError):
        ToolNodeData.ToolInput(value=invalid, type="constant")


def test_tool_input_variable_valid(valid_tool_input_variable):
    obj = ToolNodeData.ToolInput(**valid_tool_input_variable)
    assert obj.value == ["var1", "var2"]


@pytest.mark.parametrize(
    "invalid_value",
    [
        "not_list",
        [1, 2],
        [None],
    ],
)
def test_tool_input_variable_invalid(invalid_value):
    with pytest.raises(ValidationError):
        ToolNodeData.ToolInput(value=invalid_value, type="variable")


def test_tool_input_mixed_valid(valid_tool_input_mixed):
    obj = ToolNodeData.ToolInput(**valid_tool_input_mixed)
    assert obj.value == "mixed_value"


def test_tool_input_mixed_invalid():
    with pytest.raises(ValidationError):
        ToolNodeData.ToolInput(value=123, type="mixed")


def test_tool_input_none_value_allowed():
    obj = ToolNodeData.ToolInput(value=None, type="constant")
    assert obj.value is None


# ==========================================================
# ToolNodeData Tests
# ==========================================================


def test_tool_node_data_valid(valid_tool_node_payload):
    node = ToolNodeData(**valid_tool_node_payload)

    assert "param1" in node.tool_parameters
    assert node.tool_node_version == "v1"


def test_tool_node_data_filter_none_tool_inputs(valid_tool_entity_payload, base_node_required_fields):
    payload = {}
    payload.update(valid_tool_entity_payload)
    payload.update(base_node_required_fields)
    payload["tool_parameters"] = {
        "valid": {"value": "abc", "type": "constant"},
        "none_param": None,
        "null_value": {"value": None, "type": "constant"},
    }

    node = ToolNodeData(**payload)

    assert "valid" in node.tool_parameters
    assert "none_param" not in node.tool_parameters
    assert "null_value" not in node.tool_parameters


@pytest.mark.parametrize(
    ("tool_input", "expected"),
    [
        ({"value": "abc"}, True),
        ({"value": None}, False),
        (MagicMock(value="abc"), True),
        (MagicMock(value=None), False),
    ],
)
def test_has_valid_value(tool_input, expected):
    assert ToolNodeData._has_valid_value(tool_input) is expected


def test_tool_node_data_invalid_tool_parameters_type(valid_tool_entity_payload, base_node_required_fields):
    payload = {}
    payload.update(valid_tool_entity_payload)
    payload.update(base_node_required_fields)
    payload["tool_parameters"] = "not_dict"

    with pytest.raises(ValidationError):
        ToolNodeData(**payload)


def test_tool_node_version_none(valid_tool_node_payload):
    payload = valid_tool_node_payload.copy()
    payload["tool_node_version"] = None

    node = ToolNodeData(**payload)

    assert node.tool_node_version is None
