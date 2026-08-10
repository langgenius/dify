"""Compile Human Input v2 authoring values into an authoritative resolved form."""

from __future__ import annotations

from collections.abc import Mapping
from typing import assert_never

from constants import DEFAULT_FILE_NUMBER_LIMITS
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.workflow.nodes.human_input.entities import (
    OUTPUT_VARIABLE_PATTERN,
    FileInputConfig,
    FileListInputConfig,
    FormInputConfig,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
)
from core.workflow.nodes.human_input.enums import ValueSourceType
from graphon.runtime import VariablePool
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.segments import Segment

from .entities import HumanInputNodeData


class MissingResolvedInputError(ValueError):
    """An output slot has no corresponding authoring input configuration."""


def compile_resolved_form(
    node_data: HumanInputNodeData,
    variable_pool: ReadOnlyVariablePool,
    *,
    resolved_default_values: Mapping[str, object] | None = None,
) -> ResolvedForm:
    """Resolve workflow-owned presentation data exactly once at form creation."""

    legacy_form_content = _resolve_legacy_form_content(node_data.form_content, variable_pool)
    inputs_by_name = {input_config.output_variable_name: input_config for input_config in node_data.inputs}
    default_values = resolved_default_values or {}
    blocks: list[ResolvedFormContent] = []
    cursor = 0
    for match in OUTPUT_VARIABLE_PATTERN.finditer(legacy_form_content):
        fragment = legacy_form_content[cursor : match.start()]
        if fragment != "":
            blocks.append(MarkdownText(fragment))
        output_variable_name = match.group("field_name")
        input_config = inputs_by_name.get(output_variable_name)
        if input_config is None:
            raise MissingResolvedInputError(f"resolved form input is missing for output slot '{output_variable_name}'")
        blocks.append(
            _resolve_input(
                input_config,
                variable_pool=variable_pool,
                resolved_default=default_values.get(output_variable_name),
            )
        )
        cursor = match.end()
    trailing_fragment = legacy_form_content[cursor:]
    if trailing_fragment != "":
        blocks.append(MarkdownText(trailing_fragment))

    return ResolvedForm(
        title=node_data.title or None,
        blocks=tuple(blocks),
        user_actions=tuple(
            ResolvedFormAction(
                id=action.id,
                title=action.title,
                button_style=action.button_style,
            )
            for action in node_data.user_actions
        ),
        legacy_form_content=legacy_form_content,
    )


def _resolve_legacy_form_content(form_content: str, variable_pool: ReadOnlyVariablePool) -> str:
    if not isinstance(variable_pool, VariablePool):
        raise TypeError("resolved form compilation requires graphon.runtime.VariablePool for template expansion")
    return variable_pool.convert_template(form_content).markdown


def _resolve_input(
    input_config: FormInputConfig,
    *,
    variable_pool: ReadOnlyVariablePool,
    resolved_default: object,
) -> ParagraphInput | SelectInput | FileInput | FileListInput:
    match input_config:
        case ParagraphInputConfig():
            default_value = _resolve_paragraph_default(input_config.default, variable_pool)
            if default_value is None and resolved_default is not None:
                default_value = _resolved_text(resolved_default, field_name=input_config.output_variable_name)
            return ParagraphInput(input_config.output_variable_name, default_value)
        case SelectInputConfig():
            options = _resolve_select_options(input_config.option_source, variable_pool)
            default_value = (
                _resolved_text(resolved_default, field_name=input_config.output_variable_name)
                if resolved_default is not None
                else None
            )
            return SelectInput(input_config.output_variable_name, options, default_value)
        case FileInputConfig():
            return FileInput(
                output_variable_name=input_config.output_variable_name,
                allowed_file_types=tuple(input_config.allowed_file_types),
                allowed_file_extensions=tuple(input_config.allowed_file_extensions),
                allowed_file_upload_methods=tuple(input_config.allowed_file_upload_methods),
            )
        case FileListInputConfig():
            return FileListInput(
                output_variable_name=input_config.output_variable_name,
                allowed_file_types=tuple(input_config.allowed_file_types),
                allowed_file_extensions=tuple(input_config.allowed_file_extensions),
                allowed_file_upload_methods=tuple(input_config.allowed_file_upload_methods),
                number_limits=input_config.number_limits or DEFAULT_FILE_NUMBER_LIMITS,
            )
        case _:
            assert_never(input_config)


def _resolve_paragraph_default(source: StringSource | None, variable_pool: ReadOnlyVariablePool) -> str | None:
    if source is None:
        return None
    if source.type is ValueSourceType.CONSTANT:
        return source.value
    segment = variable_pool.get(source.selector)
    if segment is None:
        return None
    return _resolved_text(segment, field_name="paragraph default")


def _resolve_select_options(source: StringListSource, variable_pool: ReadOnlyVariablePool) -> tuple[str, ...]:
    if source.type is ValueSourceType.CONSTANT:
        return tuple(source.value)
    segment = variable_pool.get(source.selector)
    if segment is None:
        raise ValueError("select option source variable is unavailable")
    resolved = segment.to_object()
    if not isinstance(resolved, list) or any(not isinstance(option, str) for option in resolved):
        raise TypeError("select option source must resolve to a string list")
    return tuple(resolved)


def _resolved_text(resolved: object, *, field_name: str) -> str | None:
    if isinstance(resolved, Segment):
        resolved = resolved.to_object()
    if resolved is None:
        return None
    if isinstance(resolved, str):
        return resolved
    if isinstance(resolved, bool | int | float):
        return str(resolved)
    raise TypeError(f"{field_name} must resolve to a scalar text value")


__all__ = ["MissingResolvedInputError", "compile_resolved_form"]
