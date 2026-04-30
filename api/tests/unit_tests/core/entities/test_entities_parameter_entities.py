from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)


def test_common_parameter_type_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert CommonParameterType.SECRET_INPUT.value == "secret-input"
    assert CommonParameterType.MODEL_SELECTOR.value == "model-selector"
    assert CommonParameterType.DYNAMIC_SELECT.value == "dynamic-select"
    assert CommonParameterType.ARRAY.value == "array"
    assert CommonParameterType.OBJECT.value == "object"


def test_selector_scope_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert AppSelectorScope.WORKFLOW.value == "workflow"
    assert ModelSelectorScope.TEXT_EMBEDDING.value == "text-embedding"
    assert ToolSelectorScope.BUILTIN.value == "builtin"
