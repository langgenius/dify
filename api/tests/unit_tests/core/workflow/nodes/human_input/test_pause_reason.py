import json
from datetime import datetime
from typing import Any

import pytest
from pydantic import TypeAdapter

from core.app.entities.task_entities import HumanInputRequiredResponse
from core.entities.execution_extra_content import (
    HumanInputContent,
    HumanInputFormDefinition,
)
from core.repositories.human_input_repository import HumanInputFormRecord
from core.workflow.human_input_policy import FormDisposition, enrich_human_input_pause_reasons
from core.workflow.nodes.human_input.boundary import build_human_input_pause_reason, human_input_container_selector
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    FormInputConfig,
    HumanInputNodeData,
    SelectInputConfig,
    StringListSource,
)
from core.workflow.nodes.human_input.enums import (
    ButtonStyle,
    HumanInputFormKind,
    HumanInputFormStatus,
    TimeoutUnit,
    ValueSourceType,
)
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType, HumanInputRequired
from core.workflow.nodes.human_input.session_binding import SessionBinding
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import RuntimeState, VariablePool
from models.human_input import HumanInputForm

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


def test_build_pause_reason_keeps_constant_options_from_child_form():
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
    record = HumanInputFormRecord.from_models(
        HumanInputForm(
            id="form-123",
            tenant_id="tenant",
            app_id="app",
            workflow_run_id="run",
            node_id="human-input",
            form_kind=HumanInputFormKind.RUNTIME,
            form_definition=definition.model_dump_json(),
            rendered_content=definition.rendered_content,
            created_at=datetime(2026, 1, 1),
            expiration_time=definition.expiration_time,
            status=HumanInputFormStatus.WAITING,
        ),
        None,
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


def test_child_forms_keep_distinct_identity_when_projected_to_the_same_visible_tool():
    definition = FormDefinition(
        form_content="Approval",
        rendered_content="Approval",
        node_title="Approval",
        expiration_time=datetime(2026, 1, 2),
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    reasons = [
        HitlRequired(session_id=form_id, node_id="source-human", node_title="Approval")
        for form_id in ("form-a", "form-b")
    ]
    for reason in reasons:
        state.variable_pool.add(human_input_container_selector(reason.session_id), "visible-tool")
    restored = RuntimeState.from_snapshot(state.dumps())

    enriched = [
        build_human_input_pause_reason(
            reason=reason,
            record=HumanInputFormRecord.from_models(
                HumanInputForm(
                    id=reason.session_id,
                    tenant_id="tenant",
                    app_id="app",
                    workflow_run_id="run",
                    node_id="source-human",
                    form_kind=HumanInputFormKind.RUNTIME,
                    form_definition=definition.model_dump_json(),
                    rendered_content=reason.session_id,
                    created_at=datetime(2026, 1, 1),
                    expiration_time=definition.expiration_time,
                    status=HumanInputFormStatus.WAITING,
                ),
                None,
            ),
            variable_pool=restored.variable_pool,
        )
        for reason in reasons
    ]

    assert [(reason.form_id, reason.node_id) for reason in enriched] == [
        ("form-a", "visible-tool"),
        ("form-b", "visible-tool"),
    ]
    assert all(reason.node_id == "source-human" for reason in reasons)


def _legacy_form_input_payloads() -> list[dict[str, Any]]:
    return [
        {
            "type": "paragraph",
            "output_variable_name": "name",
            "default": {
                "type": "constant",
                "selector": [],
                "value": "Alice",
            },
        },
        {
            "type": "select",
            "output_variable_name": "decision",
            "option_source": {
                "type": "constant",
                "selector": [],
                "value": ["approve", "reject"],
            },
        },
        {
            "type": "file",
            "output_variable_name": "attachment",
            "allowed_file_types": ["document"],
            "allowed_file_extensions": [],
            "allowed_file_upload_methods": ["remote_url"],
        },
        {
            "type": "file-list",
            "output_variable_name": "attachments",
            "allowed_file_types": ["document"],
            "allowed_file_extensions": [],
            "allowed_file_upload_methods": ["remote_url"],
            "number_limits": 3,
        },
        {
            "type": "paragraph",
            "output_variable_name": "summary",
            "default": None,
        },
    ]


def _legacy_user_action_payloads() -> list[dict[str, Any]]:
    return [
        {
            "id": "approve",
            "title": "Approve",
            "button_style": "primary",
        },
        {
            "id": "reject",
            "title": "Reject",
            "button_style": "default",
        },
    ]


def _validate_legacy_json(model_class: type, payload: dict[str, Any]) -> Any:
    adapter = TypeAdapter(model_class)
    return adapter.validate_json(json.dumps(payload))


def test_form_input_accepts_current_serialized_payload() -> None:
    payload = {
        "type": "paragraph",
        "output_variable_name": "name",
        "default": {
            "type": "constant",
            "selector": [],
            "value": "Alice",
        },
    }

    restored = _validate_legacy_json(FormInputConfig, payload)
    assert restored.default is not None
    assert restored.default.type == ValueSourceType.CONSTANT


def test_human_input_node_data_accepts_current_serialized_payload() -> None:
    payload = {
        "type": "human-input",
        "title": "Human Input",
        "form_content": "Hello {{#$output.name#}}",
        "inputs": _legacy_form_input_payloads(),
        "user_actions": _legacy_user_action_payloads(),
        "timeout": 2,
        "timeout_unit": "day",
    }

    restored = _validate_legacy_json(HumanInputNodeData, payload)
    assert restored.inputs[0].output_variable_name == "name"
    assert restored.timeout_unit == TimeoutUnit.DAY


def test_form_definition_accepts_current_serialized_payload() -> None:
    payload = {
        "form_content": "Please confirm",
        "inputs": _legacy_form_input_payloads(),
        "user_actions": _legacy_user_action_payloads(),
        "rendered_content": "Please confirm",
        "expiration_time": "2024-01-01T00:00:00Z",
        "default_values": {"name": "Alice"},
        "node_title": "Human Input",
        "display_in_ui": True,
    }

    restored = _validate_legacy_json(FormDefinition, payload)
    assert restored.inputs[2].output_variable_name == "attachment"
    assert restored.user_actions[0].id == "approve"
    assert restored.user_actions[0].button_style == ButtonStyle.PRIMARY


def test_human_input_required_pause_reason_accepts_current_serialized_payload() -> None:
    payload = {
        "TYPE": "human_input_required",
        "form_id": "form-1",
        "form_content": "Please confirm",
        "inputs": _legacy_form_input_payloads(),
        "actions": _legacy_user_action_payloads(),
        "node_id": "node-1",
        "node_title": "Human Input",
        "resolved_default_values": {"name": "Alice"},
    }

    restored = _validate_legacy_json(HumanInputRequired, payload)
    assert restored.inputs[1].output_variable_name == "decision"
    assert restored.actions[0].id == "approve"
    assert restored.TYPE == "human_input_required"


def test_human_input_form_definition_accepts_current_serialized_payload() -> None:
    payload = {
        "form_id": "form-1",
        "node_id": "node-1",
        "node_title": "Human Input",
        "form_content": "Please confirm",
        "inputs": _legacy_form_input_payloads(),
        "actions": _legacy_user_action_payloads(),
        "display_in_ui": True,
        "form_token": "token-1",
        "resolved_default_values": {"name": "Alice"},
        "expiration_time": 1700000000,
    }

    restored = _validate_legacy_json(HumanInputFormDefinition, payload)
    assert restored.inputs[3].output_variable_name == "attachments"
    assert restored.actions[0].id == "approve"


def test_human_input_content_accepts_current_serialized_payload() -> None:
    payload = {
        "workflow_run_id": "run-1",
        "submitted": True,
        "form_definition": {
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Human Input",
            "form_content": "Please confirm",
            "inputs": _legacy_form_input_payloads(),
            "actions": _legacy_user_action_payloads(),
            "display_in_ui": True,
            "form_token": "token-1",
            "resolved_default_values": {"name": "Alice"},
            "expiration_time": 1700000000,
        },
        "form_submission_data": {
            "node_id": "node-1",
            "node_title": "Human Input",
            "rendered_content": "Please confirm",
            "action_id": "approve",
            "action_text": "Approve",
        },
        "type": "human_input",
    }

    restored = _validate_legacy_json(HumanInputContent, payload)
    assert restored.form_definition is not None
    assert restored.form_definition.inputs[0].output_variable_name == "name"


def test_human_input_content_accepts_current_serialized_payload_with_form_data() -> None:
    payload = {
        "workflow_run_id": "run-1",
        "submitted": True,
        "form_definition": {
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Human Input",
            "form_content": "Please confirm",
            "inputs": [
                {
                    "type": "select",
                    "output_variable_name": "decision",
                    "option_source": {"type": "constant", "selector": [], "value": ["approve", "reject"]},
                },
                {
                    "type": "file",
                    "output_variable_name": "attachment",
                    "allowed_file_types": ["document"],
                    "allowed_file_extensions": [],
                    "allowed_file_upload_methods": ["remote_url"],
                },
                {
                    "type": "file-list",
                    "output_variable_name": "attachments",
                    "allowed_file_types": ["document"],
                    "allowed_file_extensions": [],
                    "allowed_file_upload_methods": ["remote_url"],
                    "number_limits": 3,
                },
            ],
            "actions": _legacy_user_action_payloads(),
            "display_in_ui": True,
            "form_token": "token-1",
            "resolved_default_values": {"decision": "approve"},
            "expiration_time": 1700000000,
        },
        "form_submission_data": {
            "node_id": "node-1",
            "node_title": "Human Input",
            "rendered_content": "Please confirm",
            "action_id": "approve",
            "action_text": "Approve",
            "submitted_data": {
                "decision": "approve",
                "attachment": {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/file.txt",
                    "filename": "file.txt",
                    "extension": ".txt",
                    "mime_type": "text/plain",
                },
                "attachments": [
                    {
                        "type": "document",
                        "transfer_method": "remote_url",
                        "remote_url": "https://example.com/first.txt",
                        "filename": "first.txt",
                        "extension": ".txt",
                        "mime_type": "text/plain",
                    }
                ],
            },
        },
        "type": "human_input",
    }

    restored = HumanInputContent.model_validate_json(json.dumps(payload))
    assert restored.form_submission_data is not None
    assert restored.form_submission_data.submitted_data == payload["form_submission_data"]["submitted_data"]


def test_human_input_content_accepts_legacy_serialized_payload_with_form_data() -> None:
    payload = {
        "workflow_run_id": "run-1",
        "submitted": True,
        "form_definition": {
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Human Input",
            "form_content": "Please confirm",
            "inputs": _legacy_form_input_payloads(),
            "actions": _legacy_user_action_payloads(),
            "display_in_ui": True,
            "form_token": "token-1",
            "resolved_default_values": {"decision": "approve"},
            "expiration_time": 1700000000,
        },
        "form_submission_data": {
            "node_id": "node-1",
            "node_title": "Human Input",
            "rendered_content": "Please confirm",
            "action_id": "approve",
            "action_text": "Approve",
            "form_data": {
                "decision": "approve",
                "attachment": {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/file.txt",
                    "filename": "file.txt",
                    "extension": ".txt",
                    "mime_type": "text/plain",
                },
            },
        },
        "type": "human_input",
    }

    restored = HumanInputContent.model_validate_json(json.dumps(payload))
    assert restored.form_submission_data is not None
    assert restored.form_submission_data.submitted_data is None


def test_human_input_required_response_accepts_current_serialized_payload() -> None:
    payload = {
        "event": "human_input_required",
        "task_id": "task-1",
        "workflow_run_id": "run-1",
        "data": {
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Human Input",
            "form_content": "Please confirm",
            "inputs": _legacy_form_input_payloads(),
            "actions": _legacy_user_action_payloads(),
            "display_in_ui": True,
            "form_token": "token-1",
            "resolved_default_values": {"name": "Alice"},
            "expiration_time": 1700000000,
        },
    }

    restored = _validate_legacy_json(HumanInputRequiredResponse, payload)
    assert restored.data.inputs[1].output_variable_name == "decision"
    assert restored.data.actions[0].id == "approve"
    assert restored.event == "human_input_required"


def test_session_binding_identity_mapping() -> None:
    binding = SessionBinding()

    assert binding.issue_session_id_for_form(form_id="form-1") == "form-1"
    assert binding.resolve_form_id_from_session_id(session_id="form-1") == "form-1"
