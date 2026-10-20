"""Project frozen forms into the shared Dify form-rendering contract."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import assert_never

from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
)
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormInputConfig,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import ValueSourceType
from graphon.variables.segments import ArrayFileSegment, Segment


@dataclass(frozen=True, slots=True)
class FormPresentation:
    form_content: str
    inputs: list[FormInputConfig]
    user_actions: list[UserActionConfig]
    resolved_default_values: dict[str, str]


def build_form_presentation(form: ResolvedForm) -> FormPresentation:
    """Use the immutable snapshot without reloading workflow configuration."""
    inputs: list[FormInputConfig] = []
    defaults: dict[str, str] = {}
    seen: set[str] = set()
    for part in form.parts:
        if isinstance(part, MarkdownFragment) or part.output_variable_name in seen:
            continue
        name = part.output_variable_name
        seen.add(name)
        match part:
            case ParagraphInput():
                default = None
                if part.default_value is not None:
                    default = StringSource(type=ValueSourceType.CONSTANT, value=part.default_value)
                    defaults[name] = part.default_value
                inputs.append(ParagraphInputConfig(output_variable_name=name, default=default))
            case SelectInput():
                inputs.append(
                    SelectInputConfig(
                        output_variable_name=name,
                        option_source=StringListSource(
                            type=ValueSourceType.CONSTANT,
                            value=list(part.options),
                        ),
                    )
                )
                if part.default_value is not None:
                    defaults[name] = part.default_value
            case FileInput():
                inputs.append(
                    FileInputConfig(
                        output_variable_name=name,
                        allowed_file_types=part.allowed_file_types,
                        allowed_file_extensions=part.allowed_file_extensions,
                        allowed_file_upload_methods=part.allowed_file_upload_methods,
                    )
                )
            case FileListInput():
                inputs.append(
                    FileListInputConfig(
                        output_variable_name=name,
                        allowed_file_types=part.allowed_file_types,
                        allowed_file_extensions=part.allowed_file_extensions,
                        allowed_file_upload_methods=part.allowed_file_upload_methods,
                        number_limits=part.number_limits,
                    )
                )
    return FormPresentation(
        form_content=form.legacy_form_content,
        inputs=inputs,
        user_actions=[
            UserActionConfig(id=action.id, title=action.title, button_style=action.button_style)
            for action in form.actions
        ],
        resolved_default_values=defaults,
    )


def render_filled_content(form: ResolvedForm, inputs: Mapping[str, Segment]) -> str:
    """Render accepted inputs consistently across workflow events and delivery channels."""
    # Render source-ordered parts once: submitted text containing output markers
    # must not be interpreted as another template substitution.
    fragments: list[str] = []
    for part in form.parts:
        if isinstance(part, MarkdownFragment):
            fragments.append(part.text)
            continue
        segment = inputs.get(part.output_variable_name)
        if segment is None or segment.to_object() is None:
            continue
        match part:
            case ParagraphInput() | SelectInput():
                fragments.append(segment.text)
            case FileInput():
                fragments.append("[file]")
            case FileListInput():
                assert isinstance(segment, ArrayFileSegment), "Accepted file-list input must retain its Segment type"
                fragments.append(f"[{len(segment.value)} files]")
            case _:
                assert_never(part)
    return "".join(fragments)
