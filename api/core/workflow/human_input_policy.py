from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from graphon.entities.pause_reason import HumanInputRequired, PauseReason, PauseReasonType
from graphon.nodes.human_input.entities import FormInputConfig, SelectInputConfig
from graphon.nodes.human_input.enums import ValueSourceType
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables import ArrayStringSegment
from models.human_input import RecipientType


class HumanInputSurface(StrEnum):
    SERVICE_API = "service_api"
    CONSOLE = "console"
    OPENAPI = "openapi"


# SERVICE_API and OPENAPI are intentionally narrower than CONSOLE: token callers
# should only be able to act on end-user web forms, not internal console flows.
_ALLOWED_RECIPIENT_TYPES_BY_SURFACE: dict[HumanInputSurface, frozenset[RecipientType]] = {
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
    return recipient_type in _ALLOWED_RECIPIENT_TYPES_BY_SURFACE[surface]


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


def enrich_human_input_pause_reasons(
    reasons: Sequence[Mapping[str, Any]],
    *,
    form_tokens_by_form_id: Mapping[str, str],
    expiration_times_by_form_id: Mapping[str, int],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for reason in reasons:
        updated = dict(reason)
        if updated.get("TYPE") == PauseReasonType.HUMAN_INPUT_REQUIRED:
            form_id = updated.get("form_id")
            if isinstance(form_id, str):
                updated["form_token"] = form_tokens_by_form_id.get(form_id)
                expiration_time = expiration_times_by_form_id.get(form_id)
                if expiration_time is not None:
                    updated["expiration_time"] = expiration_time
        enriched.append(updated)
    return enriched


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
        if not isinstance(form_input, SelectInputConfig):
            resolved_inputs.append(form_input)
            continue

        option_source = form_input.option_source
        if option_source.type != ValueSourceType.VARIABLE:
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


def resolve_human_input_pause_reason_inputs(
    reasons: Sequence[PauseReason],
    *,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[PauseReason]:
    if variable_pool is None:
        return list(reasons)

    resolved_reasons: list[PauseReason] = []
    for reason in reasons:
        if not isinstance(reason, HumanInputRequired):
            resolved_reasons.append(reason)
            continue

        resolved_inputs = resolve_variable_select_input_options(
            reason.inputs,
            variable_pool=variable_pool,
        )
        resolved_reasons.append(reason.model_copy(update={"inputs": resolved_inputs}))
    return resolved_reasons
