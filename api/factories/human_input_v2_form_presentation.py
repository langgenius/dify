"""Project frozen forms into the shared Dify form-rendering contract."""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import assert_never

from core.human_input_v2.resolved_form import (
    DateInput,
    DateTimeInput,
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
)
from core.workflow.nodes.human_input.entities import (
    DateInputConfig,
    DateTimeInputConfig,
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
from factories.file_url_factory import re_sign_file_urls
from graphon.variables.segments import ArrayFileSegment, Segment


def refresh_form_file_urls(form: ResolvedForm) -> ResolvedForm:
    """Copy display content with fresh file URLs without resolving variables again."""
    refreshed_urls: dict[str, str] = {}

    # Reuse each replacement across fragments and the legacy rendering so both
    # representations expose exactly the same signature in a single response.
    return form.model_copy(
        update={
            "parts": tuple(
                part.model_copy(
                    update={"text": re_sign_file_urls(part.text, preserve_url=True, replacements=refreshed_urls)}
                )
                if isinstance(part, MarkdownFragment)
                else part
                for part in form.parts
            ),
            "legacy_form_content": re_sign_file_urls(
                form.legacy_form_content, preserve_url=True, replacements=refreshed_urls
            ),
        }
    )


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
                # Shared form controls require a concrete paragraph default,
                # including when the frozen form has no configured default.
                default = StringSource(
                    type=ValueSourceType.CONSTANT,
                    value=part.resolved_default_value if part.resolved_default_value is not None else "",
                )
                if part.resolved_default_value is not None:
                    defaults[name] = part.resolved_default_value
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
                if part.resolved_default_value is not None:
                    defaults[name] = part.resolved_default_value
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
            case DateInput():
                default = (
                    StringSource(type=ValueSourceType.CONSTANT, value=part.resolved_default_value)
                    if part.resolved_default_value is not None
                    else None
                )
                if part.resolved_default_value is not None:
                    defaults[name] = part.resolved_default_value
                inputs.append(DateInputConfig(output_variable_name=name, default=default))
            case DateTimeInput():
                default = (
                    StringSource(type=ValueSourceType.CONSTANT, value=part.resolved_default_value)
                    if part.resolved_default_value is not None
                    else None
                )
                if part.resolved_default_value is not None:
                    defaults[name] = part.resolved_default_value
                inputs.append(DateTimeInputConfig(output_variable_name=name, default=default))
    return FormPresentation(
        form_content=form.legacy_form_content,
        inputs=inputs,
        user_actions=[
            UserActionConfig(id=action.id, title=action.title, button_style=action.button_style)
            for action in form.actions
        ],
        resolved_default_values=defaults,
    )


def build_service_api_form_presentation(form: ResolvedForm) -> FormPresentation:
    """Preserve v1 default metadata and expose only variable-resolved defaults.

    Source metadata is captured at compilation; this projection never reads
    workflow configuration or resolves selectors from a persisted form.
    """
    presentation = build_form_presentation(form)
    paragraphs = {part.output_variable_name: part for part in form.parts if isinstance(part, ParagraphInput)}
    inputs: list[FormInputConfig] = []
    for item in presentation.inputs:
        if isinstance(item, ParagraphInputConfig):
            source = paragraphs[item.output_variable_name].default_config
            inputs.append(
                ParagraphInputConfig(
                    output_variable_name=item.output_variable_name,
                    default=(
                        StringSource(type=source.type, selector=source.selector, value=source.value)
                        if source is not None
                        else None
                    ),
                )
            )
        else:
            inputs.append(item)
    return replace(
        presentation,
        inputs=inputs,
        resolved_default_values={
            name: part.resolved_default_value
            for name, part in paragraphs.items()
            if part.default_config is not None
            and part.default_config.type is ValueSourceType.VARIABLE
            and part.resolved_default_value is not None
        },
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
            case ParagraphInput() | DateInput() | DateTimeInput():
                fragments.append(str(segment.to_object()))
            case SelectInput():
                fragments.append(segment.text)
            case FileInput():
                fragments.append("[file]")
            case FileListInput():
                assert isinstance(segment, ArrayFileSegment), "Accepted file-list input must retain its Segment type"
                fragments.append(f"[{len(segment.value)} files]")
            case _:
                assert_never(part)
    return "".join(fragments)
