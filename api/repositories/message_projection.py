"""Materialize Console message details without restoring files or signing URLs."""

from copy import deepcopy
from typing import cast

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account
from models.model import Message, MessageFile
from services.entities.message_entities import (
    ConsoleMessageFeedbackRecord,
    ConsoleMessageRecord,
    MessageAccountRecord,
    MessageAgentThoughtRecord,
    MessageAnnotationHitRecord,
    MessageAnnotationRecord,
    MessageFileReference,
    MessageInputValue,
)


def _account_record(account: Account | None) -> MessageAccountRecord | None:
    return MessageAccountRecord(id=account.id, name=account.name, email=account.email) if account else None


def snapshot_console_message(
    *, message: Message, session: Session
) -> tuple[ConsoleMessageRecord, tuple[MessageFileReference, ...]]:
    """Borrow the caller's session for database reads and return detached values."""
    annotation = message.annotation_with_session(session=session)
    annotation_hit = message.annotation_hit_history_with_session(session=session)
    record = ConsoleMessageRecord(
        id=message.id,
        conversation_id=message.conversation_id,
        inputs=deepcopy(cast(dict[str, MessageInputValue], message._inputs)),
        query=message.query,
        message=deepcopy(cast(JsonValue, message.message)),
        message_tokens=message.message_tokens,
        answer=message.answer,
        answer_tokens=message.answer_tokens,
        provider_response_latency=message.provider_response_latency,
        from_source=message.from_source.value,
        from_end_user_id=message.from_end_user_id,
        from_account_id=message.from_account_id,
        feedbacks=[
            ConsoleMessageFeedbackRecord(
                rating=feedback.rating.value,
                content=feedback.content,
                from_source=feedback.from_source.value,
                from_end_user_id=feedback.from_end_user_id,
                from_account=_account_record(feedback.from_account_with_session(session=session)),
            )
            for feedback in message.feedbacks_with_session(session=session)
        ],
        workflow_run_id=message.workflow_run_id,
        annotation=MessageAnnotationRecord(
            id=annotation.id,
            question=annotation.question,
            content=annotation.content,
            account=_account_record(annotation.account_with_session(session=session)),
            created_at=annotation.created_at,
        )
        if annotation
        else None,
        annotation_hit_history=MessageAnnotationHitRecord(
            id=annotation_hit.id,
            annotation_create_account=_account_record(
                annotation_hit.annotation_create_account_with_session(session=session)
            ),
            created_at=annotation_hit.created_at,
        )
        if annotation_hit
        else None,
        created_at=message.created_at,
        agent_thoughts=[
            MessageAgentThoughtRecord(
                id=thought.id,
                message_id=thought.message_id,
                message_chain_id=thought.message_chain_id,
                position=thought.position,
                thought=thought.thought,
                answer=thought.answer,
                tool=thought.tool,
                tool_labels=deepcopy(cast(JsonValue, thought.tool_labels)),
                tool_input=thought.tool_input,
                created_at=thought.created_at,
                observation=thought.observation,
                files=deepcopy(cast(list[str], thought.files)),
            )
            for thought in message.agent_thoughts_with_session(session=session)
        ],
        message_files=[],
        metadata=deepcopy(cast(JsonValue, message.message_metadata_dict)),
        status=message.status.value,
        error=message.error,
        parent_message_id=message.parent_message_id,
    )
    files = session.scalars(select(MessageFile).where(MessageFile.message_id == message.id))
    return record, tuple(
        MessageFileReference(
            id=file.id,
            type=file.type.value,
            transfer_method=file.transfer_method.value,
            url=file.url,
            upload_file_id=file.upload_file_id,
            belongs_to=file.belongs_to.value if file.belongs_to is not None else None,
        )
        for file in files
    )
