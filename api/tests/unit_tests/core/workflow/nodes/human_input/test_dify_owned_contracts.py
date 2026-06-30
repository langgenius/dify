from __future__ import annotations

import json
from datetime import UTC, datetime

from pydantic import TypeAdapter
import pytest

from core.workflow.nodes.human_input._exc import ExtensionsNotSetErrorValueError
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FormDefinition,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import ButtonStyle, FormInputType, TimeoutUnit, ValueSourceType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired, PauseReasonType
from core.workflow.nodes.human_input.session_binding import SessionBinding
from graphon.file import FileType


def test_session_binding_identity_mapping() -> None:
    binding = SessionBinding()

    assert binding.issue_session_id_for_form(form_id="form-1") == "form-1"
    assert binding.resolve_form_id_from_session_id(session_id="form-1") == "form-1"


def test_human_input_node_contracts_accept_legacy_json_payload() -> None:
    payload = {
        "form_content": "Please confirm",
        "inputs": [
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
        ],
        "user_actions": [
            {
                "id": "approve",
                "title": "Approve",
                "button_style": "primary",
            }
        ],
        "rendered_content": "Please confirm",
        "expiration_time": "2024-01-01T00:00:00Z",
        "default_values": {"name": "Alice"},
        "node_title": "Human Input",
        "display_in_ui": True,
    }

    restored = TypeAdapter(FormDefinition).validate_json(json.dumps(payload))

    assert isinstance(restored.inputs[0], ParagraphInputConfig)
    assert isinstance(restored.inputs[1], SelectInputConfig)
    assert restored.inputs[0].default is not None
    assert restored.inputs[0].default.type == ValueSourceType.CONSTANT
    assert restored.inputs[0].default.value == "Alice"
    assert restored.inputs[1].option_source.type == ValueSourceType.CONSTANT
    assert restored.inputs[1].option_source.value == ["approve", "reject"]
    assert restored.user_actions == [UserActionConfig(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)]


def test_human_input_required_pause_reason_keeps_legacy_payload_shape() -> None:
    payload = {
        "TYPE": "human_input_required",
        "form_id": "form-1",
        "form_content": "Please confirm",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "name",
                "default": {
                    "type": "constant",
                    "selector": [],
                    "value": "Alice",
                },
            }
        ],
        "actions": [
            {
                "id": "approve",
                "title": "Approve",
                "button_style": "primary",
            }
        ],
        "node_id": "node-1",
        "node_title": "Human Input",
        "resolved_default_values": {"name": "Alice"},
    }

    restored = TypeAdapter(HumanInputRequired).validate_json(json.dumps(payload))

    assert restored.TYPE.value == "human_input_required"
    assert restored.actions[0].button_style == ButtonStyle.PRIMARY
    assert restored.model_dump(mode="json")["TYPE"] == "human_input_required"


def test_form_definition_dump_keeps_public_json_shape() -> None:
    definition = FormDefinition(
        form_content="Please confirm",
        inputs=[ParagraphInputConfig(type=FormInputType.PARAGRAPH, output_variable_name="name")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=datetime(2024, 1, 1, tzinfo=UTC),
        default_values={"name": "Alice"},
        node_title="Ask Name",
        display_in_ui=True,
    )

    payload = definition.model_dump(mode="json")

    assert payload["expiration_time"] == "2024-01-01T00:00:00Z"
    assert payload["user_actions"][0]["id"] == "approve"
    assert payload["inputs"][0]["type"] == "paragraph"


def test_custom_file_input_requires_extensions() -> None:
    with pytest.raises(ExtensionsNotSetErrorValueError):
        FileInputConfig(
            output_variable_name="attachment",
            allowed_file_types=[FileType.CUSTOM],
            allowed_file_extensions=[],
        )
