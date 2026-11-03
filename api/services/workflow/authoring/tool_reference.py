"""The tool a tool node calls, and the declared defaults written in the web's value shapes."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final, Self

from pydantic import ValidationError

from core.tools.entities.tool_entities import ToolParameter
from graphon.nodes.tool.entities import ToolEntity, ToolInputType, ToolNodeData
from services.tools.tool_sources import resolve_tool
from services.workflow.authoring.plugins import (
    NO_DEFAULT,
    DeclarationStatus,
    DeclaredParameter,
    PluginDeclaration,
    PluginReference,
    plugin_reference_for,
)

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

logger = logging.getLogger(__name__)

# The web's getConfiguredValue (tools/utils/to-form-schema.ts) stores text and secret inputs as mixed.
_MIXED_PARAMETER_TYPES: Final = frozenset(
    {ToolParameter.ToolParameterType.STRING, ToolParameter.ToolParameterType.SECRET_INPUT}
)


def tool_input_type(parameter_type: str) -> ToolInputType:
    """The input type the web gives a declared default of this parameter type."""
    if parameter_type in _MIXED_PARAMETER_TYPES:
        return ToolInputType.MIXED
    return ToolInputType.CONSTANT


class _ToolValueSlot(StrEnum):
    """The node field the web stores a parameter's value in: LLM inputs apart from settings."""

    PARAMETERS = "tool_parameters"
    CONFIGURATIONS = "tool_configurations"

    @classmethod
    def of(cls, form: str | None) -> Self:
        if form == ToolParameter.ToolParameterForm.LLM:
            return cls.PARAMETERS
        return cls.CONFIGURATIONS


def _help(parameter: ToolParameter) -> str | None:
    if parameter.human_description is not None:
        return parameter.human_description.en_US
    return parameter.llm_description


def _declared(parameter: ToolParameter) -> DeclaredParameter:
    return DeclaredParameter(
        name=parameter.name,
        form=parameter.form.value,
        type=parameter.type.value,
        required=parameter.required,
        default=NO_DEFAULT if parameter.default is None else parameter.default,
        options=tuple(option.value for option in parameter.options),
        help=_help(parameter),
    )


def _input_value(parameter: DeclaredParameter) -> dict[str, Any] | None:
    """The stored value of a declared default; None when there is none or its input type cannot hold it."""
    if parameter.default is NO_DEFAULT:
        return None
    try:
        tool_input = ToolNodeData.ToolInput.model_validate(
            {"type": tool_input_type(parameter.type), "value": parameter.default}
        )
    except ValidationError:
        return None
    return tool_input.model_dump(mode="json")


@plugin_reference_for(ToolEntity)
@dataclass(frozen=True)
class ToolReference(PluginReference):
    provider_type: str
    provider_id: str
    tool_name: str

    @classmethod
    def extract(cls, raw: Mapping[str, Any]) -> Sequence[Self]:
        names = [field.name for field in fields(cls)]
        identity = {name: raw[name] for name in names if isinstance(raw.get(name), str)}
        if len(identity) < len(names):
            return ()
        return (cls(**identity),)

    @property
    def key(self) -> str:
        return f"{self.provider_type}/{self.provider_id}/{self.tool_name}"

    def resolve(self, ctx: FillContext) -> PluginDeclaration:
        try:
            tool = resolve_tool(
                tenant_id=ctx.tenant_id,
                provider_type=self.provider_type,
                provider_id=self.provider_id,
                tool_name=self.tool_name,
            )
        except Exception:
            logger.warning("tool %s could not be looked up", self.key, exc_info=True)
            return PluginDeclaration(status=DeclarationStatus.NOT_FOUND)
        if tool is None:
            return PluginDeclaration(status=DeclarationStatus.NOT_INSTALLED)
        return PluginDeclaration(
            status=DeclarationStatus.FOUND, parameters=tuple(_declared(p) for p in tool.parameters or ())
        )

    def apply(self, raw: dict[str, Any], declaration: PluginDeclaration) -> None:
        for parameter in declaration.parameters:
            value = _input_value(parameter)
            if value is None:
                continue
            values = raw.setdefault(_ToolValueSlot.of(parameter.form).value, {})
            if isinstance(values, dict):
                values.setdefault(parameter.name, value)
