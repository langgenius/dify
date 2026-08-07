import pytest

from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.plugin.entities.parameters import PluginParameterType, cast_parameter_value


def test_common_parameter_type_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert CommonParameterType.SECRET_INPUT.value == "secret-input"
    assert CommonParameterType.MODEL_SELECTOR.value == "model-selector"
    assert CommonParameterType.DYNAMIC_SELECT.value == "dynamic-select"
    assert CommonParameterType.ARRAY.value == "array"
    assert CommonParameterType.OBJECT.value == "object"
    assert CommonParameterType.DATE.value == "date"
    assert CommonParameterType.DATE_RANGE.value == "date-range"
    with pytest.raises(ValueError):
        PluginParameterType("date-picker")


def test_cast_date_accepts_only_canonical_calendar_dates() -> None:
    assert cast_parameter_value(PluginParameterType.DATE, None) == ""
    assert cast_parameter_value(PluginParameterType.DATE, "") == ""
    assert cast_parameter_value(PluginParameterType.DATE, "2024-02-29") == "2024-02-29"

    for value in ("a", "2024-02-30", "20240229", 20240229):
        with pytest.raises(ValueError):
            cast_parameter_value(PluginParameterType.DATE, value)


def test_cast_date_range_validates_optional_range() -> None:
    assert cast_parameter_value(PluginParameterType.DATE_RANGE, "") == {}
    assert cast_parameter_value(PluginParameterType.DATE_RANGE, {}) == {}
    assert cast_parameter_value(PluginParameterType.DATE_RANGE, "2024-01-01") == {"start": "2024-01-01"}
    assert cast_parameter_value(PluginParameterType.DATE_RANGE, {"end": "2024-01-02"}) == {"end": "2024-01-02"}
    assert cast_parameter_value(
        PluginParameterType.DATE_RANGE,
        '{"start":"2024-01-01","end":"2024-01-02"}',
    ) == {"start": "2024-01-01", "end": "2024-01-02"}

    for value in (
        "a",
        {"start": "a"},
        {"start": "2024-02-30"},
        {"start": 20240101},
        {"start": "2024-01-02", "end": "2024-01-01"},
        '{"start":"2024-01-02","end":"2024-01-01"}',
    ):
        with pytest.raises(ValueError):
            cast_parameter_value(PluginParameterType.DATE_RANGE, value)


def test_selector_scope_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert AppSelectorScope.WORKFLOW.value == "workflow"
    assert ModelSelectorScope.TEXT_EMBEDDING.value == "text-embedding"
    assert ToolSelectorScope.BUILTIN.value == "builtin"
