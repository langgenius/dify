from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, NamedTuple

from pydantic import ValidationError

from core.workflow.human_input import FormDefinition, FormInputConfig, SelectInputConfig, UserActionConfig, ValueSourceType
from graphon.entities.pause_reason import HitlRequired, PauseReason, PauseReasonType
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables import ArrayStringSegment
from models.human_input import ApprovalChannel, RecipientType


class HumanInputSurface(StrEnum):
    SERVICE_API = "service_api"
    CONSOLE = "console"
    OPENAPI = "openapi"


# SERVICE_API and OPENAPI are intentionally narrower than CONSOLE: token callers
# should only be able to act on end-user web forms, not internal console flows.
ALLOWED_RECIPIENT_TYPES_BY_SURFACE: dict[HumanInputSurface, frozenset[RecipientType]] = {
    HumanInputSurface.SERVICE_API: frozenset({RecipientType.STANDALONE_WEB_APP}),
    HumanInputSurface.CONSOLE: frozenset({RecipientType.CONSOLE, RecipientType.BACKSTAGE}),
    HumanInputSurface.OPENAPI: frozenset({RecipientType.STANDALONE_WEB_APP}),
}

# A single HITL form can have multiple recipient records; this shared priority
# keeps every API surface consistent about which resume token to expose.
_RECIPIENT_TOKEN_PRIORITY: dict[RecipientType, int] = {
    RecipientType.BACKSTAGE: 0,
    RecipientType.CONSOLE: 1,
    RecipientType.STANDALONE_WEB_APP: 2,
}


def is_recipient_type_allowed_for_surface(
    recipient_type: RecipientType | None,
    surface: HumanInputSurface,
) -> bool:
    if recipient_type is None:
        return False
    return recipient_type in ALLOWED_RECIPIENT_TYPES_BY_SURFACE[surface]


def get_preferred_form_token(
    recipients: Sequence[tuple[RecipientType, str]],
) -> str | None:
    chosen_token: str | None = None
    chosen_priority: int | None = None
    for recipient_type, token in recipients:
        priority = _RECIPIENT_TOKEN_PRIORITY.get(recipient_type)
        if priority is None or not token:
            continue
        if chosen_priority is None or priority < chosen_priority:
            chosen_priority = priority
            chosen_token = token
    return chosen_token


class FormDisposition(NamedTuple):
    """How a paused form resolves for one API surface.

    A form's recipients split into those the surface may act on (yielding a resume
    `form_token`) and those it may not (their channels named in `approval_channels`
    so the caller is told where approval actually happens instead).
    """

    form_token: str | None
    approval_channels: list[ApprovalChannel]


class HydratedHitlFormDefinition(NamedTuple):
    """Pause-response fields rebuilt from Dify-owned form_definition storage."""

    form_content: str
    inputs: list[FormInputConfig]
    actions: list[UserActionConfig]
    resolved_default_values: dict[str, Any]
    node_title: str
    display_in_ui: bool


def disposition_for_surface(
    recipients: Sequence[tuple[RecipientType, str]],
    *,
    surface: HumanInputSurface | None,
) -> FormDisposition:
    if surface is None:
        return FormDisposition(form_token=get_preferred_form_token(recipients), approval_channels=[])
    allowed = ALLOWED_RECIPIENT_TYPES_BY_SURFACE[surface]
    actionable = [(recipient_type, token) for recipient_type, token in recipients if recipient_type in allowed]
    return FormDisposition(
        form_token=get_preferred_form_token(actionable),
        approval_channels=sorted(
            {recipient_type.approval_channel for recipient_type, _ in recipients if recipient_type not in allowed}
        ),
    )


