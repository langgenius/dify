import json
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.tools.workflow_as_tool.tool import WorkflowTool
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

TEST_USER_ID = "test_user_123"
TEST_TENANT_ID = "test_tenant_456"
TEST_WORKFLOW_APP_ID = "test_app_789"
TEST_WORKFLOW_TOOL_ID = "test_tool_001"
TEST_NAME = "Test Workflow Tool"
TEST_DUPLICATE_NAME = "Duplicate Tool Name"
TEST_LABEL = "Test Tool Label"
TEST_ICON = {"type": "emoji", "content": "test_icon"}
TEST_DESCRIPTION = "Test tool description"
TEST_PRIVACY_POLICY = "Test privacy policy"
TEST_LABELS = ["test", "workflow", "tool"]
TEST_GRAPH_DICT = {"nodes": []}
TEST_INVALID_GRAPH_DICT = {"nodes": [{"type": "human-input"}]}
TEST_VERSION = "v1.0.0"
TEST_UPDATED_VERSION = "v1.1.0"


class TestWorkflowToolManageServiceFactory:
    """Factory class for creating test data and mock objects for workflow tool manage service tests."""

    @staticmethod
    def create_workflow_tool_provider_mock(
        tenant_id: str = TEST_TENANT_ID,
        user_id: str = TEST_USER_ID,
        app_id: str = TEST_WORKFLOW_APP_ID,
        tool_id: str = TEST_WORKFLOW_TOOL_ID,
        name: str = TEST_NAME,
        label: str = TEST_LABEL,
        icon: str = json.dumps(TEST_ICON),
        description: str = TEST_DESCRIPTION,
        version: str = TEST_VERSION,
    ) -> MagicMock:
        """Create a mock WorkflowToolProvider database model."""
        provider = MagicMock(spec=WorkflowToolProvider)
        provider.id = tool_id
        provider.tenant_id = tenant_id
        provider.user_id = user_id
        provider.app_id = app_id
        provider.name = name
        provider.label = label
        provider.icon = icon
        provider.description = description
        provider.parameter_configuration = json.dumps([{"key": "test_param", "type": "string", "label": "Test Param"}])
        provider.privacy_policy = TEST_PRIVACY_POLICY
        provider.version = version
        provider.updated_at = datetime.now()
        return provider

    @staticmethod
    def create_app_mock(
        app_id: str = TEST_WORKFLOW_APP_ID, tenant_id: str = TEST_TENANT_ID, workflow: MagicMock | None = None
    ) -> MagicMock:
        """Create a mock App database model."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        app.workflow = workflow or TestWorkflowToolManageServiceFactory.create_workflow_mock()
        return app

    @staticmethod
    def create_workflow_mock(graph_dict: dict[str, Any] = TEST_GRAPH_DICT, version: str = TEST_VERSION) -> MagicMock:
        """Create a mock Workflow database model."""
        workflow = MagicMock(spec=Workflow)
        workflow.graph_dict = graph_dict
        workflow.version = version
        return workflow

    @staticmethod
    def create_parameter_config_mock() -> list[WorkflowToolParameterConfiguration]:
        """Create a mock list of WorkflowToolParameterConfiguration."""
        return [
            WorkflowToolParameterConfiguration(
                key="test_param",
                name="test_param",
                type="string",
                form="form",
                label="Test Parameter",
                required=True,
                description="Test parameter description",
            )
        ]

    @staticmethod
    def create_tool_controller_mock(provider_id: str = TEST_WORKFLOW_TOOL_ID) -> MagicMock:
        """Create a mock WorkflowToolProviderController."""
        controller = MagicMock(spec=WorkflowToolProviderController)
        controller.provider_id = provider_id
        return controller

    @staticmethod
    def create_workflow_tool_mock() -> MagicMock:
        """Create a mock WorkflowTool instance."""
        tool = MagicMock(spec=WorkflowTool)
        tool.entity = MagicMock()
        tool.entity.output_schema = {"type": "object", "properties": {}}
        return tool

    @staticmethod
    def create_api_entities_mock() -> tuple[MagicMock, MagicMock]:
        """Create mock API entities for transformation."""
        provider_api = MagicMock(spec=ToolProviderApiEntity)
        tool_api = MagicMock(spec=ToolApiEntity)
        return provider_api, tool_api


class TestWorkflowToolManageServiceCreate:
    """
    Unit tests for WorkflowToolManageService.create_workflow_tool.

    This test suite covers:
    - Duplicate name/app_id error
    - App not found error
    - Workflow not found error
    - Human input node validation error
    - Controller initialization failure
    - Successful creation
    - labels=None branch
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowToolManageServiceFactory()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_duplicate_name_or_app_id(self, mock_session, mock_db, factory):
        """Test creation fails when tool name or app_id already exists."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = (
            factory.create_workflow_tool_provider_mock()
        )
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(
            ValueError, match=f"Tool with name {TEST_NAME} or app_id {TEST_WORKFLOW_APP_ID} already exists"
        ):
            WorkflowToolManageService.create_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_app_id=TEST_WORKFLOW_APP_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_app_not_found(self, mock_session, mock_db, factory):
        """Test creation fails when associated App is not found."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, None]
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"App {TEST_WORKFLOW_APP_ID} not found"):
            WorkflowToolManageService.create_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_app_id=TEST_WORKFLOW_APP_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_workflow_not_found(self, mock_session, mock_db, factory):
        """Test creation fails when App has no associated Workflow."""
        # Arrange
        app_mock = factory.create_app_mock()
        app_mock.workflow = None
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, app_mock]
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"Workflow not found for app {TEST_WORKFLOW_APP_ID}"):
            WorkflowToolManageService.create_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_app_id=TEST_WORKFLOW_APP_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_workflow_with_human_input_nodes(self, mock_session, mock_validate, mock_db, factory):
        """Test creation fails when workflow contains human input nodes."""
        # Arrange
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, app_mock]
        mock_validate.side_effect = ValueError("Human input nodes not allowed")
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Human input nodes not allowed"):
            WorkflowToolManageService.create_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_app_id=TEST_WORKFLOW_APP_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_controller_initialization_failed(
        self, mock_session, mock_controller, mock_validate, mock_db, factory
    ):
        """Test creation fails when tool controller fails to initialize."""
        # Arrange
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, app_mock]
        mock_controller.side_effect = Exception("Controller init failed")
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Controller init failed"):
            WorkflowToolManageService.create_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_app_id=TEST_WORKFLOW_APP_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.update_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService.workflow_provider_to_controller")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_success(
        self, mock_session, mock_controller, mock_validate, mock_transform, mock_label, mock_db, factory
    ):
        """Test successful workflow tool creation with labels."""
        # Arrange
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, app_mock]
        params = factory.create_parameter_config_mock()

        # Act
        result = WorkflowToolManageService.create_workflow_tool(
            user_id=TEST_USER_ID,
            tenant_id=TEST_TENANT_ID,
            workflow_app_id=TEST_WORKFLOW_APP_ID,
            name=TEST_NAME,
            label=TEST_LABEL,
            icon=TEST_ICON,
            description=TEST_DESCRIPTION,
            parameters=params,
            privacy_policy=TEST_PRIVACY_POLICY,
            labels=TEST_LABELS,
        )

        # Assert
        assert result == {"result": "success"}
        mock_validate.assert_called_once()
        mock_controller.assert_called_once()
        mock_session.return_value.begin.return_value.__enter__.return_value.add.assert_called_once()
        mock_label.assert_called_once()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_create_without_labels(self, mock_session, mock_controller, mock_validate, mock_db, factory):
        """Test successful workflow tool creation without labels."""
        # Arrange
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, app_mock]
        params = factory.create_parameter_config_mock()

        # Act
        result = WorkflowToolManageService.create_workflow_tool(
            user_id=TEST_USER_ID,
            tenant_id=TEST_TENANT_ID,
            workflow_app_id=TEST_WORKFLOW_APP_ID,
            name=TEST_NAME,
            label=TEST_LABEL,
            icon=TEST_ICON,
            description=TEST_DESCRIPTION,
            parameters=params,
            labels=None,
        )

        # Assert
        assert result == {"result": "success"}
        mock_validate.assert_called_once()
        mock_controller.assert_called_once()
        mock_session.return_value.begin.return_value.__enter__.return_value.add.assert_called_once()


