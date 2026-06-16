from __future__ import annotations

import pytest

from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter


def _label(value: str) -> I18nObject:
    return I18nObject(en_US=value, zh_Hans=value)


def _parameter(*, multiple: bool = False, options: list[str] | None = None) -> PluginParameter:
    return PluginParameter(
        name="param",
        label=_label("param"),
        multiple=multiple,
        options=[
            PluginParameterOption(
                value=option,
                label=_label(option),
            )
            for option in options or []
        ],
    )


@pytest.mark.parametrize(
    ("parameter_type", "value"),
    [
        (PluginParameterType.SELECT, ["123"]),
        (PluginParameterType.DYNAMIC_SELECT, ["123"]),
        (PluginParameterType.CHECKBOX, ["123"]),
    ],
)
def test_init_frontend_parameter_preserves_multiple_selection_lists(
    parameter_type: PluginParameterType,
    value: list[str],
):
    parameter = _parameter(multiple=True, options=["123", "456"])

    result = init_frontend_parameter(parameter, parameter_type, value)

    assert result == value


def test_tool_parameter_init_frontend_parameter_preserves_multiple_select_list():
    parameter = ToolParameter(
        name="param",
        label=_label("param"),
        type=ToolParameter.ToolParameterType.SELECT,
        form=ToolParameter.ToolParameterForm.FORM,
        multiple=True,
        options=[
            PluginParameterOption(
                value="123",
                label=_label("123"),
            )
        ],
    )

    result = parameter.init_frontend_parameter(["123"])

    assert result == ["123"]


def test_init_frontend_parameter_rejects_invalid_multiple_select_option():
    parameter = _parameter(multiple=True, options=["123"])

    with pytest.raises(ValueError, match="not in options"):
        init_frontend_parameter(parameter, PluginParameterType.SELECT, ["456"])


def test_init_frontend_parameter_preserves_object_dict():
    parameter = _parameter()
    value = {"start": "2026-06-16", "end": "2026-06-17"}

    result = init_frontend_parameter(parameter, PluginParameterType.OBJECT, value)

    assert result == value
