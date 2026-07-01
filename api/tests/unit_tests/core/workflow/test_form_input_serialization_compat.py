import json
from typing import Any

from pydantic import TypeAdapter

from core.app.entities.task_entities import HumanInputRequiredResponse
from core.entities.execution_extra_content import (
    HumanInputContent,
    HumanInputFormDefinition,
)
from graphon.entities.pause_reason import HumanInputRequired
from graphon.nodes.human_input.entities import (
    FormDefinition,
    FormInputConfig,
    HumanInputNodeData,
)
from graphon.nodes.human_input.enums import ButtonStyle, TimeoutUnit, ValueSourceType


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