class TestWorkflowToolManageServiceUpdate:
    """
    Unit tests for WorkflowToolManageService.update_workflow_tool.

    This test suite covers:
    - Duplicate name error
    - Tool not found error
    - App not found error
    - Workflow not found error
    - Validation errors
    - Successful update
    - labels=None branch
    - Transform exception branch
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowToolManageServiceFactory()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_duplicate_name(self, mock_session, mock_db, factory):
        """Test update fails when new name is used by another tool."""
        # Arrange
        mock_provider = factory.create_workflow_tool_provider_mock(name=TEST_DUPLICATE_NAME)
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = mock_provider
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"Tool with name {TEST_NAME} already exists"):
            WorkflowToolManageService.update_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_tool_not_found(self, mock_session, mock_db, factory):
        """Test update fails when target tool is not found."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [None, None]
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"Tool {TEST_WORKFLOW_TOOL_ID} not found"):
            WorkflowToolManageService.update_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_app_not_found(self, mock_session, mock_db, factory):
        """Test update fails when tool's associated App is not found."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            None,
            provider_mock,
            None,
        ]
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"App {TEST_WORKFLOW_APP_ID} not found"):
            WorkflowToolManageService.update_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_workflow_not_found(self, mock_session, mock_db, factory):
        """Test update fails when App has no associated Workflow."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        app_mock = factory.create_app_mock()
        app_mock.workflow = None
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            None,
            provider_mock,
            app_mock,
        ]
        params = factory.create_parameter_config_mock()

        # Act & Assert
        with pytest.raises(ValueError, match=f"Workflow not found for app {TEST_WORKFLOW_APP_ID}"):
            WorkflowToolManageService.update_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )

    @patch("core.tools.workflow_as_tool.provider.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.update_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService.workflow_provider_to_controller")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_success(
        self, mock_session, mock_validate, mock_transform, mock_label, mock_db, mock_from_db, factory
    ):
        """Test successful workflow tool update with label sync."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        app_mock = factory.create_app_mock(workflow=factory.create_workflow_mock(version=TEST_UPDATED_VERSION))
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            None,
            provider_mock,
            app_mock,
        ]
        params = factory.create_parameter_config_mock()

        # Act
        result = WorkflowToolManageService.update_workflow_tool(
            user_id=TEST_USER_ID,
            tenant_id=TEST_TENANT_ID,
            workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
            name=TEST_NAME,
            label=TEST_LABEL,
            icon=TEST_ICON,
            description=TEST_DESCRIPTION,
            parameters=params,
            privacy_policy=TEST_PRIVACY_POLICY,
            labels=TEST_LABELS,
        )

        # Assert
        assert result == {"result": "success"}
        assert provider_mock.version == TEST_UPDATED_VERSION
        mock_validate.assert_called_once()
        mock_session.return_value.begin.return_value.__enter__.return_value.add.assert_called_once()

    @patch("core.tools.workflow_as_tool.provider.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.update_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService.workflow_provider_to_controller")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_without_labels(
        self, mock_session, mock_validate, mock_transform, mock_label, mock_db, mock_from_db, factory
    ):
        """Test successful workflow tool update without providing labels."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            None,
            provider_mock,
            app_mock,
        ]
        params = factory.create_parameter_config_mock()

        # Act
        result = WorkflowToolManageService.update_workflow_tool(
            user_id=TEST_USER_ID,
            tenant_id=TEST_TENANT_ID,
            workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
            name=TEST_NAME,
            label=TEST_LABEL,
            icon=TEST_ICON,
            description=TEST_DESCRIPTION,
            parameters=params,
            labels=None,
        )

        # Assert
        assert result == {"result": "success"}
        mock_validate.assert_called_once()

    @patch("core.tools.workflow_as_tool.provider.WorkflowToolProviderController.from_db")
    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.utils.workflow_configuration_sync.WorkflowToolConfigurationUtils.ensure_no_human_input_nodes")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_update_transform_exception(self, mock_session, mock_validate, mock_db, mock_from_db, factory):
        """Test update_workflow_tool with transform exception."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        app_mock = factory.create_app_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            None,
            provider_mock,
            app_mock,
        ]
        params = factory.create_parameter_config_mock()
        mock_from_db.side_effect = Exception("transform error")

        # Act & Assert
        with pytest.raises(ValueError, match="transform error"):
            WorkflowToolManageService.update_workflow_tool(
                user_id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                workflow_tool_id=TEST_WORKFLOW_TOOL_ID,
                name=TEST_NAME,
                label=TEST_LABEL,
                icon=TEST_ICON,
                description=TEST_DESCRIPTION,
                parameters=params,
            )


class TestWorkflowToolManageServiceListTenant:
    """
    Unit tests for WorkflowToolManageService.list_tenant_workflow_tools.

    This test suite covers:
    - Empty tool list
    - Tools with load failures
    - Successful list retrieval
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowToolManageServiceFactory()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_empty_tenant_tools(self, mock_session, mock_db):
        """Test listing returns empty list when tenant has no tools."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalars.return_value.all.return_value = []

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools(TEST_USER_ID, TEST_TENANT_ID)

        # Assert
        assert result == []

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.get_tools_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_with_load_failure(self, mock_session, mock_transform, mock_label, mock_db, factory):
        """Test listing skips tools that fail to load."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalars.return_value.all.return_value = [
            provider_mock
        ]
        mock_transform.workflow_provider_to_controller.side_effect = Exception("Load failed")
        mock_label.return_value = {}

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools(TEST_USER_ID, TEST_TENANT_ID)

        # Assert
        assert result == []

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.get_tools_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_success(self, mock_session, mock_transform, mock_label, mock_db, factory):
        """Test successful listing of tenant workflow tools."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        controller_mock = factory.create_tool_controller_mock()
        api_entity_mock, _ = factory.create_api_entities_mock()

        mock_session.return_value.begin.return_value.__enter__.return_value.scalars.return_value.all.return_value = [
            provider_mock
        ]
        mock_transform.workflow_provider_to_controller.return_value = controller_mock
        mock_transform.workflow_provider_to_user_provider.return_value = api_entity_mock
        mock_transform.repack_provider.return_value = None
        mock_transform.convert_tool_entity_to_api_entity.return_value = MagicMock()
        mock_label.return_value = {TEST_WORKFLOW_TOOL_ID: TEST_LABELS}

        # Act
        result = WorkflowToolManageService.list_tenant_workflow_tools(TEST_USER_ID, TEST_TENANT_ID)

        # Assert
        assert len(result) == 1
        assert isinstance(result[0], ToolProviderApiEntity)


class TestWorkflowToolManageServiceDelete:
    """
    Unit tests for WorkflowToolManageService.delete_workflow_tool.

    This test suite covers:
    - Successful tool deletion
    """

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_delete_success(self, mock_session, mock_db):
        """Test successful deletion of workflow tool."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.execute.return_value = None

        # Act
        result = WorkflowToolManageService.delete_workflow_tool(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)

        # Assert
        assert result == {"result": "success"}
        mock_session.return_value.begin.return_value.__enter__.return_value.execute.assert_called_once()


