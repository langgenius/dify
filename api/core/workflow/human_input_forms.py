"""Shared helpers for workflow pause-time human input form lookups.

Both controllers and streaming response converters need the same recipient
priority when exposing resume links for paused human input forms. Keep that
selection logic here so all API surfaces stay consistent.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.human_input import HumanInputFormRecipient, RecipientType

_FORM_TOKEN_PRIORITY = {
    RecipientType.BACKSTAGE: 0,
    RecipientType.CONSOLE: 1,
    RecipientType.STANDALONE_WEB_APP: 2,
}


def load_form_tokens_by_form_id(
    form_ids: Sequence[str],
    *,
    session: Session | None = None,
) -> dict[str, str]:
    """Load the preferred access token for each human input form."""
    unique_form_ids = list(dict.fromkeys(form_ids))
    if not unique_form_ids:
        return {}

    if session is not None:
        return _load_form_tokens_by_form_id(session, unique_form_ids)

    with Session(bind=db.engine, expire_on_commit=False) as new_session:
        return _load_form_tokens_by_form_id(new_session, unique_form_ids)


def _load_form_tokens_by_form_id(session: Session, form_ids: Sequence[str]) -> dict[str, str]:
    tokens_by_form_id: dict[str, tuple[int, str]] = {}
    stmt = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids))
    for recipient in session.scalars(stmt):
        priority = _FORM_TOKEN_PRIORITY.get(recipient.recipient_type)
        if priority is None or not recipient.access_token:
            continue

        candidate = (priority, recipient.access_token)
        current = tokens_by_form_id.get(recipient.form_id)
        if current is None or candidate[0] < current[0]:
            tokens_by_form_id[recipient.form_id] = candidate

    return {form_id: token for form_id, (_, token) in tokens_by_form_id.items()}
