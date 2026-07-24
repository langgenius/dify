from unittest.mock import MagicMock
from uuid import uuid4

from constants import UUID_NIL
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.prompt.utils.get_thread_messages_length import get_thread_messages_length


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


def test_extract_thread_messages_ignores_unrelated_regeneration_root():
    # An earlier regeneration can leave a parent_message_id=None message in the
    # same conversation that isn't an ancestor of the thread being walked. The
    # unconditional "no parent" check must not grab it and stop the walk early.
    id_a, id_b, id_c, id_x = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id_c, id_b),
        MockMessage(id_x, None),  # unrelated regeneration root, not an ancestor of C
        MockMessage(id_b, id_a),
        MockMessage(id_a, None),  # true root of C's thread
    ]

    result = extract_thread_messages(messages)

    assert [msg.id for msg in result] == [id_c, id_b, id_a]


def test_get_thread_messages_length_excludes_newly_created_empty_answer():
    id1, id2 = str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id2, id1, answer=""),  # newest generated message should be excluded
        MockMessage(id1, UUID_NIL, answer="ok"),
    ]

    session = MagicMock()
    session.scalars.return_value.all.return_value = messages

    length = get_thread_messages_length("conversation-1", session=session)

    assert length == 1
    session.scalars.assert_called_once()


def test_get_thread_messages_length_keeps_non_empty_latest_answer():
    id1, id2 = str(uuid4()), str(uuid4())
    messages = [
        MockMessage(id2, id1, answer="latest-answer"),
        MockMessage(id1, UUID_NIL, answer="older-answer"),
    ]

    session = MagicMock()
    session.scalars.return_value.all.return_value = messages

    length = get_thread_messages_length("conversation-2", session=session)

    assert length == 2
    session.scalars.assert_called_once()
