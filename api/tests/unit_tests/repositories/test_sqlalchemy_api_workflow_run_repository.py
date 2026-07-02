from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from core.workflow.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import FormInputType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import HitlRequired, PauseReasonType
from models.human_input import RecipientType
from models.workflow import WorkflowPauseReason
from repositories.sqlalchemy_api_workflow_run_repository import (
    _PrivateWorkflowPauseEntity,
    _build_human_input_required_reason,
)


def _build_form_model() -> SimpleNamespace:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    definition = FormDefinition(
        form_content="content",
        inputs=[ParagraphInputConfig(type=FormInputType.PARAGRAPH, output_variable_name="name")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
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
        rendered_content="rendered",
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
    assert reason.form_content == "rendered"
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


def test_workflow_pause_reason_from_entity_persists_hitl_type_for_dify_human_input() -> None:
    reason_model = WorkflowPauseReason.from_entity(
        pause_id="pause-1",
        pause_reason=HumanInputRequired(
            form_id="form-1",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-1",
            node_title="Ask Name",
        ),
    )

    assert reason_model.type_ == PauseReasonType.HITL_REQUIRED
    assert reason_model.form_id == "form-1"
    assert reason_model.node_id == "node-1"


def test_workflow_pause_reason_to_entity_restores_graphon_hitl_reason() -> None:
    reason_model = WorkflowPauseReason(
        pause_id="pause-1",
        type_=PauseReasonType.HITL_REQUIRED,
        form_id="form-1",
        node_id="node-1",
    )

    reason = reason_model.to_entity()

    assert isinstance(reason, HitlRequired)
    assert reason.TYPE == PauseReasonType.HITL_REQUIRED
    assert reason.session_id == "form-1"
    assert reason.node_id == "node-1"


def test_private_workflow_pause_entity_preserves_list_shaped_pause_reasons() -> None:
    pause_reasons = [
        HumanInputRequired(
            form_id="form-1",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-1",
            node_title="Ask Name",
        )
    ]
    entity = _PrivateWorkflowPauseEntity(
        pause_model=SimpleNamespace(
            id="pause-1",
            workflow_run_id="run-1",
            resumed_at=None,
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
        ),
        reason_models=[],
        pause_reasons=pause_reasons,
    )

    result = entity.get_pause_reasons()

    assert isinstance(result, list)
    assert result == pause_reasons
