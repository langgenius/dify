from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import FormDisposition, enrich_human_input_pause_reasons
from core.workflow.nodes.human_input.boundary import enrich_graph_pause_reasons
from core.workflow.nodes.human_input.entities import SelectInputConfig, StringListSource
from core.workflow.nodes.human_input.enums import ValueSourceType
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import VariablePool

_HUMAN_INPUT_REASON = {"TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED, "form_id": "f1"}


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
        [dict(_HUMAN_INPUT_REASON)],
        dispositions_by_form_id=dispositions,
        expiration_times_by_form_id={},
    )

    assert out[0]["form_token"] == expected_token
    assert out[0]["approval_channels"] == expected_channels


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

    assert payload.approval_channels == ["console"]
    assert payload.form_token is None


def test_enrich_graph_pause_reasons_raises_when_hitl_form_record_is_missing():
    form_repository = Mock(spec=HumanInputFormSubmissionRepository)
    form_repository.get_by_form_id.return_value = None

    with pytest.raises(LookupError, match="form-123"):
        enrich_graph_pause_reasons(
            reasons=[
                HitlRequired(
                    session_id="form-123",
                    node_id="node-1",
                    node_title="Ask Name",
                )
            ],
            form_repository=form_repository,
            variable_pool=None,
        )


def test_enrich_graph_pause_reasons_keeps_options_resolved_in_child_pool():
    form_repository = Mock(spec=HumanInputFormSubmissionRepository)
    form_repository.get_by_form_id.return_value = SimpleNamespace(
        form_id="form-123",
        node_id="human-input",
        rendered_content="Choose",
        definition=SimpleNamespace(
            inputs=[
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(
                        type=ValueSourceType.VARIABLE,
                        selector=["start", "options"],
                        value=[],
                    ),
                )
            ],
            user_actions=[],
            node_title="Choose",
            default_values={},
            select_options_resolved=True,
        ),
    )
    parent_pool = VariablePool()
    parent_pool.add(("start", "options"), ["wrong"])

    [reason] = enrich_graph_pause_reasons(
        reasons=[HitlRequired(session_id="form-123", node_id="human-input", node_title="Choose")],
        form_repository=form_repository,
        variable_pool=parent_pool,
    )

    assert isinstance(reason.inputs[0], SelectInputConfig)
    assert reason.inputs[0].option_source.value == []
    assert reason.select_options_resolved is True
    assert "select_options_resolved" not in reason.model_dump()
