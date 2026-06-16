"""Map a ``dify.ask_human`` deferred tool call onto the existing HITL form path.

ENG-636. When an Agent backend run ends with a deferred ``dify.ask_human`` tool
call, the workflow Agent node pauses the *outer* workflow through the very same
``HumanInputRequired`` form mechanism the Human Input node uses — reusing the
form repository, delivery channels, and submission endpoints unchanged. This
module is a pure translation layer: model-facing ask_human tool args become
graphon form entities (``HumanInputNodeData`` / ``FormInputConfig`` /
``UserActionConfig``) plus Dify delivery configs. It adds no new HITL behavior.

The agent-side ``dify.ask_human`` contract is richer than the workflow form
schema in two places, handled here without widening the form vocabulary:

* ask_human fields carry a human label; graphon ``FormInputConfig`` does not.
  Labels are rendered into ``form_content`` next to a ``{{#$output.<name>#}}``
  marker — exactly how the Human Input node positions labelled inputs today.
* ask_human action ids are valid identifiers of any length; graphon
  ``UserActionConfig.id`` caps ids at 20 chars. Over-long ids are clamped
  deterministically (stable + collision-resistant) so the form always builds;
  the human-visible action *label* is always preserved verbatim.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, assert_never

from dify_agent.layers.ask_human import (
    AskHumanAction,
    AskHumanField,
    AskHumanFileField,
    AskHumanFileListField,
    AskHumanParagraphField,
    AskHumanSelectField,
    AskHumanToolArgs,
)
from dify_agent.protocol import DeferredToolCallPayload
from pydantic import ValidationError

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepository
from core.workflow.human_input_adapter import (
    DeliveryChannelConfig,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    InteractiveSurfaceDeliveryMethod,
)
from graphon.entities.pause_reason import HumanInputRequired
from graphon.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormInputConfig,
    HumanInputNodeData,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
    UserActionConfig,
)
from graphon.nodes.human_input.enums import ButtonStyle, TimeoutUnit, ValueSourceType
from models.agent_config_entities import AgentHumanContactConfig

# Default ask_human tool name (see ``DifyAskHumanLayerConfig.tool_name``). The
# Agent node only knows how to translate this one deferred tool into a form.
DEFAULT_ASK_HUMAN_TOOL_NAME = "ask_human"

# Graphon ``UserActionConfig.id`` hard-caps identifiers at 20 chars.
_MAX_ACTION_ID_LEN = 20
# No timeout lives in the ask_human contract; reuse the Human Input node default.
_DEFAULT_TIMEOUT_HOURS = 36
_EMAIL_SUBJECT_MAX_LEN = 120

# ``ButtonStyle`` has no "destructive"; map the ask_human destructive intent onto
# the closest existing form style rather than extending the HITL vocabulary.
_ACTION_STYLE_TO_BUTTON: dict[str, ButtonStyle] = {
    "default": ButtonStyle.DEFAULT,
    "primary": ButtonStyle.PRIMARY,
    "destructive": ButtonStyle.ACCENT,
}

# ask_human permits zero actions (a plain acknowledgement); the form surface
# needs at least one submit affordance.
_DEFAULT_SUBMIT_ACTION = UserActionConfig(id="submit", title="Submit", button_style=ButtonStyle.PRIMARY)


class AskHumanFormBuildError(ValueError):
    """Raised when ask_human tool args cannot be mapped to a HITL form."""


def parse_ask_human_args(raw_args: object) -> AskHumanToolArgs:
    """Validate the raw deferred-tool ``args`` payload into ``AskHumanToolArgs``."""
    if isinstance(raw_args, AskHumanToolArgs):
        return raw_args
    if isinstance(raw_args, Mapping):
        try:
            return AskHumanToolArgs.model_validate(dict(raw_args))
        except ValidationError as error:
            raise AskHumanFormBuildError(f"invalid ask_human args: {error}") from error
    raise AskHumanFormBuildError(f"ask_human args must be a mapping, got {type(raw_args).__name__}")


def _clamp_action_id(action_id: str) -> str:
    """Return a stable graphon-safe (<= 20 char) action id.

    ask_human ids are already valid identifiers; ids within the limit pass
    through untouched so the resume round-trip returns the model's exact id.
    Over-long ids are truncated with a short content hash to stay deterministic
    and collision-resistant while remaining a valid identifier.
    """
    if len(action_id) <= _MAX_ACTION_ID_LEN:
        return action_id
    digest = hashlib.blake2b(action_id.encode("utf-8"), digest_size=3).hexdigest()
    prefix = action_id[: _MAX_ACTION_ID_LEN - len(digest) - 1]
    return f"{prefix}_{digest}"


def _to_form_input(field: AskHumanField) -> FormInputConfig:
    match field:
        case AskHumanParagraphField():
            default = (
                StringSource(type=ValueSourceType.CONSTANT, value=field.default) if field.default is not None else None
            )
            return ParagraphInputConfig(output_variable_name=field.name, default=default)
        case AskHumanSelectField():
            return SelectInputConfig(
                output_variable_name=field.name,
                option_source=StringListSource(
                    type=ValueSourceType.CONSTANT,
                    value=[option.value for option in field.options],
                ),
            )
        case AskHumanFileField():
            return FileInputConfig(output_variable_name=field.name)
        case AskHumanFileListField():
            return FileListInputConfig(output_variable_name=field.name, number_limits=field.max_files or 0)
        case _:  # pragma: no cover - exhaustive over the discriminated union
            assert_never(field)


def _to_user_actions(actions: Sequence[AskHumanAction]) -> list[UserActionConfig]:
    if not actions:
        return [_DEFAULT_SUBMIT_ACTION]
    return [
        UserActionConfig(
            id=_clamp_action_id(action.id),
            title=action.label,
            button_style=_ACTION_STYLE_TO_BUTTON.get(action.style, ButtonStyle.DEFAULT),
        )
        for action in actions
    ]


def _render_form_content(args: AskHumanToolArgs) -> str:
    """Compose the markdown body, positioning each field's label + input marker.

    Graphon ``FormInputConfig`` carries no label, so the field label is written
    into the content next to the ``{{#$output.<name>#}}`` marker that the form
    surface replaces with the live input — identical to the Human Input node.
    """
    blocks: list[str] = []
    if args.title:
        blocks.append(f"## {args.title}")
    blocks.append(args.question)
    if args.markdown:
        blocks.append(args.markdown)
    for field in args.fields:
        label = f"{field.label} *" if field.required else field.label
        blocks.append(f"**{label}**\n\n{{{{#$output.{field.name}#}}}}")
    return "\n\n".join(blocks)


def _resolved_default_values(args: AskHumanToolArgs) -> dict[str, Any]:
    """Pre-fill map the form surface reads, keyed by output variable name.

    The graphon select input has no default field, so a select default can only
    be conveyed here; paragraph defaults are included for a uniform pre-fill.
    """
    defaults: dict[str, Any] = {}
    for field in args.fields:
        if isinstance(field, AskHumanParagraphField | AskHumanSelectField) and field.default is not None:
            defaults[field.name] = field.default
    return defaults


def ask_human_args_to_node_data(args: AskHumanToolArgs, *, node_title: str) -> HumanInputNodeData:
    """Translate validated ask_human args into a synthetic Human Input node config."""
    return HumanInputNodeData(
        title=node_title,
        form_content=_render_form_content(args),
        inputs=[_to_form_input(field) for field in args.fields],
        user_actions=_to_user_actions(args.actions),
        timeout=_DEFAULT_TIMEOUT_HOURS,
        timeout_unit=TimeoutUnit.HOUR,
    )


def build_delivery_methods(
    contacts: Sequence[AgentHumanContactConfig],
    *,
    args: AskHumanToolArgs,
) -> list[DeliveryChannelConfig]:
    """Build form delivery channels: always the interactive surface, plus email to
    the configured human contacts (the recipients chosen in Agent Soul)."""
    methods: list[DeliveryChannelConfig] = [InteractiveSurfaceDeliveryMethod()]

    seen: set[str] = set()
    emails: list[str] = []
    for contact in contacts:
        email = (contact.email or "").strip()
        if email and email not in seen:
            seen.add(email)
            emails.append(email)

    if emails:
        subject = (args.title or args.question).strip()[:_EMAIL_SUBJECT_MAX_LEN]
        if args.urgency == "high":
            subject = f"[Action needed] {subject}"
        body = f"{args.question}\n\nOpen the request: {EmailDeliveryConfig.URL_PLACEHOLDER}"
        methods.append(
            EmailDeliveryMethod(
                config=EmailDeliveryConfig(
                    recipients=EmailRecipients(items=[ExternalRecipient(email=email) for email in emails]),
                    subject=subject,
                    body=body,
                )
            )
        )
    return methods


@dataclass(frozen=True, slots=True)
class AskHumanFormCreated:
    """A created ask_human HITL form, owner-agnostic (workflow run or conversation)."""

    form_id: str
    args: AskHumanToolArgs
    node_data: HumanInputNodeData
    node_title: str
    resolved_default_values: dict[str, Any]


def create_ask_human_form(
    *,
    deferred_tool_call: DeferredToolCallPayload,
    node_id: str,
    default_node_title: str,
    contacts: Sequence[AgentHumanContactConfig],
    repository: HumanInputFormRepository,
    workflow_run_id: str | None = None,
    conversation_id: str | None = None,
    display_in_ui: bool = True,
) -> AskHumanFormCreated:
    """Create a HITL form from an ask_human deferred call (caller verified tool_name).

    The form is owned by exactly one of ``workflow_run_id`` (workflow Agent node)
    or ``conversation_id`` (Agent v2 chat). Raises ``AskHumanFormBuildError`` on
    invalid args, a missing owner, or a repository failure.
    """
    if not workflow_run_id and not conversation_id:
        raise AskHumanFormBuildError("an ask_human HITL form requires a workflow_run_id or conversation_id")

    args = parse_ask_human_args(deferred_tool_call.args)
    node_title = args.title or default_node_title
    node_data = ask_human_args_to_node_data(args, node_title=node_title)
    resolved_default_values = _resolved_default_values(args)

    try:
        form = repository.create_form(
            FormCreateParams(
                workflow_execution_id=workflow_run_id,
                conversation_id=conversation_id,
                node_id=node_id,
                form_config=node_data,
                # No workflow-variable placeholders to resolve — the content is
                # fully model-authored, so rendered == template.
                rendered_content=node_data.form_content,
                delivery_methods=build_delivery_methods(contacts, args=args),
                display_in_ui=display_in_ui,
                resolved_default_values=resolved_default_values,
            )
        )
    except ValueError as error:
        raise AskHumanFormBuildError(f"failed to create ask_human HITL form: {error}") from error

    return AskHumanFormCreated(
        form_id=form.id,
        args=args,
        node_data=node_data,
        node_title=node_title,
        resolved_default_values=resolved_default_values,
    )


def build_ask_human_pause_reason(
    *,
    deferred_tool_call: DeferredToolCallPayload,
    node_id: str,
    default_node_title: str,
    workflow_run_id: str | None,
    contacts: Sequence[AgentHumanContactConfig],
    repository: HumanInputFormRepository,
    conversation_id: str | None = None,
    expected_tool_name: str = DEFAULT_ASK_HUMAN_TOOL_NAME,
    display_in_ui: bool = True,
) -> HumanInputRequired | None:
    """Create a workflow HITL form for an ask_human call and return its pause reason.

    Returns ``None`` when the deferred call is *not* the ask_human tool, letting
    the caller fall back to a generic scheduling pause. Raises
    ``AskHumanFormBuildError`` when the call is ask_human but its args or the form
    cannot be built — the caller should surface that as a node failure rather
    than a silent, unresumable pause.
    """
    if deferred_tool_call.tool_name != expected_tool_name:
        return None
    if not workflow_run_id:
        raise AskHumanFormBuildError("workflow_run_id is required to create an ask_human HITL form")

    created = create_ask_human_form(
        deferred_tool_call=deferred_tool_call,
        node_id=node_id,
        default_node_title=default_node_title,
        contacts=contacts,
        repository=repository,
        workflow_run_id=workflow_run_id,
        # A chatflow agent node also belongs to a conversation; tag the form so it is
        # queryable per conversation. None for a pure workflow run (workflow_run_id only).
        conversation_id=conversation_id,
        display_in_ui=display_in_ui,
    )
    return HumanInputRequired(
        form_id=created.form_id,
        form_content=created.node_data.form_content,
        inputs=list(created.node_data.inputs),
        actions=list(created.node_data.user_actions),
        node_id=node_id,
        node_title=created.node_title,
        resolved_default_values=created.resolved_default_values,
    )


__all__ = [
    "DEFAULT_ASK_HUMAN_TOOL_NAME",
    "AskHumanFormBuildError",
    "AskHumanFormCreated",
    "ask_human_args_to_node_data",
    "build_ask_human_pause_reason",
    "build_delivery_methods",
    "create_ask_human_form",
    "parse_ask_human_args",
]
