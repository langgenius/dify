from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from graphon.nodes.human_input.entities import FormDefinition, FormInput, UserAction
from graphon.nodes.human_input.enums import FormInputType
from models.human_input import RecipientType
from repositories.sqlalchemy_api_workflow_run_repository import _build_human_input_required_reason


def _build_form_model() -> SimpleNamespace:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    definition = FormDefinition(
        form_content="content",
        inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="name")],
        user_actions=[UserAction(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=expiration_time,
        default_values={"name": "Alice"},
        node_title="Ask Name",
        display_in_ui=True,
    )
    return SimpleNamespace(
        id="form-1",
        node_id="node-1",
        form_definition=definition.model_dump_json(),
        expiration_time=expiration_time,
    )


def _build_reason_model() -> SimpleNamespace:
    return SimpleNamespace(form_id="form-1", node_id="node-1")


def test_build_human_input_required_reason_prefers_standalone_web_app_token() -> None:
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            SimpleNamespace(recipient_type=RecipientType.BACKSTAGE, access_token="btok"),
            SimpleNamespace(recipient_type=RecipientType.CONSOLE, access_token="ctok"),
            SimpleNamespace(recipient_type=RecipientType.STANDALONE_WEB_APP, access_token="wtok"),
        ],
    )

    assert reason.node_title == "Ask Name"
    assert reason.resolved_default_values == {"name": "Alice"}
    assert not hasattr(reason, "form_token")


def test_build_human_input_required_reason_falls_back_to_console_token() -> None:
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            SimpleNamespace(recipient_type=RecipientType.BACKSTAGE, access_token="btok"),
            SimpleNamespace(recipient_type=RecipientType.CONSOLE, access_token="ctok"),
        ],
    )

    assert reason.node_id == "node-1"
    assert reason.actions[0].id == "approve"
    assert not hasattr(reason, "form_token")
