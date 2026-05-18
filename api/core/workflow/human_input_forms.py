"""Shared helpers for workflow pause-time human input form lookups.

Both controllers and streaming response converters need the same recipient
priority when exposing resume links for paused human input forms. Keep that
selection logic here so all API surfaces stay consistent.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.human_input_policy import HumanInputSurface, get_preferred_form_token
from extensions.ext_database import db
from models.human_input import HumanInputFormRecipient, RecipientType


def load_form_tokens_by_form_id(
    form_ids: Sequence[str],
    *,
    session: Session | None = None,
    surface: HumanInputSurface | None = None,
) -> dict[str, str]:
    """Load the preferred access token for each human input form."""
    unique_form_ids = list(dict.fromkeys(form_ids))
    if not unique_form_ids:
        return {}

    if session is not None:
        return _load_form_tokens_by_form_id(session, unique_form_ids, surface=surface)

    with Session(bind=db.engine, expire_on_commit=False) as new_session:
        return _load_form_tokens_by_form_id(new_session, unique_form_ids, surface=surface)


def _load_form_tokens_by_form_id(
    session: Session,
    form_ids: Sequence[str],
    *,
    surface: HumanInputSurface | None = None,
) -> dict[str, str]:
    recipients_by_form_id: dict[str, list[tuple[RecipientType, str]]] = {}
    stmt = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids))
    for recipient in session.scalars(stmt):
        if not recipient.access_token:
            continue
        recipients_by_form_id.setdefault(recipient.form_id, []).append(
            (recipient.recipient_type, recipient.access_token)
        )

    tokens_by_form_id: dict[str, str] = {}
    for form_id, recipients in recipients_by_form_id.items():
        token = _get_surface_form_token(recipients, surface=surface)
        if token is not None:
            tokens_by_form_id[form_id] = token
    return tokens_by_form_id


def _get_surface_form_token(
    recipients: Sequence[tuple[RecipientType, str]],
    *,
    surface: HumanInputSurface | None,
) -> str | None:
    if surface == HumanInputSurface.SERVICE_API:
        for recipient_type, token in recipients:
            if recipient_type == RecipientType.STANDALONE_WEB_APP and token:
                return token

    return get_preferred_form_token(recipients)
