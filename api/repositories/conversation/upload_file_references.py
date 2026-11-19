"""Message-owned references to shared upload files."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import App, MessageFile
from models.model import Conversation, Message
from repositories.file.reference_queries import (
    candidate_batches,
    payload_reference_predicate,
)
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by message relations and persisted text."""

    referenced: set[str] = set()
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(MessageFile.upload_file_id)
                .where(MessageFile.upload_file_id.in_(batch_ids))
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue

        conversation_columns = (Conversation._inputs, Conversation.introduction, Conversation.system_instruction)
        conversation_rows = session.execute(
            select(*conversation_columns)
            .join(App, App.id == Conversation.app_id)
            .where(
                App.tenant_id == tenant_id,
                payload_reference_predicate(conversation_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(
            referenced_candidate_ids((payload for row in conversation_rows for payload in row), remaining)
        )
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        message_columns = (Message._inputs, Message.message, Message.answer)
        message_rows = session.execute(
            select(*message_columns)
            .join(App, App.id == Message.app_id)
            .where(
                App.tenant_id == tenant_id,
                payload_reference_predicate(message_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in message_rows for payload in row), remaining))
    return referenced
