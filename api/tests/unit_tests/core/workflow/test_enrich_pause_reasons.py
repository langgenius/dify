import pytest

from core.workflow.human_input_policy import FormDisposition, enrich_human_input_pause_reasons
from graphon.entities.pause_reason import PauseReasonType

_HITL_REQUIRED_REASON = {"TYPE": PauseReasonType.HITL_REQUIRED, "session_id": "session-1"}


@pytest.mark.parametrize(
    ("dispositions", "expected_token", "expected_channels"),
    [
        ({"f1": FormDisposition(form_token=None, approval_channels=["console", "email"])}, None, ["console", "email"]),
        ({"f1": FormDisposition(form_token="tok", approval_channels=[])}, "tok", []),
        # form_id absent from the map (no recipient rows) falls back to no token, no channels.
        ({}, None, []),
    ],
)
def test_enrich_projects_disposition_onto_reason(dispositions, expected_token, expected_channels):
    out = enrich_human_input_pause_reasons(
        [dict(_HITL_REQUIRED_REASON)],
        dispositions_by_form_id=dispositions,
        expiration_times_by_form_id={},
        form_ids_by_session_id={"session-1": "f1"},
    )

    assert out[0]["form_id"] == "f1"
    assert out[0]["form_token"] == expected_token
    assert out[0]["approval_channels"] == expected_channels
    assert "session_id" not in out[0]


def test_enrich_hitl_required_without_session_mapping_keeps_no_form_fields():
    out = enrich_human_input_pause_reasons(
        [dict(_HITL_REQUIRED_REASON)],
        dispositions_by_form_id={"f1": FormDisposition(form_token="tok", approval_channels=["console"])},
        expiration_times_by_form_id={"f1": 123},
        form_ids_by_session_id={},
    )

    assert "form_id" not in out[0]
    assert "form_token" not in out[0]
    assert "approval_channels" not in out[0]
    assert "expiration_time" not in out[0]
    assert "session_id" not in out[0]


def test_enrich_leaves_non_human_input_reasons_untouched():
    reason = {"TYPE": "something_else", "form_id": "f1"}

    out = enrich_human_input_pause_reasons(
        [reason],
        dispositions_by_form_id={"f1": FormDisposition(form_token="tok", approval_channels=["email"])},
        expiration_times_by_form_id={},
    )

    assert out[0] == reason
    assert "form_token" not in out[0]
    assert "approval_channels" not in out[0]


def test_pause_reason_payload_carries_approval_channels_through_factory():
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

    assert payload.TYPE == "human_input_required"
    assert payload.approval_channels == ["console"]
    assert payload.form_token is None