def enrich_human_input_pause_reasons(
    reasons: Sequence[Mapping[str, Any]],
    *,
    dispositions_by_form_id: Mapping[str, FormDisposition],
    expiration_times_by_form_id: Mapping[str, int],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for reason in reasons:
        updated = dict(reason)
        reason_id: str | None = None
        if updated.get("TYPE") == PauseReasonType.HITL_REQUIRED:
            session_id = updated.get("session_id")
            if isinstance(session_id, str):
                reason_id = session_id
        elif updated.get("TYPE") == PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED:
            form_id = updated.get("form_id")
            if isinstance(form_id, str):
                reason_id = form_id

        if reason_id is not None:
            disposition = dispositions_by_form_id.get(reason_id)
            updated["form_token"] = disposition.form_token if disposition else None
            updated["approval_channels"] = list(disposition.approval_channels) if disposition else []
            expiration_time = expiration_times_by_form_id.get(reason_id)
            if expiration_time is not None:
                updated["expiration_time"] = expiration_time
        enriched.append(updated)
    return enriched


def hydrate_hitl_form_definition(
    *,
    form_definition: str | None,
    expiration_time: object | None,
    variable_pool: ReadOnlyVariablePool | None,
    fallback_node_title: str,
) -> HydratedHitlFormDefinition:
    """Rebuild rich HITL response fields from persisted Dify form definitions."""

    definition_payload: dict[str, Any] = {}
    if form_definition:
        try:
            parsed_definition = json.loads(form_definition)
        except (TypeError, json.JSONDecodeError):
            parsed_definition = {}
        if isinstance(parsed_definition, dict):
            definition_payload = parsed_definition
    if "expiration_time" not in definition_payload and expiration_time is not None:
        definition_payload["expiration_time"] = expiration_time

    try:
        definition = FormDefinition.model_validate(definition_payload)
    except ValidationError:
        return HydratedHitlFormDefinition(
            form_content="",
            inputs=[],
            actions=[],
            resolved_default_values={},
            node_title=fallback_node_title,
            display_in_ui=bool(definition_payload.get("display_in_ui")),
        )

    return HydratedHitlFormDefinition(
        form_content=definition.form_content,
        inputs=resolve_variable_select_input_options(definition.inputs, variable_pool=variable_pool),
        actions=list(definition.user_actions),
        resolved_default_values=dict(definition.default_values),
        node_title=definition.node_title or fallback_node_title,
        display_in_ui=bool(definition.display_in_ui),
    )


def resolve_human_input_pause_reason_inputs(
    reasons: Sequence[PauseReason],
    *,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[PauseReason]:
    """Minimal graphon HITL reasons carry no rich fields; callers rehydrate from form storage."""

    _ = variable_pool
    return list(reasons)


def iter_hitl_required_reasons(reasons: Sequence[PauseReason]) -> list[HitlRequired]:
    return [reason for reason in reasons if isinstance(reason, HitlRequired)]


def resolve_variable_select_input_options(
    inputs: Sequence[FormInputConfig],
    *,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[FormInputConfig]:
    """Resolve variable-backed select options to runtime values."""

    # This function replace the SelectInputConfig.option_source.value
    # field with acutial runtime values when option_source.type is VARIABLE.
    #
    # This is a dirty hacks. However it does reduces the logic leaked to callers of
    # the api.
    resolved_inputs: list[FormInputConfig] = []

    if variable_pool is None:
        return list(inputs)

    for form_input in inputs:
        if str(getattr(form_input, "type", "")) != "select":
            resolved_inputs.append(form_input)
            continue

        option_source = form_input.option_source
        if str(option_source.type) != ValueSourceType.VARIABLE:
            resolved_inputs.append(form_input)
            continue

        option_values = variable_pool.get(option_source.selector)
        if option_values is None:
            resolved_inputs.append(form_input)
            continue
        if not isinstance(option_values, ArrayStringSegment):
            raise TypeError(f"expected ArrayStringSegment, got {type(option_values)}")

        updated_option_source = option_source.model_copy(update={"value": option_values.value})
        # Ensure frontend receives concrete select options instead of unresolved selectors.
        resolved_inputs.append(
            form_input.model_copy(
                update={"option_source": updated_option_source},
            )
        )
    return resolved_inputs

