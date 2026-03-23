"""Unit tests for non-SQL helper logic in workflow run repository."""

import secrets
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest

from core.workflow.entities.pause_reason import HumanInputRequired, PauseReasonType
from core.workflow.nodes.human_input.entities import FormDefinition, FormInput, UserAction
from core.workflow.nodes.human_input.enums import FormInputType, HumanInputFormStatus
from models.human_input import BackstageRecipientPayload, HumanInputForm, HumanInputFormRecipient, RecipientType
from models.workflow import WorkflowPause as WorkflowPauseModel
from models.workflow import WorkflowPauseReason
from repositories.sqlalchemy_api_workflow_run_repository import (
    _build_human_input_required_reason,
    _PrivateWorkflowPauseEntity,
)


@pytest.fixture
def sample_workflow_pause() -> Mock:
    """Create a sample WorkflowPause model."""
    pause = Mock(spec=WorkflowPauseModel)
    pause.id = "pause-123"
    pause.workflow_id = "workflow-123"
    pause.workflow_run_id = "workflow-run-123"
    pause.state_object_key = "workflow-state-123.json"
    pause.resumed_at = None
    pause.created_at = datetime.now(UTC)
    return pause


class TestPrivateWorkflowPauseEntity:
    """Test _PrivateWorkflowPauseEntity class."""

    def test_properties(self, sample_workflow_pause: Mock) -> None:
        """Test entity properties."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])

        # Assert
        assert entity.id == sample_workflow_pause.id
        assert entity.workflow_execution_id == sample_workflow_pause.workflow_run_id
        assert entity.resumed_at == sample_workflow_pause.resumed_at

    def test_get_state(self, sample_workflow_pause: Mock) -> None:
        """Test getting state from storage."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])
        expected_state = b'{"test": "state"}'

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = expected_state

            # Act
            result = entity.get_state()

            # Assert
            assert result == expected_state
            mock_storage.load.assert_called_once_with(sample_workflow_pause.state_object_key)

    def test_get_state_caching(self, sample_workflow_pause: Mock) -> None:
        """Test state caching in get_state method."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])
        expected_state = b'{"test": "state"}'

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = expected_state

            # Act
            result1 = entity.get_state()
            result2 = entity.get_state()

            # Assert
            assert result1 == expected_state
            assert result2 == expected_state
            mock_storage.load.assert_called_once()


class TestBuildHumanInputRequiredReason:
    """Test helper that builds HumanInputRequired pause reasons."""

    def test_prefers_backstage_token_when_available(self) -> None:
        """Use backstage token when multiple recipient types may exist."""
        # Arrange
        expiration_time = datetime.now(UTC)
        form_definition = FormDefinition(
            form_content="content",
            inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="name")],
            user_actions=[UserAction(id="approve", title="Approve")],
            rendered_content="rendered",
            expiration_time=expiration_time,
            default_values={"name": "Alice"},
            node_title="Ask Name",
            display_in_ui=True,
        )
        form_model = HumanInputForm(
            id="form-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            form_definition=form_definition.model_dump_json(),
            rendered_content="rendered",
            status=HumanInputFormStatus.WAITING,
            expiration_time=expiration_time,
        )
        reason_model = WorkflowPauseReason(
            pause_id="pause-1",
            type_=PauseReasonType.HUMAN_INPUT_REQUIRED,
            form_id="form-1",
            node_id="node-1",
            message="",
        )
        access_token = secrets.token_urlsafe(8)
        backstage_recipient = HumanInputFormRecipient(
            form_id="form-1",
            delivery_id="delivery-1",
            recipient_type=RecipientType.BACKSTAGE,
            recipient_payload=BackstageRecipientPayload().model_dump_json(),
            access_token=access_token,
        )

        # Act
        reason = _build_human_input_required_reason(reason_model, form_model, [backstage_recipient])

        # Assert
        assert isinstance(reason, HumanInputRequired)
        assert reason.form_token == access_token
        assert reason.node_title == "Ask Name"
        assert reason.form_content == "content"
        assert reason.inputs[0].output_variable_name == "name"
        assert reason.actions[0].id == "approve"
