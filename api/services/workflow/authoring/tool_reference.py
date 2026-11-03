"""The tool a tool node calls, and its declared defaults stored the way the web stores them.

The web owns the conversion from declaration to stored values (`getConfiguredValue` and `correctInitialData` in
web/app/components/tools/utils/to-form-schema.ts); `WebFormType` copies it.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, fields
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final, Self

from pydantic import ValidationError

from core.plugin.entities.parameters import PluginParameterType
from core.tools.entities.tool_entities import ToolParameter
from core.workflow.workflow_tool_node import reads_tool_inputs
from graphon.nodes.tool.entities import ToolEntity, ToolInputType, ToolNodeData
from services.tools.tool_sources import resolve_tool
from services.workflow.authoring.plugins import (
    NO_DEFAULT,
    DeclarationStatus,
    DeclaredParameter,
    PluginDeclaration,
    PluginReference,
    node_version,
    plugin_reference_for,
)

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

logger = logging.getLogger(__name__)

type _Conversion = Callable[[object], object]

# The numeric prefix JS parseFloat reads; no prefix is NaN, which JSON stores as null.
_JS_FLOAT_PREFIX: Final = re.compile(r"\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")


def _parse_float(text: str) -> float | None:
    """JS parseFloat; None where it gives NaN or an infinity, which the web stores as null."""
    match = _JS_FLOAT_PREFIX.match(text)
    if match is None:
        return None
    number = float(match.group(1))
    if not math.isfinite(number):
        return None
    return number


def _escaped(default: object) -> object:
    """getConfiguredValue's start value: a string default with its newlines escaped, anything else as declared."""
    if isinstance(default, str):
        return default.replace("\n", "\\n")
    return default


def _number(default: object) -> object:
    """correctInitialData for number-input: a non-empty string default is parsed with parseFloat."""
    if not isinstance(default, str):
        return default
    if not default:
        return default
    return _parse_float(default)


def _date(default: object) -> object:
    """correctInitialData for date and date-range: a string stays unescaped, an object becomes its JSON text."""
    if isinstance(default, str):
        return default
    if isinstance(default, dict):
        return json.dumps(default, separators=(",", ":"), ensure_ascii=False)
    return default


def _unchanged(default: object) -> object:
    """correctInitialData for app-selector and model-selector: the declared default, unescaped."""
    return default


class WebFormType(StrEnum):
    """The web's form type of a declared tool parameter type (`toType`), and how it stores a default.

    Every declared parameter type has exactly one form type; `of` raises for a type with no rule.
    """

    parameter_types: tuple[str, ...]
    input_type: ToolInputType
    convert: _Conversion

    def __new__(
        cls,
        value: str,
        parameter_types: tuple[str, ...],
        input_type: ToolInputType = ToolInputType.CONSTANT,
        convert: _Conversion = _escaped,
    ) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.parameter_types = parameter_types
        member.input_type = input_type
        member.convert = convert
        return member

    TEXT_INPUT = ("text-input", (PluginParameterType.STRING,), ToolInputType.MIXED)
    SECRET_INPUT = ("secret-input", (PluginParameterType.SECRET_INPUT,), ToolInputType.MIXED)
    NUMBER_INPUT = ("number-input", (PluginParameterType.NUMBER,), ToolInputType.CONSTANT, _number)
    CHECKBOX = ("checkbox", (PluginParameterType.BOOLEAN, PluginParameterType.CHECKBOX))
    SELECT = ("select", (PluginParameterType.SELECT,))
    DYNAMIC_SELECT = ("dynamic-select", (PluginParameterType.DYNAMIC_SELECT,))
    FILE = ("file", (PluginParameterType.FILE,))
    FILES = ("files", (PluginParameterType.FILES,))
    SYSTEM_FILES = ("system-files", (PluginParameterType.SYSTEM_FILES,))
    APP_SELECTOR = ("app-selector", (PluginParameterType.APP_SELECTOR,), ToolInputType.CONSTANT, _unchanged)
    MODEL_SELECTOR = ("model-selector", (PluginParameterType.MODEL_SELECTOR,), ToolInputType.CONSTANT, _unchanged)
    MULTI_TOOL_SELECTOR = ("array[tools]", (PluginParameterType.TOOLS_SELECTOR,))
    ANY = ("any", (PluginParameterType.ANY,))
    ARRAY = ("array", (PluginParameterType.ARRAY,))
    OBJECT = ("object", (PluginParameterType.OBJECT,))
    DATE = ("date", (PluginParameterType.DATE,), ToolInputType.CONSTANT, _date)
    DATE_RANGE = ("date-range", (PluginParameterType.DATE_RANGE,), ToolInputType.CONSTANT, _date)

    @classmethod
    def of(cls, parameter_type: str) -> Self:
        """The form type of a declared parameter type; raises ValueError for a type no member covers."""
        matches = [member for member in cls if parameter_type in member.parameter_types]
        if not matches:
            raise ValueError(f"no web form type for tool parameter type {parameter_type!r}")
        return matches[0]

    def stored(self, default: object) -> object:
        """The value the web stores for a declared default; None where the web stores null."""
        return self.convert(default)


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
    """The `{type, value}` tool input the web stores for a declared default.

    None when there is no default, when the web would store null, or when the value does not validate as a tool
    input. Raises ValueError only for a parameter type `WebFormType` has no rule for.
    """
    if parameter.default is NO_DEFAULT:
        return None
    form_type = WebFormType.of(parameter.type)
    stored = form_type.stored(parameter.default)
    if stored is None:
        return None
    try:
        tool_input = ToolNodeData.ToolInput.model_validate({"type": form_type.input_type, "value": stored})
    except ValidationError:
        return None
    return tool_input.model_dump(mode="json")


def _store_default(raw: dict[str, Any], parameter: DeclaredParameter) -> None:
    """Add a parameter's stored default to its slot when the slot is a mapping that lacks it; else change nothing."""
    value = _input_value(parameter)
    if value is None:
        return
    values = raw.setdefault(_ToolValueSlot.of(parameter.form).value, {})
    if isinstance(values, dict):
        values.setdefault(parameter.name, value)


@plugin_reference_for(ToolEntity)
@dataclass(frozen=True)
class ToolReference(PluginReference):
    provider_type: str
    provider_id: str
    tool_name: str

    @classmethod
    def extract(cls, raw: Mapping[str, Any]) -> Sequence[Self]:
        """The node's tool when its three identity fields are strings; otherwise none."""
        names = [field.name for field in fields(cls)]
        identity = {name: raw[name] for name in names if isinstance(raw.get(name), str)}
        if len(identity) < len(names):
            return ()
        return (cls(**identity),)

    @property
    def key(self) -> str:
        return f"{self.provider_type}/{self.provider_id}/{self.tool_name}"

    def resolve(self, ctx: FillContext) -> PluginDeclaration:
        """The tool's declaration for the tenant; never raises, a failed lookup is NOT_FOUND."""
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
        """Add each declared default the node lacks, keeping every value already there.

        A node that runs the legacy path reads plain values, not `{type, value}` inputs, so it is left unchanged.
        """
        if not reads_tool_inputs(version=node_version(raw), tool_node_version=raw.get("tool_node_version")):
            return
        for parameter in declaration.parameters:
            _store_default(raw, parameter)
