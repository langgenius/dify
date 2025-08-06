"""
Simplified integration tests for conversation variable description length validation.

This test suite provides focused testing of the sync_draft_workflow method
through the service layer with minimal API mocking.
"""

from unittest.mock import MagicMock, patch

import pytest

from core.variables.variables import StringVariable
from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.errors.workflow_service import ConversationVariableDescriptionTooLongError
from services.workflow_service import WorkflowService


class TestWorkflowConversationVariableValidationSimplified:
    """Simplified integration tests focusing on the service layer."""

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
        app.id = "test-app-id"
        app.tenant_id = "test-tenant-id"
        app.mode = "workflow"
        return app

    @pytest.fixture
    def mock_account(self):
        account = MagicMock(spec=Account)
        account.id = "test-user-id"
        return account

    @pytest.fixture
    def sample_graph(self):
        return {"nodes": [], "edges": []}

    @pytest.fixture
    def sample_features(self):
        return {"retriever_resource": {"enabled": True}}

    def test_service_rejects_long_description_new_workflow(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that the service rejects long descriptions for new workflows."""
        long_description = "This description exceeds the 256 character limit. " * 6  # ~282 chars
        conversation_variables = [
            StringVariable(id="test-var-1", name="test_var", description=long_description, value="test_value")
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
                        environment_variables=[],
                        conversation_variables=conversation_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)
                assert "300 characters" in str(exc_info.value)

    def test_service_accepts_valid_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that the service accepts valid description lengths."""
        conversation_variables = [
            StringVariable(id="test-var-1", name="short_var", description="Short description", value="short_value"),
            StringVariable(
                id="test-var-2",
                name="medium_var",
                description="This is a medium length description that is well within the 256 character limit.",
                value="medium_value",
            ),
        ]

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
                            environment_variables=[],
                            conversation_variables=conversation_variables,
                        )

                        assert result is not None

    def test_service_accepts_exactly_256_characters(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that descriptions with exactly 256 characters are accepted."""
        exact_description = "a" * 256
        conversation_variables = [
            StringVariable(id="test-var-1", name="exact_var", description=exact_description, value="exact_value")
        ]

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
                            environment_variables=[],
                            conversation_variables=conversation_variables,
                        )

                        assert result is not None

    def test_service_rejects_257_characters(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that descriptions with 257 characters are rejected."""
        over_limit_description = "a" * 257
        conversation_variables = [
            StringVariable(
                id="test-var-1", name="over_limit_var", description=over_limit_description, value="over_limit_value"
            )
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
                        environment_variables=[],
                        conversation_variables=conversation_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)
                assert "257 characters" in str(exc_info.value)

    def test_service_allows_existing_workflow_with_long_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that existing workflows with long descriptions can be updated."""
        long_description = (
            "This description exceeds 256 characters and should be allowed for existing workflows. " * 3
        )  # ~309 chars

        # Mock existing workflow with long description
        existing_variable = StringVariable(
            id="existing-var", name="existing_var", description=long_description, value="existing_value"
        )
        existing_workflow = MagicMock(spec=Workflow)
        existing_workflow.unique_hash = "test-hash"
        existing_workflow.conversation_variables = [existing_variable]

        # New variable with long description should be allowed
        new_conversation_variables = [
            StringVariable(id="new-var", name="new_var", description=long_description, value="new_value")
        ]

        with patch.object(workflow_service, "get_draft_workflow", return_value=existing_workflow):
            with patch.object(workflow_service, "validate_features_structure"):
                with patch("services.workflow_service.db.session"):
                    with patch("services.workflow_service.app_draft_workflow_was_synced"):
                        result = workflow_service.sync_draft_workflow(
                            app_model=mock_app,
                            graph=sample_graph,
                            features=sample_features,
                            unique_hash="test-hash",
                            account=mock_account,
                            environment_variables=[],
                            conversation_variables=new_conversation_variables,
                        )

                        assert result == existing_workflow

    def test_service_handles_unicode_characters(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that Unicode characters are properly handled."""
        # Unicode description within limit
        unicode_description = "测试描述包含中文字符和emoji 🚀✨ " * 8  # Should be around 240 chars
        conversation_variables = [
            StringVariable(id="test-var-1", name="unicode_var", description=unicode_description, value="unicode_value")
        ]

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
                            environment_variables=[],
                            conversation_variables=conversation_variables,
                        )

                        assert result is not None

    def test_service_rejects_unicode_characters_exceeding_limit(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that Unicode characters exceeding limit are rejected."""
        # Unicode description exceeding limit - increased to ensure it exceeds 256 chars
        unicode_description = "测试描述包含中文字符和emoji 🚀✨ " * 15  # Should exceed 256 chars (300 chars)
        conversation_variables = [
            StringVariable(
                id="test-var-1", name="unicode_long_var", description=unicode_description, value="unicode_long_value"
            )
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
                        environment_variables=[],
                        conversation_variables=conversation_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)

    def test_service_handles_mixed_valid_and_invalid_descriptions(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
    ):
        """Test that validation fails when mixing valid and invalid description lengths."""
        conversation_variables = [
            StringVariable(
                id="test-var-1",
                name="valid_var",
                description="This is a valid description within the limit.",
                value="valid_value",
            ),
            StringVariable(
                id="test-var-2",
                name="invalid_var",
                description="This description is way too long and exceeds the 256 character limit by a significant margin. "
                * 3,  # ~297 chars
                value="invalid_value",
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
                        environment_variables=[],
                        conversation_variables=conversation_variables,
                    )

                assert "exceeds maximum length of 256 characters" in str(exc_info.value)

    def test_service_handles_empty_conversation_variables(
        self, workflow_service, mock_app, mock_account, sample_graph, sample_features
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
                            environment_variables=[],
                            conversation_variables=[],
                        )

                        assert result is not None
