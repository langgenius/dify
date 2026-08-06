from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast

import pytest

from core.ops.unified_trace.human_wait import HumanWaitRecord
from core.repositories.human_input_repository import HumanInputFormEntity
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from models.human_input import HumanInputForm

START = datetime(2026, 7, 29, tzinfo=UTC)
END = START + timedelta(minutes=1)


def test_human_wait_uses_form_creation_and_submission_times() -> None:
    form = HumanInputForm(
        id="form-1",
        created_at=START,
        updated_at=END,
        submitted_at=END,
        status=HumanInputFormStatus.SUBMITTED,
        rendered_content="Need approval",
        submitted_data='{"approved": true}',
    )

    record = HumanWaitRecord.from_form(form, owner_kind="agent_node", owner_id="node-exec-1")

    assert record.start_time == START
    assert record.end_time == END
    assert record.outcome == "submitted"
    assert record.output == {"approved": True}


def test_human_wait_does_not_export_private_delivery_values() -> None:
    form = cast(
        HumanInputFormEntity,
        SimpleNamespace(
            id="form-1",
            created_at=START,
            status=HumanInputFormStatus.WAITING,
            rendered_content="Need approval",
            submitted_data=None,
            access_token="private",
            recipient_payload="private",
        ),
    )

    record = HumanWaitRecord.from_form(form, owner_kind="agent_message", owner_id="message-1")

    assert "private" not in record.model_dump_json()


def test_timed_out_human_wait_uses_repository_record_and_transition_time() -> None:
    # Deferred from v1: this path depends on the HumanInputFormRecord ``updated_at`` field
    # added by the human-wait tracing work (see ADR-0001 "Out of scope (v1)"). It is
    # skipped until that field is re-introduced alongside human-wait tracing.
    pytest.skip("human-wait tracing is deferred from unified tracing v1")


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
