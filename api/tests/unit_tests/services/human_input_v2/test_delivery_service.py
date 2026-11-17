"""Slack assessment chooses links before sending forms that exceed payload limits."""

from collections.abc import Callable
from urllib.parse import urlsplit

import pytest
import sqlalchemy as sa

from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Contact, HumanInputNodeData
from graphon.enums import WorkflowExecutionStatus
from models.human_input_v2 import HumanInputDelivery, HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
from repositories.human_input_v2.delivery_repository import IMMessageType, IMUserTargetSnapshot, SubmissionAuthType
from services.human_input_v2.delivery_service import HumanInputDeliveryService
from services.human_input_v2.form_service import CreatedForm
from services.human_input_v2.submission_service import HumanInputSubmissionService
from tests.helpers.unit.core.human_input_v2.slack import SlackApiServer, make_slack_adapter
from tests.helpers.unit.services.human_input_v2.form_runtime import (
    ACCOUNT_ID,
    CONTACT_ID,
    FormRuntimeContext,
    add_slack_channel,
    make_form_node,
)


@pytest.mark.parametrize(
    ("lengths", "message_type"),
    [
        ((6_000, 6_000), IMMessageType.CARD),
        ((6_000, 6_001), IMMessageType.LINK),
        ((7_000, 7_000), IMMessageType.LINK),
    ],
)
def test_slack_markdown_limit_selects_delivery_and_preserves_approval(
    context: FormRuntimeContext,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    slack_api_server: SlackApiServer,
    lengths: tuple[int, int],
    message_type: IMMessageType,
) -> None:
    """Deliver a resolved form through Slack; a fallback link submits that same form and recipient."""
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    config_overrides(CONSOLE_WEB_URL="https://console.example.com")
    add_slack_channel(context)
    node = HumanInputNodeData.model_validate(
        make_form_node(Contact(contact_id=CONTACT_ID)).model_dump(mode="json")
        | {
            "form_content": "a" * lengths[0] + "{{#$output.note#}}" + "b" * lengths[1],
            "inputs": [{"type": "paragraph", "output_variable_name": "note"}],
        }
    )
    created = context.prepare(node)
    assert isinstance(created, CreatedForm)
    adapter, _client = make_slack_adapter(monkeypatch, slack_api_server)
    slack_api_server.state.enqueue(
        "chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
    )
    service = HumanInputDeliveryService(
        session_factory=context.sessions, email_client=None, im_adapter_factory=lambda _channel: adapter
    )

    result = service.deliver(
        form=created.form, recipient=created.recipients[0], message_template=created.message_template
    )

    assert [attempt.status for attempt in result.attempts] == [DeliveryStatus.SUCCEEDED]
    requests = slack_api_server.state.requests_for("chat.postMessage")
    assert len(requests) == 1
    sent = requests[0].parameters()
    assert sent["channel"] == "im-user"
    with context.sessions() as session:
        delivery = session.scalars(sa.select(HumanInputDelivery)).one()
        assert delivery.form_id == created.form.id
        assert delivery.recipient_id == created.recipients[0].id
        assert isinstance(delivery.target_snapshot, IMUserTargetSnapshot)
        assert delivery.target_snapshot.message_type == message_type
        assert delivery.target_snapshot.message_locator is not None
        assert delivery.auth_type == (
            SubmissionAuthType.IM if message_type == IMMessageType.CARD else SubmissionAuthType.CONSOLE
        )
        delivery_id = delivery.id

    if message_type == IMMessageType.LINK:
        sent_text = sent["text"]
        assert isinstance(sent_text, str)
        assert sent_text.startswith("Review\n\nOpen https://console.example.com/human-input/")
        token = urlsplit(sent_text.split("Open ", 1)[1]).path.rsplit("/", 1)[1]
        blocks = sent["blocks"]
        assert isinstance(blocks, list)
        assert [block["type"] for block in blocks] == ["markdown", "markdown"]
        with context.sessions.begin() as session:
            run = session.get_one(WorkflowRun, created.form.workflow_run_id)
            run.status = WorkflowExecutionStatus.PAUSED
            session.add(
                WorkflowPause(
                    workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="approval-checkpoint"
                )
            )
        resumed: list[str] = []

        def publish_resume(*, kwargs: dict[str, dict[str, str]]) -> None:
            resumed.append(kwargs["payload"]["workflow_run_id"])

        monkeypatch.setattr(resume_app_execution, "apply_async", publish_resume)
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=ACCOUNT_ID, form_token=token, action="approve", inputs={"note": "Approved"}
        )
        with context.sessions() as session:
            submitted = session.get_one(HumanInputForm, created.form.id)
            assert submitted.status == HumanInputFormStatus.SUBMITTED
            assert submitted.selected_action_id == "approve"
            assert submitted.submitted_by_recipient_id == created.recipients[0].id
            assert submitted.submitted_by_delivery_id == delivery_id
        assert resumed == [created.form.workflow_run_id]
    else:
        blocks = sent["blocks"]
        assert isinstance(blocks, list)
        assert [block["type"] for block in blocks] == ["header", "markdown", "input", "markdown", "actions"]
