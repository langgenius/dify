"""Shared helpers for workflow pause-time human input form lookups.

Both controllers and streaming response converters need the same recipient
priority when exposing resume links for paused human input forms. Keep that
selection logic here so all API surfaces stay consistent.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.human_input_policy import (
    FormDisposition,
    HumanInputSurface,
    disposition_for_surface,
)
from extensions.ext_database import db
from models.human_input import HumanInputFormRecipient, RecipientType


def load_form_dispositions_by_form_id(
    form_ids: Sequence[str],
    *,
    session: Session | None = None,
    surface: HumanInputSurface | None = None,
) -> dict[str, FormDisposition]:
    """Resolve each paused form's resume token and approval channels for `surface`."""
    unique_form_ids = list(dict.fromkeys(form_ids))
    if not unique_form_ids:
        return {}

    if session is not None:
        return _load_form_dispositions_by_form_id(session, unique_form_ids, surface=surface)

    with Session(bind=db.engine, expire_on_commit=False) as new_session:
        return _load_form_dispositions_by_form_id(new_session, unique_form_ids, surface=surface)


def _load_form_dispositions_by_form_id(
    session: Session,
    form_ids: Sequence[str],
    *,
    surface: HumanInputSurface | None,
) -> dict[str, FormDisposition]:
    recipients_by_form_id: dict[str, list[tuple[RecipientType, str]]] = {}
    stmt = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids))
    for recipient in session.scalars(stmt):
        recipients_by_form_id.setdefault(recipient.form_id, []).append(
            (recipient.recipient_type, recipient.access_token or "")
        )
    return {
        form_id: disposition_for_surface(recipients, surface=surface)
        for form_id, recipients in recipients_by_form_id.items()
    }


def load_form_tokens_by_form_id(
    form_ids: Sequence[str],
    *,
    session: Session | None = None,
    surface: HumanInputSurface | None = None,
) -> dict[str, str]:
    """Resume tokens only, for callers that don't surface approval channels."""
    dispositions = load_form_dispositions_by_form_id(form_ids, session=session, surface=surface)
    return {
        form_id: disposition.form_token
        for form_id, disposition in dispositions.items()
        if disposition.form_token is not None
    }
