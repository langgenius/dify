"""Snapshot message data in the caller's session before file or extra-content I/O."""

from copy import deepcopy
from typing import cast

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account
from models.model import Message, MessageAgentThought, MessageFile
from services.entities.message_entities import (
    ConsoleMessageFeedbackRecord,
    ConsoleMessageRecord,
    MessageAccountRecord,
    MessageAgentThoughtRecord,
    MessageAnnotationHitRecord,
    MessageAnnotationRecord,
    MessageFileReference,
    MessageInputValue,
    MessageRating,
    MessageRecord,
    MessageSource,
)


def snapshot_message(*, message: Message, session: Session) -> MessageSource[MessageRecord]:
    """Borrow the caller's session and return detached data plus raw file references."""
    return _message_source(record=_message_record(message=message, session=session), session=session)


def snapshot_console_message(*, message: Message, session: Session) -> MessageSource[ConsoleMessageRecord]:
    """Materialize Console fields without restoring files or signing URLs."""
    return _message_source(record=_console_message_record(message=message, session=session), session=session)


def _message_source[RecordT: MessageRecord](*, record: RecordT, session: Session) -> MessageSource[RecordT]:
    """Snapshot file references without restoring files or signing URLs."""
    files = session.scalars(select(MessageFile).where(MessageFile.message_id == record.id))
    return MessageSource(
        record=record,
        files=tuple(
            MessageFileReference(
                id=file.id,
                type=file.type.value,
                transfer_method=file.transfer_method.value,
                url=file.url,
                upload_file_id=file.upload_file_id,
                belongs_to=file.belongs_to.value if file.belongs_to is not None else None,
            )
            for file in files
        ),
    )


def _message_record(*, message: Message, session: Session) -> MessageRecord:
    # Snapshot stored JSON; restoration and URL signing belong to the query
    # service's file adapter after this database session has closed.
    inputs = deepcopy(cast(dict[str, MessageInputValue], message._inputs))
    feedback = message.user_feedback_with_session(session=session)
    thoughts = [_thought_record(thought) for thought in message.agent_thoughts_with_session(session=session)]
    return MessageRecord(
        id=message.id,
        conversation_id=message.conversation_id,
        parent_message_id=message.parent_message_id,
        inputs=inputs,
        query=message.query,
        answer=message.answer,
        feedback=MessageRating(rating=feedback.rating.value) if feedback is not None else None,
        retriever_resources=cast(list[dict[str, JsonValue]] | None, message.retriever_resources),
        created_at=message.created_at,
        agent_thoughts=thoughts,
        message_files=[],
        message_tokens=message.message_tokens,
        answer_tokens=message.answer_tokens,
        provider_response_latency=message.provider_response_latency,
        total_price=message.total_price,
        currency=message.currency,
        status=message.status.value,
        error=message.error,
        metadata=cast(JsonValue, message.message_metadata_dict),
    )


def _thought_record(thought: MessageAgentThought) -> MessageAgentThoughtRecord:
    return MessageAgentThoughtRecord(
        id=thought.id,
        message_id=thought.message_id,
        message_chain_id=thought.message_chain_id,
        position=thought.position,
        thought=thought.thought,
        answer=thought.answer,
        tool=thought.tool,
        tool_labels=cast(JsonValue, thought.tool_labels),
        tool_input=thought.tool_input,
        created_at=thought.created_at,
        observation=thought.observation,
        files=cast(list[str], thought.files),
    )


def _account_record(account: Account | None) -> MessageAccountRecord | None:
    return MessageAccountRecord(id=account.id, name=account.name, email=account.email) if account else None


def _console_message_record(*, message: Message, session: Session) -> ConsoleMessageRecord:
    record = _message_record(message=message, session=session)
    annotation = message.annotation_with_session(session=session)
    annotation_hit = message.annotation_hit_history_with_session(session=session)
    return ConsoleMessageRecord(
        id=record.id,
        conversation_id=record.conversation_id,
        parent_message_id=record.parent_message_id,
        inputs=record.inputs,
        query=record.query,
        answer=record.answer,
        feedback=record.feedback,
        retriever_resources=record.retriever_resources or [],
        created_at=record.created_at,
        agent_thoughts=record.agent_thoughts,
        message_files=record.message_files,
        message_tokens=record.message_tokens,
        answer_tokens=record.answer_tokens,
        provider_response_latency=record.provider_response_latency,
        total_price=record.total_price,
        currency=record.currency,
        status=record.status,
        error=record.error,
        metadata=record.metadata,
        message=deepcopy(cast(JsonValue, message.message)),
        from_source=message.from_source,
        from_end_user_id=message.from_end_user_id,
        from_account_id=message.from_account_id,
        workflow_run_id=message.workflow_run_id,
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
    )
