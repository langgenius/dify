"""Shared helpers for workflow pause-time human input form lookups.

Controllers and streaming response converters supply the current response
surface. Resolve existing recipients through its policy without creating tokens.
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
    surface: HumanInputSurface,
) -> dict[str, FormDisposition]:
    """Read dispositions for admitted form IDs and an explicit response surface.

    Use the supplied session or a short owned read session. IDs without recipients
    are omitted; forms without allowed recipients have no token. No rows are changed.
    """
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
    surface: HumanInputSurface,
) -> dict[str, FormDisposition]:
    """Read existing recipients in the caller's session and apply the surface policy."""
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
    surface: HumanInputSurface,
) -> dict[str, str]:
    """Read allowed tokens for admitted form IDs; omit forms without actionable tokens.

    The response surface is explicit, and recipient records are never modified.
    """
    dispositions = load_form_dispositions_by_form_id(form_ids, session=session, surface=surface)
    return {
        form_id: disposition.form_token
        for form_id, disposition in dispositions.items()
        if disposition.form_token is not None
    }