class TestWorkflowToolManageServiceGet:
    """
    Unit tests for get_workflow_tool_by_tool_id and get_workflow_tool_by_app_id.

    This test suite covers:
    - Tool not found
    - App not found
    - Workflow not found
    - Successful retrieval
    - Empty tools list branch (coverage)
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowToolManageServiceFactory()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_get_by_tool_id_not_found(self, mock_session, mock_db):
        """Test get by tool ID fails when tool does not exist."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Tool not found"):
            WorkflowToolManageService.get_workflow_tool_by_tool_id(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_get_by_app_id_app_not_found(self, mock_session, mock_db, factory):
        """Test get by app ID fails when associated App is missing."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [provider_mock, None]

        # Act & Assert
        with pytest.raises(ValueError, match=f"App {TEST_WORKFLOW_APP_ID} not found"):
            WorkflowToolManageService.get_workflow_tool_by_app_id(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_APP_ID)

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.get_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.jsonable_encoder")
    @patch("core.tools.entities.tool_entities.emoji_icon_adapter.validate_json")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_get_success(self, mock_session, mock_icon, mock_json, mock_transform, mock_label, mock_db, factory):
        """Test successful tool retrieval by ID."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        app_mock = factory.create_app_mock()
        controller_mock = factory.create_tool_controller_mock()
        tool_mock = factory.create_workflow_tool_mock()

        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            provider_mock,
            app_mock,
        ]
        mock_transform.workflow_provider_to_controller.return_value = controller_mock
        controller_mock.get_tools.return_value = [tool_mock]
        mock_icon.return_value = TEST_ICON
        mock_json.return_value = []
        mock_label.return_value = TEST_LABELS

        # Act
        result = WorkflowToolManageService.get_workflow_tool_by_tool_id(
            TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID
        )

        # Assert
        assert result["workflow_tool_id"] == TEST_WORKFLOW_TOOL_ID
        assert result["synced"] is True
        assert "output_schema" in result

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_get_missing_workflow_and_empty_tools(self, mock_session, mock_transform, mock_db, factory):
        """Test get by tool ID fails when workflow is missing and provider has no tools."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        controller_mock = factory.create_tool_controller_mock()
        app_mock = factory.create_app_mock()
        app_mock.workflow = None
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            provider_mock,
            app_mock,
        ]

        # Act & Assert
        with pytest.raises(ValueError, match="Workflow not found"):
            WorkflowToolManageService.get_workflow_tool_by_tool_id(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)

        # Arrange
        app_mock.workflow = factory.create_workflow_mock()
        controller_mock.get_tools.return_value = []
        mock_transform.workflow_provider_to_controller.return_value = controller_mock
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.side_effect = [
            provider_mock,
            app_mock,
        ]

        # Act & Assert
        with pytest.raises(ValueError, match=f"Tool {TEST_WORKFLOW_TOOL_ID} not found"):
            WorkflowToolManageService.get_workflow_tool_by_tool_id(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)


class TestWorkflowToolManageServiceListSingle:
    """
    Unit tests for WorkflowToolManageService.list_single_workflow_tools.

    This test suite covers:
    - Tool not found
    - No tools in provider
    - Successful single tool list
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowToolManageServiceFactory()

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_single_tool_not_found(self, mock_session, mock_db):
        """Test list single tool fails when provider does not exist."""
        # Arrange
        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match=f"Tool {TEST_WORKFLOW_TOOL_ID} not found"):
            WorkflowToolManageService.list_single_workflow_tools(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.get_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_single_no_tools(self, mock_session, mock_transform, mock_label, mock_db, factory):
        """Test list single tool fails when provider has no tools."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        controller_mock = factory.create_tool_controller_mock()
        controller_mock.get_tools.return_value = []

        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = provider_mock
        mock_transform.workflow_provider_to_controller.return_value = controller_mock

        # Act & Assert
        with pytest.raises(ValueError, match=f"Tool {TEST_WORKFLOW_TOOL_ID} not found"):
            WorkflowToolManageService.list_single_workflow_tools(TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID)

    @patch("services.tools.workflow_tools_manage_service.db")
    @patch("core.tools.tool_label_manager.ToolLabelManager.get_tool_labels")
    @patch("services.tools.workflow_tools_manage_service.ToolTransformService")
    @patch("services.tools.workflow_tools_manage_service.sessionmaker")
    def test_list_single_success(self, mock_session, mock_transform, mock_label, mock_db, factory):
        """Test successful listing of a single workflow tool."""
        # Arrange
        provider_mock = factory.create_workflow_tool_provider_mock()
        controller_mock = factory.create_tool_controller_mock()
        tool_mock = factory.create_workflow_tool_mock()
        api_mock = MagicMock(spec=ToolApiEntity)

        mock_session.return_value.begin.return_value.__enter__.return_value.scalar.return_value = provider_mock
        mock_transform.workflow_provider_to_controller.return_value = controller_mock
        controller_mock.get_tools.return_value = [tool_mock]
        mock_transform.convert_tool_entity_to_api_entity.return_value = api_mock
        mock_label.return_value = TEST_LABELS

        # Act
        result = WorkflowToolManageService.list_single_workflow_tools(
            TEST_USER_ID, TEST_TENANT_ID, TEST_WORKFLOW_TOOL_ID
        )

        # Assert
        assert len(result) == 1
        assert isinstance(result[0], ToolApiEntity)
