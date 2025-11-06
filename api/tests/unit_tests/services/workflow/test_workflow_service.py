from unittest.mock import MagicMock

import pytest

from models.model import App
from models.workflow import Workflow
from services.workflow_service import WorkflowService


class TestWorkflowService:
    @pytest.fixture
    def workflow_service(self):
        mock_session_maker = MagicMock()
        return WorkflowService(mock_session_maker)

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


class TestWorkflowServiceHumanInputValidation:
    @pytest.fixture
    def workflow_service(self):
        # Mock sessionmaker to avoid database dependency
        mock_session_maker = MagicMock()
        return WorkflowService(mock_session_maker)

    def test_validate_graph_structure_valid_human_input(self, workflow_service):
        """Test validation of valid HumanInput node data."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                        "form_content": "Please provide your input",
                        "inputs": [
                            {
                                "type": "text-input",
                                "output_variable_name": "user_input",
                                "placeholder": {"type": "constant", "value": "Enter text here"},
                            }
                        ],
                        "user_actions": [{"id": "submit", "title": "Submit", "button_style": "primary"}],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                }
            ]
        }

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_empty_graph(self, workflow_service):
        """Test validation of empty graph."""
        graph = {}

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_no_nodes(self, workflow_service):
        """Test validation of graph with no nodes."""
        graph = {"nodes": []}

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_non_human_input_node(self, workflow_service):
        """Test validation ignores non-HumanInput nodes."""
        graph = {"nodes": [{"id": "node-1", "data": {"type": "start", "title": "Start"}}]}

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_invalid_delivery_method_type(self, workflow_service):
        """Test validation fails with invalid delivery method type."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [{"type": "invalid_type", "enabled": True, "config": {}}],
                        "form_content": "Please provide your input",
                        "inputs": [],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_invalid_form_input_type(self, workflow_service):
        """Test validation fails with invalid form input type."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                        "form_content": "Please provide your input",
                        "inputs": [{"type": "invalid-input-type", "output_variable_name": "user_input"}],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_missing_required_fields(self, workflow_service):
        """Test validation fails with missing required fields."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        # Missing required fields like title
                        "delivery_methods": [],
                        "form_content": "",
                        "inputs": [],
                        "user_actions": [],
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_invalid_timeout_unit(self, workflow_service):
        """Test validation fails with invalid timeout unit."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                        "form_content": "Please provide your input",
                        "inputs": [],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "invalid_unit",
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_invalid_button_style(self, workflow_service):
        """Test validation fails with invalid button style."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                        "form_content": "Please provide your input",
                        "inputs": [],
                        "user_actions": [{"id": "submit", "title": "Submit", "button_style": "invalid_style"}],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_email_delivery_config(self, workflow_service):
        """Test validation of HumanInput node with email delivery configuration."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [
                            {
                                "type": "email",
                                "enabled": True,
                                "config": {
                                    "recipients": {
                                        "whole_workspace": False,
                                        "items": [{"type": "external", "email": "user@example.com"}],
                                    },
                                    "subject": "Input Required",
                                    "body": "Please provide your input",
                                },
                            }
                        ],
                        "form_content": "Please provide your input",
                        "inputs": [
                            {
                                "type": "paragraph",
                                "output_variable_name": "feedback",
                                "placeholder": {"type": "variable", "selector": ["node", "output"]},
                            }
                        ],
                        "user_actions": [
                            {"id": "approve", "title": "Approve", "button_style": "accent"},
                            {"id": "reject", "title": "Reject", "button_style": "ghost"},
                        ],
                        "timeout": 7,
                        "timeout_unit": "day",
                    },
                }
            ]
        }

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_invalid_email_recipient(self, workflow_service):
        """Test validation fails with invalid email recipient."""
        graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "human_input",
                        "title": "Human Input",
                        "delivery_methods": [
                            {
                                "type": "email",
                                "enabled": True,
                                "config": {
                                    "recipients": {
                                        "whole_workspace": False,
                                        "items": [{"type": "invalid_recipient_type", "email": "user@example.com"}],
                                    },
                                    "subject": "Input Required",
                                    "body": "Please provide your input",
                                },
                            }
                        ],
                        "form_content": "Please provide your input",
                        "inputs": [],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                }
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_human_input_node_data_multiple_nodes_mixed_valid_invalid(self, workflow_service):
        """Test validation with multiple nodes where some are valid and some invalid."""
        graph = {
            "nodes": [
                {"id": "node-1", "data": {"type": "start", "title": "Start"}},
                {
                    "id": "node-2",
                    "data": {
                        "type": "human_input",
                        "title": "Valid Human Input",
                        "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                        "form_content": "Valid input",
                        "inputs": [],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                },
                {
                    "id": "node-3",
                    "data": {
                        "type": "human_input",
                        "title": "Invalid Human Input",
                        "delivery_methods": [{"type": "invalid_method", "enabled": True}],
                        "form_content": "Invalid input",
                        "inputs": [],
                        "user_actions": [],
                        "timeout": 24,
                        "timeout_unit": "hour",
                    },
                },
            ]
        }

        with pytest.raises(ValueError, match="Invalid HumanInput node data"):
            workflow_service.validate_graph_structure(graph)
