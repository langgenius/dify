from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import FormDisposition, enrich_human_input_pause_reasons
from core.workflow.nodes.human_input.boundary import enrich_graph_pause_reasons, human_input_container_selector
from core.workflow.nodes.human_input.entities import SelectInputConfig, StringListSource
from core.workflow.nodes.human_input.enums import ValueSourceType
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import RuntimeState, VariablePool

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


def test_enrich_graph_pause_reasons_keeps_constant_options_from_child_form():
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
                        type=ValueSourceType.CONSTANT,
                        value=[],
                    ),
                )
            ],
            user_actions=[],
            node_title="Choose",
            default_values={},
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
    assert reason.inputs[0].option_source.type == ValueSourceType.CONSTANT
    assert reason.inputs[0].option_source.value == []


def test_child_forms_keep_distinct_identity_when_projected_to_the_same_visible_tool():
    form_repository = Mock(spec=HumanInputFormSubmissionRepository)
    form_repository.get_by_form_id.side_effect = lambda form_id: SimpleNamespace(
        form_id=form_id,
        node_id="source-human",
        rendered_content=form_id,
        definition=SimpleNamespace(inputs=[], user_actions=[], node_title="Approval", default_values={}),
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    reasons = [
        HitlRequired(session_id=form_id, node_id="source-human", node_title="Approval")
        for form_id in ("form-a", "form-b")
    ]
    for reason in reasons:
        state.variable_pool.add(human_input_container_selector(reason.session_id), "visible-tool")
    restored = RuntimeState.from_snapshot(state.dumps())

    enriched = enrich_graph_pause_reasons(
        reasons=reasons,
        form_repository=form_repository,
        variable_pool=restored.variable_pool,
    )

    assert [(reason.form_id, reason.node_id) for reason in enriched] == [
        ("form-a", "visible-tool"),
        ("form-b", "visible-tool"),
    ]
    assert all(reason.node_id == "source-human" for reason in reasons)
