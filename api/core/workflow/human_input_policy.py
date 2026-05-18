from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from graphon.entities.pause_reason import PauseReasonType
from models.human_input import RecipientType


class HumanInputSurface(StrEnum):
    SERVICE_API = "service_api"
    CONSOLE = "console"


# Service API is intentionally narrower than other surfaces: app-token callers
# should only be able to act on end-user web forms, not internal console flows.
_ALLOWED_RECIPIENT_TYPES_BY_SURFACE: dict[HumanInputSurface, frozenset[RecipientType]] = {
    HumanInputSurface.SERVICE_API: frozenset({RecipientType.STANDALONE_WEB_APP}),
    HumanInputSurface.CONSOLE: frozenset({RecipientType.CONSOLE, RecipientType.BACKSTAGE}),
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
