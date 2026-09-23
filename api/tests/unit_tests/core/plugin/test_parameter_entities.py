from __future__ import annotations

from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterType,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter


def _label(value: str) -> I18nObject:
    return I18nObject(en_US=value, zh_Hans=value)


def _parameter() -> PluginParameter:
    return PluginParameter(name="param", label=_label("param"))


def test_tool_parameter_init_frontend_parameter_preserves_multiple_tree_selection() -> None:
    parameter = ToolParameter(
        name="param",
        label=_label("param"),
        type=ToolParameter.ToolParameterType.DYNAMIC_TREE_SELECT,
        form=ToolParameter.ToolParameterForm.FORM,
        multiple=True,
    )

    result = parameter.init_frontend_parameter(["123"])

    assert result == ["123"]


def test_init_frontend_parameter_preserves_object_dict() -> None:
    parameter = _parameter()
    value = {"start": "2026-06-16", "end": "2026-06-17"}

    result = init_frontend_parameter(parameter, PluginParameterType.OBJECT, value)

    assert result == value
