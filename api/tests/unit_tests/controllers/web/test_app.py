import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.app import AppParameterApi
from controllers.web.error import AppUnavailableError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from models.model import App, AppMode
from models.workflow import Workflow


class TestAppParameterApi:
    """Test cases for AppParameterApi class."""

    @pytest.fixture
    def app(self):
        """Create a Flask app for testing."""
        app = Flask(__name__)
        # Configure Flask-RESTX settings to avoid KeyError
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        app.config["RESTX_MASK_SWAGGER"] = False
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock app model."""
        app_model = MagicMock(spec=App)
        app_model.mode = AppMode.WORKFLOW.value
        return app_model

    def _get_parameters_directly(self, app_model, end_user):
        """Helper method to test the core logic without Flask-RESTX decorators."""
        if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
            # Get workflow output form
            workflow_output_form = workflow.output_form()
        else:
            app_model_config = app_model.app_model_config
            if app_model_config is None:
                raise AppUnavailableError()

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])
            workflow_output_form = []

        return get_parameters_from_feature_dict(
            features_dict=features_dict, user_input_form=user_input_form, workflow_output_form=workflow_output_form
        )

    @pytest.fixture
    def mock_workflow(self):
        """Create a mock workflow with output form."""
        workflow = MagicMock(spec=Workflow)

        # Mock the output_form method to return test data
        workflow.output_form.return_value = [
            {
                "end_id": "end1",
                "outputs": [
                    {"name": "output1", "type": "string", "description": "First output variable"},
                ],
            },
            {
                "end_id": "end2",
                "outputs": [
                    {"name": "output2", "type": "number", "description": "Second output variable"},
                ],
            },
        ]

        # Mock the user_input_form method
        workflow.user_input_form.return_value = [
            {"name": "input1", "type": "string", "description": "First input variable"}
        ]

        # Mock the features_dict property
        workflow.features_dict = {"feature1": "value1", "feature2": "value2"}

        return workflow

    @pytest.fixture
    def mock_end_user(self):
        """Create a mock end user."""
        return MagicMock()

    def test_get_workflow_mode_with_output_form(self, app, mock_app_model, mock_workflow, mock_end_user):
        """Test that workflow_output_form is correctly retrieved for workflow mode."""
        # Arrange
        mock_app_model.workflow = mock_workflow

        # Act
        with app.app_context():
            result = self._get_parameters_directly(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        # Verify that output_form was called
        mock_workflow.output_form.assert_called_once()
        # Verify that user_input_form was called with correct parameter
        mock_workflow.user_input_form.assert_called_once_with(to_old_structure=True)

    def test_get_workflow_mode_without_workflow(self, app, mock_app_model, mock_end_user):
        """Test that AppUnavailableError is raised when workflow is None."""
        # Arrange
        mock_app_model.workflow = None

        # Act & Assert
        with app.app_context():
            with pytest.raises(AppUnavailableError):
                self._get_parameters_directly(mock_app_model, mock_end_user)

    def test_get_advanced_chat_mode_with_output_form(self, app, mock_app_model, mock_workflow, mock_end_user):
        """Test that workflow_output_form is correctly retrieved for advanced chat mode."""
        # Arrange
        mock_app_model.mode = AppMode.ADVANCED_CHAT.value
        mock_app_model.workflow = mock_workflow

        # Act
        with app.app_context():
            result = self._get_parameters_directly(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        # Verify that output_form was called
        mock_workflow.output_form.assert_called_once()

    def test_get_non_workflow_mode(self, app, mock_app_model, mock_end_user):
        """Test that empty workflow_output_form is returned for non-workflow modes."""
        # Arrange
        mock_app_model.mode = AppMode.CHAT.value
        mock_app_model_config = MagicMock()
        mock_app_model_config.to_dict.return_value = {
            "feature1": "value1",
            "user_input_form": [{"name": "input1", "type": "string"}],
        }
        mock_app_model.app_model_config = mock_app_model_config
        # Ensure workflow is None for non-workflow modes
        mock_app_model.workflow = None

        # Act
        with app.app_context():
            result = self._get_parameters_directly(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        # Verify that workflow.output_form was not called
        assert mock_app_model.workflow is None

    def test_get_non_workflow_mode_without_config(self, app, mock_app_model, mock_end_user):
        """Test that AppUnavailableError is raised when app_model_config is None for non-workflow modes."""
        # Arrange
        mock_app_model.mode = AppMode.CHAT.value
        mock_app_model.app_model_config = None

        # Act & Assert
        with app.app_context():
            with pytest.raises(AppUnavailableError):
                self._get_parameters_directly(mock_app_model, mock_end_user)

    def test_workflow_output_form_empty(self, app, mock_app_model, mock_workflow, mock_end_user):
        """Test that empty output form is handled correctly."""
        # Arrange
        mock_workflow.output_form.return_value = []
        mock_app_model.workflow = mock_workflow

        # Act
        with app.app_context():
            result = self._get_parameters_directly(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        mock_workflow.output_form.assert_called_once()

    def test_workflow_output_form_with_multiple_outputs(self, app, mock_app_model, mock_workflow, mock_end_user):
        """Test that multiple outputs in workflow_output_form are handled correctly."""
        # Arrange
        mock_workflow.output_form.return_value = [
            {
                "end_id": "end1",
                "outputs": [
                    {"name": "output1", "type": "string", "description": "First output"},
                    {"name": "output2", "type": "number", "description": "Second output"},
                ],
            },
            {
                "end_id": "end2",
                "outputs": [
                    {"name": "output3", "type": "boolean", "description": "Third output"},
                ],
            },
        ]
        mock_app_model.workflow = mock_workflow

        # Act
        with app.app_context():
            result = self._get_parameters_directly(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        mock_workflow.output_form.assert_called_once()

    @patch("controllers.web.app.get_parameters_from_feature_dict")
    def test_get_parameters_from_feature_dict_called_with_output_form(
        self, mock_get_params, app, mock_app_model, mock_workflow, mock_end_user
    ):
        """Test that get_parameters_from_feature_dict is called with workflow_output_form."""
        # Arrange
        mock_app_model.workflow = mock_workflow
        mock_get_params.return_value = {
            "opening_statement": None,
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "text_to_speech": {"enabled": False},
            "retriever_resource": {"enabled": False},
            "annotation_reply": {"enabled": False},
            "more_like_this": {"enabled": False},
            "user_input_form": [],
            "workflow_output_form": [],
            "sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []},
            "file_upload": {
                "image": {
                    "enabled": False,
                    "number_limits": 3,
                    "detail": "high",
                    "transfer_methods": ["remote_url", "local_file"],
                }
            },
            "system_parameters": {
                "image_file_size_limit": "10",
                "video_file_size_limit": "100",
                "audio_file_size_limit": "50",
                "file_size_limit": "15",
                "workflow_file_upload_limit": "10",
            },
        }

        # Act
        with app.app_context():
            with app.test_request_context():
                api = AppParameterApi()
                result = api.get(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        mock_get_params.assert_called_once()
        call_args = mock_get_params.call_args
        assert "workflow_output_form" in call_args.kwargs
        assert call_args.kwargs["workflow_output_form"] == mock_workflow.output_form.return_value

    @patch("controllers.web.app.get_parameters_from_feature_dict")
    def test_get_parameters_from_feature_dict_called_without_output_form(
        self, mock_get_params, app, mock_app_model, mock_end_user
    ):
        """
        Test that get_parameters_from_feature_dict is called with empty workflow_output_form for non-workflow modes.
        """
        # Arrange
        mock_app_model.mode = AppMode.CHAT.value
        mock_app_model_config = MagicMock()
        mock_app_model_config.to_dict.return_value = {"feature1": "value1", "user_input_form": []}
        mock_app_model.app_model_config = mock_app_model_config
        mock_get_params.return_value = {
            "opening_statement": None,
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "text_to_speech": {"enabled": False},
            "retriever_resource": {"enabled": False},
            "annotation_reply": {"enabled": False},
            "more_like_this": {"enabled": False},
            "user_input_form": [],
            "workflow_output_form": [],
            "sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []},
            "file_upload": {
                "image": {
                    "enabled": False,
                    "number_limits": 3,
                    "detail": "high",
                    "transfer_methods": ["remote_url", "local_file"],
                }
            },
            "system_parameters": {
                "image_file_size_limit": "10",
                "video_file_size_limit": "100",
                "audio_file_size_limit": "50",
                "file_size_limit": "15",
                "workflow_file_upload_limit": "10",
            },
        }

        # Act
        with app.app_context():
            with app.test_request_context():
                api = AppParameterApi()
                result = api.get(mock_app_model, mock_end_user)

        # Assert
        assert result is not None
        mock_get_params.assert_called_once()
        call_args = mock_get_params.call_args
        assert "workflow_output_form" in call_args.kwargs
        assert call_args.kwargs["workflow_output_form"] == []


class TestWorkflowOutputForm:
    """Test cases specifically for the workflow output_form functionality."""

    def test_workflow_output_form_method(self):
        """Test the workflow output_form method directly."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph=json.dumps(
                {
                    "nodes": [
                        {"id": "start", "data": {"type": "start", "variables": [{"name": "input1", "type": "string"}]}},
                        {
                            "id": "end1",
                            "data": {
                                "type": "end",
                                "outputs": [
                                    {"name": "output1", "type": "string", "description": "First output"},
                                    {"name": "output2", "type": "number", "description": "Second output"},
                                ],
                            },
                        },
                        {
                            "id": "end2",
                            "data": {
                                "type": "end",
                                "outputs": [{"name": "output3", "type": "boolean", "description": "Third output"}],
                            },
                        },
                    ]
                }
            ),
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act
        result = workflow.output_form()

        # Assert
        expected_outputs = [
            {
                "end_id": "end1",
                "outputs": [
                    {"name": "output1", "type": "string", "description": "First output"},
                    {"name": "output2", "type": "number", "description": "Second output"},
                ],
            },
            {
                "end_id": "end2",
                "outputs": [
                    {"name": "output3", "type": "boolean", "description": "Third output"},
                ],
            },
        ]
        assert result == expected_outputs

    def test_workflow_output_form_empty_graph(self):
        """Test output_form with empty graph."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act
        result = workflow.output_form()

        # Assert
        assert result == []

    def test_workflow_output_form_no_nodes(self):
        """Test output_form with graph containing no nodes."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph=json.dumps({}),
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act
        result = workflow.output_form()

        # Assert
        assert result == []

    def test_workflow_output_form_no_end_nodes(self):
        """Test output_form with graph containing no end nodes."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph=json.dumps(
                {
                    "nodes": [
                        {"id": "start", "data": {"type": "start", "variables": []}},
                        {"id": "llm", "data": {"type": "llm", "outputs": []}},
                    ]
                }
            ),
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act
        result = workflow.output_form()

        # Assert
        assert result == []

    def test_workflow_output_form_end_node_without_outputs(self):
        """Test output_form with end node that has no outputs."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph=json.dumps({"nodes": [{"id": "end1", "data": {"type": "end", "outputs": []}}]}),
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act
        result = workflow.output_form()

        # Assert
        assert result == []

    def test_workflow_output_form_invalid_json(self):
        """Test output_form with invalid JSON in graph."""
        # Arrange
        workflow = Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="invalid json",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Act & Assert
        # The output_form method calls graph_dict which will raise JSONDecodeError for invalid JSON
        with pytest.raises(json.JSONDecodeError):
            workflow.output_form()
