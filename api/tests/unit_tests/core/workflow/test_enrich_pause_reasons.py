from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.human_input_policy import FormDisposition, enrich_human_input_pause_reasons
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType
from enums.human_input import ApprovalChannel, HumanInputFormKind, HumanInputFormStatus, ValueSourceType
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import VariablePool
from models.human_input_contracts import HumanInputFormRecord
from models.human_input_entities import FormDefinition, SelectInputConfig, StringListSource
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from services.workflow.execution.adapters.human_input_events import (
    build_human_input_pause_reason,
    enrich_graph_pause_reasons,
)

_HUMAN_INPUT_REASON = {"TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED, "form_id": "f1"}


@pytest.mark.parametrize(
    ("dispositions", "expected_token", "expected_channels"),
    [
        (
            {
                "f1": FormDisposition(
                    form_token=None,
                    approval_channels=[ApprovalChannel.CONSOLE, ApprovalChannel.EMAIL],
                )
            },
            None,
            [ApprovalChannel.CONSOLE, ApprovalChannel.EMAIL],
        ),
        ({"f1": FormDisposition(form_token="tok", approval_channels=[])}, "tok", []),
        # form_id absent from the map (no recipient rows) falls back to no token, no channels.
        ({}, None, []),
    ],
)
def test_enrich_projects_disposition_onto_reason(
    dispositions: dict[str, FormDisposition],
    expected_token: str | None,
    expected_channels: list[ApprovalChannel],
) -> None:
    out = enrich_human_input_pause_reasons(
        [dict(_HUMAN_INPUT_REASON)],
        dispositions_by_form_id=dispositions,
        expiration_times_by_form_id={},
    )

    assert out[0]["form_token"] == expected_token
    assert out[0]["approval_channels"] == expected_channels


def test_enrich_leaves_non_human_input_reasons_untouched() -> None:
    reason = {"TYPE": "something_else", "form_id": "f1"}

    out = enrich_human_input_pause_reasons(
        [reason],
        dispositions_by_form_id={"f1": FormDisposition(form_token="tok", approval_channels=[ApprovalChannel.EMAIL])},
        expiration_times_by_form_id={},
    )

    assert out[0] == reason
    assert "form_token" not in out[0]
    assert "approval_channels" not in out[0]


def test_pause_reason_payload_carries_approval_channels_through_factory() -> None:
    # from_response_data maps fields by hand; this guards approval_channels/form_token
    # (the fields this feature added) against being dropped in that mapping.
    from core.app.entities.task_entities import (
        HumanInputRequiredPauseReasonPayload,
        HumanInputRequiredResponse,
    )

    data = HumanInputRequiredResponse.Data(
        form_id="f",
        node_id="n",
        node_title="t",
        form_content="c",
        expiration_time=123,
        form_token=None,
        approval_channels=["console"],
    )
    payload = HumanInputRequiredPauseReasonPayload.from_response_data(data)

    assert payload.approval_channels == ["console"]
    assert payload.form_token is None


def test_build_pause_reason_keeps_constant_options_from_materialized_form() -> None:
    definition = FormDefinition(
        form_content="Choose",
        rendered_content="Choose",
        inputs=[
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.CONSTANT, value=[]),
            )
        ],
        node_title="Choose",
        expiration_time=datetime(2026, 1, 2),
    )
    record = HumanInputFormRecord(
        form_id="form-123",
        workflow_run_id="run",
        conversation_id=None,
        node_id="human-input",
        tenant_id="tenant",
        app_id="app",
        form_kind=HumanInputFormKind.RUNTIME,
        definition=definition,
        rendered_content=definition.rendered_content,
        created_at=datetime(2026, 1, 1),
        expiration_time=definition.expiration_time,
        status=HumanInputFormStatus.WAITING,
        selected_action_id=None,
        submitted_data=None,
        submitted_at=None,
        submission_user_id=None,
        submission_end_user_id=None,
        completed_by_recipient_id=None,
        recipient_id=None,
        recipient_type=None,
        access_token=None,
    )
    parent_pool = VariablePool()
    parent_pool.add(("start", "options"), ["wrong"])

    reason = build_human_input_pause_reason(
        reason=HitlRequired(session_id="form-123", node_id="human-input", node_title="Choose"),
        record=record,
        variable_pool=parent_pool,
    )

    assert isinstance(reason.inputs[0], SelectInputConfig)
    assert reason.inputs[0].option_source.type == ValueSourceType.CONSTANT
    assert reason.inputs[0].option_source.value == []


def test_enrich_graph_pause_reasons_raises_when_hitl_form_record_is_missing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    form_repository = HumanInputFormSubmissionRepository(sessions=sqlite_session_factory)

    with pytest.raises(LookupError, match="form-123"):
        enrich_graph_pause_reasons(
            reasons=[HitlRequired(session_id="form-123", node_id="node-1", node_title="Ask Name")],
            form_repository=form_repository,
            variable_pool=None,
        )
