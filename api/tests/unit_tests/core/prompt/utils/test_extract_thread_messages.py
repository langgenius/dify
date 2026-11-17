import re
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from constants import UUID_NIL
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.prompt.utils.get_thread_messages_length import get_thread_messages_length
from models.enums import ConversationFromSource
from models.model import Message


def _persisted_message(
    *,
    message_id: str,
    conversation_id: str,
    parent_message_id: str,
    answer: str,
    created_at: datetime,
) -> Message:
    message = Message(
        id=message_id,
        app_id="app-id",
        conversation_id=conversation_id,
        query="question",
        message={"role": "user", "content": "question"},
        answer=answer,
        message_unit_price=Decimal("0.0001"),
        answer_unit_price=Decimal("0.0001"),
        currency="USD",
        from_source=ConversationFromSource.API,
        parent_message_id=parent_message_id,
    )
    message._inputs = {}
    message.created_at = created_at
    message.updated_at = created_at
    return message


def _unsaved_message(message_id: str, parent_message_id: str | None, answer: str = "answer") -> Message:
    """A Message that is never flushed, so only the thread fields need to be meaningful."""
    return Message(id=message_id, parent_message_id=parent_message_id, answer=answer)


def test_extract_thread_messages_single_message() -> None:
    messages = [_unsaved_message(str(uuid4()), UUID_NIL)]
    result = extract_thread_messages(messages)
    assert len(result) == 1
    assert result[0] == messages[0]


def test_extract_thread_messages_linear_thread() -> None:
    id1, id2, id3, id4, id5 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        _unsaved_message(id5, id4),
        _unsaved_message(id4, id3),
        _unsaved_message(id3, id2),
        _unsaved_message(id2, id1),
        _unsaved_message(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 5
    assert [msg.id for msg in result] == [id5, id4, id3, id2, id1]


def test_extract_thread_messages_branched_thread() -> None:
    id1, id2, id3, id4 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        _unsaved_message(id4, id2),
        _unsaved_message(id3, id2),
        _unsaved_message(id2, id1),
        _unsaved_message(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg.id for msg in result] == [id4, id2, id1]


def test_extract_thread_messages_empty_list() -> None:
    messages = []
    result = extract_thread_messages(messages)
    assert len(result) == 0


def test_extract_thread_messages_partially_loaded() -> None:
    id0, id1, id2, id3 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        _unsaved_message(id3, id2),
        _unsaved_message(id2, id1),
        _unsaved_message(id1, id0),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg.id for msg in result] == [id3, id2, id1]


def test_extract_thread_messages_legacy_messages() -> None:
    id1, id2, id3 = str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        _unsaved_message(id3, UUID_NIL),
        _unsaved_message(id2, UUID_NIL),
        _unsaved_message(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg.id for msg in result] == [id3, id2, id1]


def test_extract_thread_messages_mixed_with_legacy_messages() -> None:
    id1, id2, id3, id4, id5 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        _unsaved_message(id5, id4),
        _unsaved_message(id4, id2),
        _unsaved_message(id3, id2),
        _unsaved_message(id2, UUID_NIL),
        _unsaved_message(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 4
    assert [msg.id for msg in result] == [id5, id4, id2, id1]


def test_extract_thread_messages_breaks_when_parent_is_none() -> None:
    id1, id2 = str(uuid4()), str(uuid4())
    messages = [_unsaved_message(id2, None), _unsaved_message(id1, UUID_NIL)]

    result = extract_thread_messages(messages)

    assert len(result) == 1
    assert result[0].id == id2


@pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
def test_get_thread_messages_length_excludes_newly_created_empty_answer(sqlite_session: Session) -> None:
    id1, id2 = str(uuid4()), str(uuid4())
    now = datetime.now()
    messages = [
        _persisted_message(
            message_id=id2,
            conversation_id="conversation-1",
            parent_message_id=id1,
            answer="",
            created_at=now,
        ),
        _persisted_message(
            message_id=id1,
            conversation_id="conversation-1",
            parent_message_id=UUID_NIL,
            answer="ok",
            created_at=now - timedelta(seconds=1),
        ),
        _persisted_message(
            message_id=str(uuid4()),
            conversation_id="other-conversation",
            parent_message_id=UUID_NIL,
            answer="unrelated",
            created_at=now + timedelta(seconds=1),
        ),
    ]
    sqlite_session.add_all(messages)
    sqlite_session.commit()

    length = get_thread_messages_length("conversation-1", session=sqlite_session)

    assert length == 1


@pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
def test_get_thread_messages_length_keeps_non_empty_latest_answer(sqlite_session: Session) -> None:
    id1, id2 = str(uuid4()), str(uuid4())
    now = datetime.now()
    messages = [
        _persisted_message(
            message_id=id2,
            conversation_id="conversation-2",
            parent_message_id=id1,
            answer="latest-answer",
            created_at=now,
        ),
        _persisted_message(
            message_id=id1,
            conversation_id="conversation-2",
            parent_message_id=UUID_NIL,
            answer="older-answer",
            created_at=now - timedelta(seconds=1),
        ),
    ]
    sqlite_session.add_all(messages)
    sqlite_session.commit()

    length = get_thread_messages_length("conversation-2", session=sqlite_session)

    assert length == 2


def test_get_thread_messages_length_skips_saved_prompt_column(sqlite_engine: Engine, sqlite_session: Session) -> None:
    """Message.message stores each turn's full prompt, so counting the thread must neither select nor lazy-load it."""
    id1, id2 = str(uuid4()), str(uuid4())
    now = datetime.now()
    sqlite_session.add_all(
        [
            _persisted_message(
                message_id=id2,
                conversation_id="conversation-3",
                parent_message_id=id1,
                answer="latest-answer",
                created_at=now,
            ),
            _persisted_message(
                message_id=id1,
                conversation_id="conversation-3",
                parent_message_id=UUID_NIL,
                answer="older-answer",
                created_at=now - timedelta(seconds=1),
            ),
        ]
    )
    sqlite_session.commit()
    # Reload rows from the database instead of reusing fully loaded instances from the identity map.
    sqlite_session.expunge_all()
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        length = get_thread_messages_length("conversation-3", session=sqlite_session)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert length == 2
    message_selects = [sql for sql in statements if "FROM messages" in sql]
    assert len(message_selects) == 1
    assert re.search(r"\bmessages\.message\b", message_selects[0]) is None
