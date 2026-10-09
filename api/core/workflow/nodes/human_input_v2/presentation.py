"""Project frozen v2 form content into Dify's shared presentation contract."""

from collections.abc import Mapping

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
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.nodes.human_input.session_binding import default_session_binding
from graphon.entities.pause_reason import HitlRequired

from .runtime import PreparedForm


def resolve_human_input_v2_pause_reason(
    *, reason: HitlRequired, forms: Mapping[str, PreparedForm]
) -> HumanInputRequired:
    """Resolve a v2 pause exclusively from its preceding node event."""
    node_version, form_id = default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
    if node_version != "2":
        raise ValueError("Expected a Human Input v2 session")
    prepared = forms.get(form_id)
    if prepared is None:
        raise ValueError(f"Human Input v2 form snapshot is missing: node_id={reason.node_id}, form_id={form_id}")
    return build_human_input_v2_pause_reason(prepared.form.resolved_form, form_id=form_id, node_id=reason.node_id)


def build_human_input_v2_pause_reason(form: ResolvedForm, *, form_id: str, node_id: str) -> HumanInputRequired:
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
    return HumanInputRequired(
        form_version="2",
        form_id=form_id,
        node_id=node_id,
        node_title=form.title,
        form_content=form.legacy_form_content,
        inputs=inputs,
        actions=[
            UserActionConfig(id=action.id, title=action.title, button_style=action.button_style)
            for action in form.actions
        ],
        resolved_default_values=defaults,
    )
