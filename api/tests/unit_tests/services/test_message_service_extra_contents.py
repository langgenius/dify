from __future__ import annotations

import pytest

from core.entities.execution_extra_content import HumanInputContent
from services import message_service


class _FakeMessage:
    def __init__(self, message_id: str):
        self.id = message_id
        self.extra_contents = None

    def set_extra_contents(self, contents):
        self.extra_contents = contents


def test_attach_message_extra_contents_assigns_serialized_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    messages = [_FakeMessage("msg-1"), _FakeMessage("msg-2")]
    repo = type(
        "Repo",
        (),
        {
            "get_by_message_ids": lambda _self, message_ids: [
                [
                    HumanInputContent(
                        action_id="approve",
                        action_text="Approve",
                        rendered_content="Rendered",
                    )
                ],
                [],
            ]
        },
    )()

    monkeypatch.setattr(message_service, "_create_execution_extra_content_repository", lambda: repo)

    message_service._attach_message_extra_contents(messages)

    assert messages[0].extra_contents == [
        {
            "type": "human_input_result",
            "action_id": "approve",
            "action_text": "Approve",
            "rendered_content": "Rendered",
        }
    ]
    assert messages[1].extra_contents == []
