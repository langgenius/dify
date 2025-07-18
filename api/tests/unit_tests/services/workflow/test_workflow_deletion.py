from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.model import App
from models.workflow import Workflow
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService


@pytest.fixture
def workflow_setup():
    mock_session_maker = MagicMock()
    workflow_service = WorkflowService(mock_session_maker)
    session = MagicMock(spec=Session)
    tenant_id = "test-tenant-id"
    workflow_id = "test-workflow-id"

    # Mock workflow
    workflow = MagicMock(spec=Workflow)
    workflow.id = workflow_id
    workflow.tenant_id = tenant_id
    workflow.version = "1.0"  # Not a draft
    workflow.tool_published = False  # Not published as a tool by default

    # Mock app
    app = MagicMock(spec=App)
    app.id = "test-app-id"
    app.name = "Test App"
    app.workflow_id = None  # Not used by an app by default

    return {
        "workflow_service": workflow_service,
        "session": session,
        "tenant_id": tenant_id,
        "workflow_id": workflow_id,
        "workflow": workflow,
        "app": app,
    }


def test_delete_workflow_success(workflow_setup):
    # Setup mocks

    # Mock the tool provider query to return None (not published as a tool)
    workflow_setup["session"].query.return_value.filter.return_value.first.return_value = None

    workflow_setup["session"].scalar = MagicMock(
        side_effect=[workflow_setup["workflow"], None]
    )  # Return workflow first, then None for app

    # Call the method
    result = workflow_setup["workflow_service"].delete_workflow(
        session=workflow_setup["session"],
        workflow_id=workflow_setup["workflow_id"],
        tenant_id=workflow_setup["tenant_id"],
    )

    # Verify
    assert result is True
    workflow_setup["session"].delete.assert_called_once_with(workflow_setup["workflow"])


def test_delete_workflow_draft_error(workflow_setup):
    # Setup mocks
    workflow_setup["workflow"].version = "draft"
    workflow_setup["session"].scalar = MagicMock(return_value=workflow_setup["workflow"])

    # Call the method and verify exception
    with pytest.raises(DraftWorkflowDeletionError):
        workflow_setup["workflow_service"].delete_workflow(
            session=workflow_setup["session"],
            workflow_id=workflow_setup["workflow_id"],
            tenant_id=workflow_setup["tenant_id"],
        )

    # Verify
    workflow_setup["session"].delete.assert_not_called()


def test_delete_workflow_in_use_by_app_error(workflow_setup):
    # Setup mocks
    workflow_setup["app"].workflow_id = workflow_setup["workflow_id"]
    workflow_setup["session"].scalar = MagicMock(
        side_effect=[workflow_setup["workflow"], workflow_setup["app"]]
    )  # Return workflow first, then app

    # Call the method and verify exception
    with pytest.raises(WorkflowInUseError) as excinfo:
        workflow_setup["workflow_service"].delete_workflow(
            session=workflow_setup["session"],
            workflow_id=workflow_setup["workflow_id"],
            tenant_id=workflow_setup["tenant_id"],
        )

    # Verify error message contains app name
    assert "Cannot delete workflow that is currently in use by app" in str(excinfo.value)

    # Verify
    workflow_setup["session"].delete.assert_not_called()


def test_delete_workflow_published_as_tool_error(workflow_setup):
    # Setup mocks
    from models.tools import WorkflowToolProvider

    # Mock the tool provider query
    mock_tool_provider = MagicMock(spec=WorkflowToolProvider)
    workflow_setup["session"].query.return_value.filter.return_value.first.return_value = mock_tool_provider

    workflow_setup["session"].scalar = MagicMock(
        side_effect=[workflow_setup["workflow"], None]
    )  # Return workflow first, then None for app

    # Call the method and verify exception
    with pytest.raises(WorkflowInUseError) as excinfo:
        workflow_setup["workflow_service"].delete_workflow(
            session=workflow_setup["session"],
            workflow_id=workflow_setup["workflow_id"],
            tenant_id=workflow_setup["tenant_id"],
        )

    # Verify error message
    assert "Cannot delete workflow that is published as a tool" in str(excinfo.value)

    # Verify
    workflow_setup["session"].delete.assert_not_called()
