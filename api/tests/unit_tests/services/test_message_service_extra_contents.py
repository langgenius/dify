from __future__ import annotations

import pytest

from core.entities.execution_extra_content import HumanInputContent, HumanInputFormSubmissionData
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
                        workflow_run_id="workflow-run-1",
                        submitted=True,
                        form_submission_data=HumanInputFormSubmissionData(
                            node_id="node-1",
                            node_title="Approval",
                            rendered_content="Rendered",
                            action_id="approve",
                            action_text="Approve",
                        ),
                    )
                ],
                [],
            ]
        },
    )()

    monkeypatch.setattr(message_service, "_create_execution_extra_content_repository", lambda: repo)

    message_service.attach_message_extra_contents(messages)

    assert messages[0].extra_contents == [
        {
            "type": "human_input",
            "workflow_run_id": "workflow-run-1",
            "submitted": True,
            "form_submission_data": {
                "node_id": "node-1",
                "node_title": "Approval",
                "rendered_content": "Rendered",
                "action_id": "approve",
                "action_text": "Approve",
            },
        }
    ]
    assert messages[1].extra_contents == []
