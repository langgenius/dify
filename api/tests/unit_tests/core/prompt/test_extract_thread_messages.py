from collections.abc import Iterator
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from constants import UUID_NIL
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.prompt.utils.get_thread_messages_length import get_thread_messages_length
from models.enums import ConversationFromSource
from models.model import Message


@pytest.fixture
def message_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Create only the legacy Message table and yield its isolated session."""

    Message.__table__.create(sqlite_engine)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


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
        created_at=created_at,
        updated_at=created_at,
    )
    message._inputs = {}
    return message


class MockMessage:
    def __init__(self, id, parent_message_id, answer="answer"):
        self.id = id
        self.parent_message_id = parent_message_id
        self.answer = answer

    def __getitem__(self, item):
        return getattr(self, item)


def test_extract_thread_messages_single_message():
    messages = [MockMessage(str(uuid4()), UUID_NIL)]
    result = extract_thread_messages(messages)
    assert len(result) == 1
    assert result[0] == messages[0]


def test_extract_thread_messages_linear_thread():
    id1, id2, id3, id4, id5 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id5, id4),
        MockMessage(id4, id3),
        MockMessage(id3, id2),
        MockMessage(id2, id1),
        MockMessage(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 5
    assert [msg["id"] for msg in result] == [id5, id4, id3, id2, id1]


def test_extract_thread_messages_branched_thread():
    id1, id2, id3, id4 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id4, id2),
        MockMessage(id3, id2),
        MockMessage(id2, id1),
        MockMessage(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg["id"] for msg in result] == [id4, id2, id1]


def test_extract_thread_messages_empty_list():
    messages = []
    result = extract_thread_messages(messages)
    assert len(result) == 0


def test_extract_thread_messages_partially_loaded():
    id0, id1, id2, id3 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id3, id2),
        MockMessage(id2, id1),
        MockMessage(id1, id0),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg["id"] for msg in result] == [id3, id2, id1]


def test_extract_thread_messages_legacy_messages():
    id1, id2, id3 = str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id3, UUID_NIL),
        MockMessage(id2, UUID_NIL),
        MockMessage(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 3
    assert [msg["id"] for msg in result] == [id3, id2, id1]


def test_extract_thread_messages_mixed_with_legacy_messages():
    id1, id2, id3, id4, id5 = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id5, id4),
        MockMessage(id4, id2),
        MockMessage(id3, id2),
        MockMessage(id2, UUID_NIL),
        MockMessage(id1, UUID_NIL),
    ]
    result = extract_thread_messages(messages)
    assert len(result) == 4
    assert [msg["id"] for msg in result] == [id5, id4, id2, id1]


def test_extract_thread_messages_breaks_when_parent_is_none():
    id1, id2 = str(uuid4()), str(uuid4())
    messages = [MockMessage(id2, None), MockMessage(id1, UUID_NIL)]

    result = extract_thread_messages(messages)

    assert len(result) == 1
    assert result[0].id == id2


def test_get_thread_messages_length_excludes_newly_created_empty_answer(message_session: Session):
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
    message_session.add_all(messages)
    message_session.commit()

    length = get_thread_messages_length("conversation-1", session=message_session)

    assert length == 1


def test_get_thread_messages_length_keeps_non_empty_latest_answer(message_session: Session):
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
    message_session.add_all(messages)
    message_session.commit()

    length = get_thread_messages_length("conversation-2", session=message_session)

    assert length == 2
