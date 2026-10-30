"""Transport-neutral results and failures for manual IM binding commands."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import NaiveDatetime

from core.human_input_v2.entities import HumanInputContactType
from core.human_input_v2.shared import ContactId
from repositories.human_input_v2.contact import IMBinding


class IMBindingCommandErrorCode(StrEnum):
    """Stable application failures suitable for transport-specific mapping."""

    INTEGRATION_NOT_CONFIGURED = "im_integration_not_configured"
    CONTACT_NOT_FOUND = "contact_not_found"
    IDENTITY_NOT_FOUND = "im_identity_not_found"
    BINDING_NOT_FOUND = "im_binding_not_found"
    BINDING_CONFLICT = "im_binding_conflict"
    INVALID_SCOPE = "invalid_im_binding_scope"


class IMBindingCommandError(RuntimeError):
    """Expected manual-binding rejection without persistence implementation detail."""

    def __init__(self, code: IMBindingCommandErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class ContactIMBindingView:
    """Current workspace Contact projection after one binding mutation."""

    id: ContactId
    type: HumanInputContactType
    name: str
    email: str | None
    avatar_file_id: str | None
    im_bindings: tuple[IMBinding, ...]
    created_at: NaiveDatetime


__all__ = ["ContactIMBindingView", "IMBindingCommandError", "IMBindingCommandErrorCode"]
