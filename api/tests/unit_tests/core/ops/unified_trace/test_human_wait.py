from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from core.ops.unified_trace.human_wait import HumanWaitRecord

START = datetime(2026, 7, 29, tzinfo=UTC)
END = START + timedelta(minutes=1)


def test_human_wait_uses_form_creation_and_submission_times() -> None:
    form = SimpleNamespace(
        id="form-1",
        created_at=START,
        submitted_at=END,
        status="submitted",
        rendered_content="Need approval",
        submitted_data='{"approved": true}',
    )

    record = HumanWaitRecord.from_form(form, owner_kind="agent_node", owner_id="node-exec-1")

    assert record.start_time == START
    assert record.end_time == END
    assert record.outcome == "submitted"
    assert record.output == {"approved": True}


def test_human_wait_does_not_export_private_delivery_values() -> None:
    form = SimpleNamespace(
        id="form-1",
        created_at=START,
        submitted_at=None,
        status="waiting",
        rendered_content="Need approval",
        submitted_data=None,
        access_token="private",
        recipient_payload="private",
    )

    record = HumanWaitRecord.from_form(form, owner_kind="agent_message", owner_id="message-1")

    assert "private" not in record.model_dump_json()


def test_timed_out_human_wait_uses_repository_record_and_transition_time() -> None:
    form = SimpleNamespace(
        form_id="form-1",
        created_at=START,
        submitted_at=None,
        updated_at=END,
        status="timeout",
        rendered_content="Need approval",
        submitted_data=None,
    )

    record = HumanWaitRecord.from_form(form, owner_kind="workflow_node", owner_id="node-1")

    assert record.wait_id == "form-1"
    assert record.end_time == END
    assert record.outcome == "timed_out"


def test_resumed_agent_message_wait_is_point_span_with_duration_and_link() -> None:
    wait = HumanWaitRecord(
        wait_id="form-1",
        owner_id="message-1",
        owner_kind="agent_message",
        start_time=START,
        end_time=END,
        outcome="submitted",
    )

    resumed = wait.with_phase(
        "resumed",
        message_id="message-2",
        linked_message_id="message-1",
    )

    assert resumed.owner_id == "message-2"
    assert resumed.start_time == END
    assert resumed.end_time == END
    assert resumed.wait_duration_ms == 60_000
    assert resumed.linked_message_id == "message-1"
