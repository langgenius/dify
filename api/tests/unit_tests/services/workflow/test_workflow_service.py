import json
from unittest.mock import MagicMock, patch

import pytest

from core.variables.variables import StringVariable
from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.errors.workflow_service import ConversationVariableDescriptionTooLongError
from services.workflow_service import WorkflowService


class TestWorkflowService:
    @pytest.fixture
    def workflow_service(self):
        # Mock the database dependencies to avoid Flask app context issues
        with patch("services.workflow_service.db") as mock_db:
            with patch("services.workflow_service.sessionmaker") as mock_sessionmaker:
                mock_db.engine = MagicMock()
                mock_sessionmaker.return_value = MagicMock()
                return WorkflowService()

    @pytest.fixture
    def mock_app(self):
        app = MagicMock(spec=App)
        app.id = "app-id-1"
        app.tenant_id = "tenant-id-1"
        app.mode = "workflow"
        return app

    @pytest.fixture
    def mock_account(self):
        account = MagicMock(spec=Account)
        account.id = "user-id-1"
        return account

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
        mock_app.workflow_id = "workflow-id-1"
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
        mock_app.workflow_id = "workflow-id-1"
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
        mock_app.workflow_id = "workflow-id-1"
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
        mock_app.workflow_id = "workflow-id-1"
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
        mock_app.workflow_id = "workflow-id-1"
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
        mock_app.workflow_id = "workflow-id-1"
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


