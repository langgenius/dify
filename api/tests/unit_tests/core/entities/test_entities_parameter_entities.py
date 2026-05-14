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
    assert CommonParameterType.DATE_PICKER.value == "date-picker"


def test_cast_date_picker_accepts_optional_range() -> None:
    assert cast_parameter_value(PluginParameterType.DATE_PICKER, "") == {}
    assert cast_parameter_value(PluginParameterType.DATE_PICKER, {}) == {}
    assert cast_parameter_value(
        PluginParameterType.DATE_PICKER,
        '{"start":"2024-01-01","end":"2024-01-02"}',
    ) == {"start": "2024-01-01", "end": "2024-01-02"}
    assert cast_parameter_value(PluginParameterType.DATE_PICKER, {"start": "a"}) == {"start": "a"}


def test_selector_scope_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert AppSelectorScope.WORKFLOW.value == "workflow"
    assert ModelSelectorScope.TEXT_EMBEDDING.value == "text-embedding"
    assert ToolSelectorScope.BUILTIN.value == "builtin"
