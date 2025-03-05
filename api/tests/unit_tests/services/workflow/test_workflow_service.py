from unittest.mock import MagicMock

import pytest

from models.model import App
from models.workflow import Workflow
from services.workflow_service import WorkflowService


class TestWorkflowService:
    @pytest.fixture
    def workflow_service(self):
        return WorkflowService()

    @pytest.fixture
    def mock_app(self):
        app = MagicMock(spec=App)
        app.id = "app-id-1"
        app.workflow_id = "workflow-id-1"
        app.tenant_id = "tenant-id-1"
        return app

    @pytest.fixture
    def mock_workflows(self):
        workflows = []
        for i in range(5):
            workflow = MagicMock(spec=Workflow)
            workflow.id = f"workflow-id-{i}"
            workflow.app_id = "app-id-1"
            workflow.created_at = f"2023-01-0{5 - i}"  # Descending date order
            workflow.created_by = "user-id-1" if i % 2 == 0 else "user-id-2"
            workflow.marked_name = f"Workflow {i}" if i % 2 == 0 else ""
            workflows.append(workflow)
        return workflows

    def test_get_all_published_workflow_no_workflow_id(self, workflow_service, mock_app):
        mock_app.workflow_id = None
        mock_session = MagicMock()

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False
        mock_session.scalars.assert_not_called()

    def test_get_all_published_workflow_basic(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        mock_scalar_result.all.return_value = mock_workflows[:3]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=3, user_id=None
        )

        assert workflows == mock_workflows[:3]
        assert has_more is False
        mock_session.scalars.assert_called_once()

    def test_get_all_published_workflow_pagination(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Return 4 items when limit is 3, which should indicate has_more=True
        mock_scalar_result.all.return_value = mock_workflows[:4]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=3, user_id=None
        )

        # Should return only the first 3 items
        assert len(workflows) == 3
        assert workflows == mock_workflows[:3]
        assert has_more is True

        # Test page 2
        mock_scalar_result.all.return_value = mock_workflows[3:]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=2, limit=3, user_id=None
        )

        assert len(workflows) == 2
        assert has_more is False

    def test_get_all_published_workflow_user_filter(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Filter workflows for user-id-1
        filtered_workflows = [w for w in mock_workflows if w.created_by == "user-id-1"]
        mock_scalar_result.all.return_value = filtered_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id="user-id-1"
        )

        assert workflows == filtered_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that the select contains a user filter clause
        args = mock_session.scalars.call_args[0][0]
        assert "created_by" in str(args)

    def test_get_all_published_workflow_named_only(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Filter workflows that have a marked_name
        named_workflows = [w for w in mock_workflows if w.marked_name]
        mock_scalar_result.all.return_value = named_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None, named_only=True
        )

        assert workflows == named_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that the select contains a named_only filter clause
        args = mock_session.scalars.call_args[0][0]
        assert "marked_name !=" in str(args)

    def test_get_all_published_workflow_combined_filters(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Combined filter: user-id-1 and has marked_name
        filtered_workflows = [w for w in mock_workflows if w.created_by == "user-id-1" and w.marked_name]
        mock_scalar_result.all.return_value = filtered_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id="user-id-1", named_only=True
        )

        assert workflows == filtered_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that both filters are applied
        args = mock_session.scalars.call_args[0][0]
        assert "created_by" in str(args)
        assert "marked_name !=" in str(args)

    def test_get_all_published_workflow_empty_result(self, workflow_service, mock_app):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        mock_scalar_result.all.return_value = []
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False
        mock_session.scalars.assert_called_once()