class TestSyncDraftWorkflow:
    """Test cases focused on the sync_draft_workflow method."""

    @pytest.fixture
    def workflow_service(self):
        # Mock the database dependencies to avoid Flask app context issues
        with patch("services.workflow_service.db") as mock_db:
            with patch("services.workflow_service.sessionmaker") as mock_sessionmaker:
                mock_db.engine = MagicMock()
                mock_sessionmaker.return_value = MagicMock()
                return WorkflowService()

    @pytest.fixture
    def mock_app(self):
        app = MagicMock(spec=App)
        app.id = "app-id-1"
        app.tenant_id = "tenant-id-1"
        app.mode = "workflow"
        return app

    @pytest.fixture
    def mock_account(self):
        account = MagicMock(spec=Account)
        account.id = "user-id-1"
        return account

    @pytest.fixture
    def sample_graph(self):
        return {"nodes": [], "edges": []}

    @pytest.fixture
    def sample_features(self):
        return {"retriever_resource": {"enabled": True}}

    @pytest.fixture
    def sample_environment_variables(self):
        return []

    @pytest.fixture
    def sample_conversation_variables(self):
        return [
            StringVariable(
                id="var-1", name="test_var", description="A valid description within limits", value="test_value"
            )
        ]

    @patch("services.workflow_service.db.session")
    @patch("services.workflow_service.app_draft_workflow_was_synced")
    def test_sync_draft_workflow_creates_new_workflow(
        self,
        mock_signal,
        mock_db_session,
        workflow_service,
        mock_app,
        mock_account,
        sample_graph,
        sample_features,
        sample_environment_variables,
        sample_conversation_variables,
    ):
        """Test that sync_draft_workflow creates a new workflow when none exists."""
        # Mock get_draft_workflow to return None (no existing workflow)
        with patch.object(workflow_service, "get_draft_workflow", return_value=None):
            with patch.object(workflow_service, "validate_features_structure"):
                result = workflow_service.sync_draft_workflow(
                    app_model=mock_app,
                    graph=sample_graph,
                    features=sample_features,
                    unique_hash="test-hash",
                    account=mock_account,
                    environment_variables=sample_environment_variables,
                    conversation_variables=sample_conversation_variables,
                )

                # Verify a new workflow was created
                assert result is not None
                mock_db_session.add.assert_called_once()
                mock_db_session.commit.assert_called_once()
                mock_signal.send.assert_called_once()

    @patch("services.workflow_service.db.session")
    @patch("services.workflow_service.app_draft_workflow_was_synced")
    def test_sync_draft_workflow_updates_existing_workflow(
        self,
        mock_signal,
        mock_db_session,
        workflow_service,
        mock_app,
        mock_account,
        sample_graph,
        sample_features,
        sample_environment_variables,
        sample_conversation_variables,
    ):
        """Test that sync_draft_workflow updates an existing workflow."""
        # Mock existing workflow
        existing_workflow = MagicMock(spec=Workflow)
        existing_workflow.unique_hash = "test-hash"
        existing_workflow.conversation_variables = []

        with patch.object(workflow_service, "get_draft_workflow", return_value=existing_workflow):
            with patch.object(workflow_service, "validate_features_structure"):
                result = workflow_service.sync_draft_workflow(
                    app_model=mock_app,
                    graph=sample_graph,
                    features=sample_features,
                    unique_hash="test-hash",
                    account=mock_account,
                    environment_variables=sample_environment_variables,
                    conversation_variables=sample_conversation_variables,
                )

                # Verify existing workflow was updated
                assert result == existing_workflow
                assert existing_workflow.graph == json.dumps(sample_graph)
                assert existing_workflow.features == json.dumps(sample_features)
                assert existing_workflow.updated_by == mock_account.id
                assert existing_workflow.environment_variables == sample_environment_variables
                assert existing_workflow.conversation_variables == sample_conversation_variables
                mock_db_session.add.assert_not_called()  # Should not add new workflow
                mock_db_session.commit.assert_called_once()
                mock_signal.send.assert_called_once()

    def test_sync_draft_workflow_validates_conversation_variable_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features, sample_environment_variables
    ):
        """Test that sync_draft_workflow validates conversation variable descriptions."""
        # Create conversation variable with description exceeding limit
        long_description = "a" * 300  # Exceeds 256 character limit
        long_desc_variables = [
            StringVariable(id="var-1", name="test_var", description=long_description, value="test_value")
        ]

        with patch.object(workflow_service, "get_draft_workflow", return_value=None):
            with patch.object(workflow_service, "validate_features_structure"):
                with pytest.raises(ConversationVariableDescriptionTooLongError) as exc_info:
                    workflow_service.sync_draft_workflow(
                        app_model=mock_app,
                        graph=sample_graph,
                        features=sample_features,
                        unique_hash="test-hash",
                        account=mock_account,
                        environment_variables=sample_environment_variables,
                        conversation_variables=long_desc_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)
                assert "Current length: 300 characters" in str(exc_info.value)

    def test_sync_draft_workflow_allows_existing_long_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features, sample_environment_variables
    ):
        """Test that sync_draft_workflow allows updates when existing workflow has long descriptions."""
        # Create existing workflow with long description
        long_description = "a" * 300
        existing_variable = StringVariable(
            id="existing-var", name="existing_var", description=long_description, value="existing_value"
        )
        existing_workflow = MagicMock(spec=Workflow)
        existing_workflow.unique_hash = "test-hash"
        existing_workflow.conversation_variables = [existing_variable]

        # New variables with long descriptions should be allowed
        new_long_desc_variables = [
            StringVariable(id="new-var", name="new_var", description=long_description, value="new_value")
        ]

        with patch.object(workflow_service, "get_draft_workflow", return_value=existing_workflow):
            with patch.object(workflow_service, "validate_features_structure"):
                with patch("services.workflow_service.db.session"):
                    with patch("services.workflow_service.app_draft_workflow_was_synced"):
                        # Should not raise exception
                        result = workflow_service.sync_draft_workflow(
                            app_model=mock_app,
                            graph=sample_graph,
                            features=sample_features,
                            unique_hash="test-hash",
                            account=mock_account,
                            environment_variables=sample_environment_variables,
                            conversation_variables=new_long_desc_variables,
                        )

                        assert result == existing_workflow

    def test_sync_draft_workflow_handles_empty_conversation_variables(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features, sample_environment_variables
    ):
        """Test that empty conversation variables list is handled correctly."""
        with patch.object(workflow_service, "get_draft_workflow", return_value=None):
            with patch.object(workflow_service, "validate_features_structure"):
                with patch("services.workflow_service.db.session"):
                    with patch("services.workflow_service.app_draft_workflow_was_synced"):
                        result = workflow_service.sync_draft_workflow(
                            app_model=mock_app,
                            graph=sample_graph,
                            features=sample_features,
                            unique_hash="test-hash",
                            account=mock_account,
                            environment_variables=sample_environment_variables,
                            conversation_variables=[],
                        )

                        assert result is not None

    def test_sync_draft_workflow_handles_multiple_variables_one_invalid(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features, sample_environment_variables
    ):
        """Test that validation fails when one of multiple variables exceeds limit."""
        mixed_variables = [
            StringVariable(id="var-1", name="valid_var", description="Valid description", value="valid_value"),
            StringVariable(
                id="var-2",
                name="invalid_var",
                description="a" * 300,  # Exceeds limit
                value="invalid_value",
            ),
            StringVariable(
                id="var-3",
                name="another_valid_var",
                description="Another valid description",
                value="another_valid_value",
            ),
        ]

        with patch.object(workflow_service, "get_draft_workflow", return_value=None):
            with patch.object(workflow_service, "validate_features_structure"):
                with pytest.raises(ConversationVariableDescriptionTooLongError) as exc_info:
                    workflow_service.sync_draft_workflow(
                        app_model=mock_app,
                        graph=sample_graph,
                        features=sample_features,
                        unique_hash="test-hash",
                        account=mock_account,
                        environment_variables=sample_environment_variables,
                        conversation_variables=mixed_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)
                assert "Current length: 300 characters" in str(exc_info.value)

    def test_sync_draft_workflow_handles_empty_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features, sample_environment_variables
    ):
        """Test that empty description strings are handled correctly."""
        empty_desc_variables = [StringVariable(id="var-1", name="empty_desc_var", description="", value="test_value")]

        with patch.object(workflow_service, "get_draft_workflow", return_value=None):
            with patch.object(workflow_service, "validate_features_structure"):
                with patch("services.workflow_service.db.session"):
                    with patch("services.workflow_service.app_draft_workflow_was_synced"):
                        # Should not raise exception
                        result = workflow_service.sync_draft_workflow(
                            app_model=mock_app,
                            graph=sample_graph,
                            features=sample_features,
                            unique_hash="test-hash",
                            account=mock_account,
                            environment_variables=sample_environment_variables,
                            conversation_variables=empty_desc_variables,
                        )

                        assert result is not None
