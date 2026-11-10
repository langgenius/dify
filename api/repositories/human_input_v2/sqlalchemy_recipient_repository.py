"""Owner-bound persistence of resolved recipient identities and provenance."""

from __future__ import annotations

from collections.abc import Sequence
from typing import assert_never, override

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import ContactId, NormalizedEmail, RecipientId, TenantId
from models.human_input_v2 import HumanInputRecipient, RecipientSnapshot, RecipientSources, RecipientSubjectType

from .recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    EndUserRecipientSubject,
    Recipient,
    RecipientCreateParams,
    RecipientRepository,
    RecipientSubject,
)


def _subject_columns(subject: RecipientSubject) -> tuple[RecipientSubjectType, str]:
    match subject:
        case ContactRecipientSubject(contact_id):
            return RecipientSubjectType.CONTACT, contact_id
        case EmailRecipientSubject(email):
            return RecipientSubjectType.EMAIL, email.value
        case EndUserRecipientSubject(end_user_id):
            return RecipientSubjectType.END_USER, end_user_id
        case _:
            assert_never(subject)


def _to_recipient(record: HumanInputRecipient) -> Recipient:
    subject: RecipientSubject
    match record.subject_type:
        case RecipientSubjectType.CONTACT:
            subject = ContactRecipientSubject(ContactId(record.subject_value))
        case RecipientSubjectType.EMAIL:
            subject = EmailRecipientSubject(NormalizedEmail(record.subject_value))
        case RecipientSubjectType.END_USER:
            subject = EndUserRecipientSubject(record.subject_value)
    return Recipient(
        id=RecipientId(record.id),
        tenant_id=TenantId(record.tenant_id),
        form_id=record.form_id,
        subject=subject,
        sources=tuple(record.sources.root),
        name=record.snapshot.name,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class SQLAlchemyRecipientRepository(RecipientRepository):
    """Use the caller's transaction and the form's unique subject constraint."""

    def __init__(self, session: Session, tenant_id: TenantId, form_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._form_id = form_id

    def _query(self) -> sa.Select[tuple[HumanInputRecipient]]:
        return (
            sa.select(HumanInputRecipient)
            .where(HumanInputRecipient.tenant_id == self._tenant_id, HumanInputRecipient.form_id == self._form_id)
            .execution_options(autoflush=False, populate_existing=True)
        )

    @override
    def create_recipients(self, params: Sequence[RecipientCreateParams]) -> tuple[Recipient, ...]:
        if not params:
            return ()

        subjects = [_subject_columns(param.subject) for param in params]
        query = self._query().where(
            sa.tuple_(HumanInputRecipient.subject_type, HumanInputRecipient.subject_value).in_(subjects)
        )
        records = {(record.subject_type, record.subject_value): record for record in self._session.scalars(query)}
        new_records: list[HumanInputRecipient] = []
        # Stable lock acquisition order avoids inverse-order batch deadlocks.
        for index in sorted(range(len(params)), key=lambda index: subjects[index]):
            subject_type, subject_value = subjects[index]
            subject_key = (subject_type, subject_value)
            if subject_key in records:
                continue
            param = params[index]
            record = HumanInputRecipient(
                tenant_id=self._tenant_id,
                form_id=self._form_id,
                subject_type=subject_type,
                subject_value=subject_value,
                sources=RecipientSources(root=param.sources),
                snapshot=RecipientSnapshot(name=param.name),
            )
            record.updated_at = record.created_at
            records[subject_key] = record
            new_records.append(record)
        if new_records:
            self._session.add_all(new_records)
            self._session.flush(new_records)
        recipients = {
            (record.subject_type, record.subject_value): _to_recipient(record)
            for record in self._session.scalars(query)
        }
        return tuple(recipients[subject] for subject in subjects)

    @override
    def list_recipients(self) -> tuple[Recipient, ...]:
        records = self._session.scalars(self._query().order_by(HumanInputRecipient.id))
        return tuple(_to_recipient(record) for record in records)

    @override
    def get_recipient(self, recipient_id: RecipientId) -> Recipient | None:
        record = self._session.scalars(self._query().where(HumanInputRecipient.id == recipient_id)).one_or_none()
        return _to_recipient(record) if record is not None else None
