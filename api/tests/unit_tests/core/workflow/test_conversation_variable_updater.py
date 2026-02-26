from __future__ import annotations

from core.workflow.conversation_variable_updater import ConversationVariableUpdater


def test_conversation_variable_updater_protocol_stubs_are_callable() -> None:
    dummy = object()

    assert ConversationVariableUpdater.update(dummy, "conversation-id", variable=object()) is None
    assert ConversationVariableUpdater.flush(dummy) is None
