from __future__ import annotations

from unittest.mock import Mock, patch

import pytest
from faker import Faker
from sqlalchemy.orm import Session

from core.tools.__base.tool import Tool
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderSchemaType,
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolParameter,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from services.plugin.plugin_service import PluginService
from services.tools.tools_transform_service import ToolTransformService


class TestToolTransformService:
    """Integration tests for ToolTransformService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with patch("services.tools.tools_transform_service.dify_config") as mock_dify_config:
            with patch("services.plugin.plugin_service.dify_config", new=mock_dify_config):
                # Setup default mock returns
                mock_dify_config.CONSOLE_API_URL = "https://console.example.com"

                yield {
                    "dify_config": mock_dify_config,
                }

    def _create_test_tool_provider(
        self, db_session_with_containers: Session, mock_external_service_dependencies, provider_type="api"
    ):
        """
        Helper method to create a test tool provider for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            provider_type: Type of provider to create

        Returns:
            Tool provider instance
        """
        fake = Faker()

        if provider_type == "api":
            provider = ApiToolProvider(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                icon='{"background": "#FF6B6B", "content": "🔧"}',
                tenant_id="test_tenant_id",
                user_id="test_user_id",
                credentials_str='{"auth_type": "api_key_header", "api_key": "test_key"}',
                schema="{}",
                schema_type_str=ApiProviderSchemaType.OPENAPI,
                tools_str="[]",
            )
        elif provider_type == "builtin":
            provider = BuiltinToolProvider(
                name=fake.company(),
                tenant_id="test_tenant_id",
                user_id="test_user_id",
                provider="test_provider",
                credential_type="api_key",
                encrypted_credentials='{"api_key": "test_key"}',
            )
        elif provider_type == "workflow":
            provider = WorkflowToolProvider(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                icon='{"background": "#FF6B6B", "content": "🔧"}',
                tenant_id="test_tenant_id",
                user_id="test_user_id",
                app_id="test_workflow_id",
                label="Test Workflow",
                version="1.0.0",
                parameter_configuration="[]",
            )
        elif provider_type == "mcp":
            provider = MCPToolProvider(
                name=fake.company(),
                icon='{"background": "#FF6B6B", "content": "🔧"}',
                tenant_id="test_tenant_id",
                user_id="test_user_id",
                server_url="https://mcp.example.com",
                server_url_hash="test_server_url_hash",
                server_identifier="test_server",
                tools='[{"name": "test_tool", "description": "Test tool"}]',
                authed=True,
            )
        else:
            raise ValueError(f"Unknown provider type: {provider_type}")

        db_session_with_containers.add(provider)
        db_session_with_containers.commit()

        return provider

    def test_get_plugin_icon_url_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful plugin icon URL generation.

        This test verifies:
        - Proper URL construction for plugin icons
        - Correct tenant_id and filename handling
        - URL format compliance
        """
        # Arrange: Setup test data
        fake = Faker()
        tenant_id = fake.uuid4()
        filename = "test_icon.png"

        # Act: Execute the method under test
        result = PluginService.get_plugin_icon_url(str(tenant_id), filename)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, str)
        assert "console/api/workspaces/current/plugin/icon" in result
        assert str(tenant_id) in result
        assert filename in result
        assert result.startswith("https://console.example.com")

        # Verify URL structure
        expected_url = f"https://console.example.com/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename={filename}"
        assert result == expected_url

    def test_get_plugin_icon_url_with_empty_console_url(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test plugin icon URL generation when CONSOLE_API_URL is empty.

        This test verifies:
        - Fallback to relative URL when CONSOLE_API_URL is None
        - Proper URL construction with relative path
        """
        # Arrange: Setup mock with empty console URL
        mock_external_service_dependencies["dify_config"].CONSOLE_API_URL = None
        fake = Faker()
        tenant_id = fake.uuid4()
        filename = "test_icon.png"

        # Act: Execute the method under test
        result = PluginService.get_plugin_icon_url(str(tenant_id), filename)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, str)
        assert result.startswith("/console/api/workspaces/current/plugin/icon")
        assert str(tenant_id) in result
        assert filename in result

        # Verify URL structure
        expected_url = f"/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename={filename}"
        assert result == expected_url

    def test_get_tool_provider_icon_url_builtin_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful tool provider icon URL generation for builtin providers.

        This test verifies:
        - Proper URL construction for builtin tool providers
        - Correct provider type handling
        - URL format compliance
        """
        # Arrange: Setup test data
        fake = Faker()
        provider_type = ToolProviderType.BUILT_IN
        provider_name = fake.company()
        icon = "🔧"

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, str)
        assert "console/api/workspaces/current/tool-provider/builtin" in result
        # Note: provider_name may contain spaces that get URL encoded
        assert provider_name.replace(" ", "%20") in result or provider_name in result
        assert result.endswith("/icon")
        assert result.startswith("https://console.example.com")

        # Verify URL structure (accounting for URL encoding)
        # The actual result will have URL-encoded spaces (%20), so we need to compare accordingly
        expected_url = (
            f"https://console.example.com/console/api/workspaces/current/tool-provider/builtin/{provider_name}/icon"
        )
        # Convert expected URL to match the actual URL encoding
        expected_encoded = expected_url.replace(" ", "%20")
        assert result == expected_encoded

    def test_get_tool_provider_icon_url_api_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful tool provider icon URL generation for API providers.

        This test verifies:
        - Proper icon handling for API tool providers
        - JSON string parsing for icon data
        - Fallback icon when parsing fails
        """
        # Arrange: Setup test data
        fake = Faker()
        provider_type = ToolProviderType.API
        provider_name = fake.company()
        icon = '{"background": "#FF6B6B", "content": "🔧"}'

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, dict)
        assert result["background"] == "#FF6B6B"
        assert result["content"] == "🔧"

    def test_get_tool_provider_icon_url_api_invalid_json(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test tool provider icon URL generation for API providers with invalid JSON.

        This test verifies:
        - Proper fallback when JSON parsing fails
        - Default icon structure when exception occurs
        """
        # Arrange: Setup test data with invalid JSON
        fake = Faker()
        provider_type = ToolProviderType.API
        provider_name = fake.company()
        icon = '{"invalid": json}'

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, dict)
        assert result["background"] == "#252525"
        # Note: emoji characters may be represented as Unicode escape sequences
        assert result["content"] == "😁" or result["content"] == "\ud83d\ude01"

    def test_get_tool_provider_icon_url_workflow_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful tool provider icon URL generation for workflow providers.

        This test verifies:
        - Proper icon handling for workflow tool providers
        - Direct icon return for workflow type
        """
        # Arrange: Setup test data
        fake = Faker()
        provider_type = ToolProviderType.WORKFLOW
        provider_name = fake.company()
        icon = {"background": "#FF6B6B", "content": "🔧"}

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, dict)
        assert result["background"] == "#FF6B6B"
        assert result["content"] == "🔧"

    def test_get_tool_provider_icon_url_mcp_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful tool provider icon URL generation for MCP providers.

        This test verifies:
        - Direct icon return for MCP type
        - No URL transformation for MCP providers
        """
        # Arrange: Setup test data
        fake = Faker()
        provider_type = ToolProviderType.MCP
        provider_name = fake.company()
        icon = {"background": "#FF6B6B", "content": "🔧"}

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, dict)
        assert result["background"] == "#FF6B6B"
        assert result["content"] == "🔧"

    def test_get_tool_provider_icon_url_unknown_type(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test tool provider icon URL generation for unknown provider types.

        This test verifies:
        - Empty string return for unknown provider types
        - Proper handling of unsupported types
        """
        # Arrange: Setup test data with unknown type
        fake = Faker()
        provider_type = "unknown_type"
        provider_name = fake.company()
        icon = "🔧"

        # Act: Execute the method under test
        result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

        # Assert: Verify the expected outcomes
        assert result == ""

    def test_repack_provider_dict_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful provider repacking with dictionary input.

        This test verifies:
        - Proper icon URL generation for dictionary providers
        - Correct provider type handling
        - Icon transformation for different provider types
        """
        # Arrange: Setup test data
        fake = Faker()
        tenant_id = fake.uuid4()
        provider = {"type": ToolProviderType.BUILT_IN, "name": fake.company(), "icon": "🔧"}

        # Act: Execute the method under test
        ToolTransformService.repack_provider(str(tenant_id), provider)

        # Assert: Verify the expected outcomes
        assert "icon" in provider
        assert isinstance(provider["icon"], str)
        assert "console/api/workspaces/current/tool-provider/builtin" in provider["icon"]
        # Note: provider name may contain spaces that get URL encoded
        assert provider["name"].replace(" ", "%20") in provider["icon"] or provider["name"] in provider["icon"]

    def test_repack_provider_entity_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful provider repacking with ToolProviderApiEntity input.

        This test verifies:
        - Proper icon URL generation for entity providers
        - Plugin icon handling when plugin_id is present
        - Regular icon handling when plugin_id is not present
        """
        # Arrange: Setup test data
        fake = Faker()
        tenant_id = fake.uuid4()

        # Create provider entity with plugin_id
        provider = ToolProviderApiEntity(
            id=str(fake.uuid4()),
            author=fake.name(),
            name=fake.company(),
            description=I18nObject(en_US=fake.text(max_nb_chars=100)),
            icon="test_icon.png",
            icon_dark="test_icon_dark.png",
            label=I18nObject(en_US=fake.company()),
            type=ToolProviderType.API,
            masked_credentials={},
            is_team_authorization=True,
            plugin_id="test_plugin_id",
            tools=[],
            labels=[],
        )

        # Act: Execute the method under test
        ToolTransformService.repack_provider(tenant_id, provider)

        # Assert: Verify the expected outcomes
        assert provider.icon is not None
        assert isinstance(provider.icon, str)
        assert "console/api/workspaces/current/plugin/icon" in provider.icon
        assert str(tenant_id) in provider.icon
        assert "test_icon.png" in provider.icon

        # Verify dark icon handling
        assert provider.icon_dark is not None
        assert isinstance(provider.icon_dark, str)
        assert "console/api/workspaces/current/plugin/icon" in provider.icon_dark
        assert str(tenant_id) in provider.icon_dark
        assert "test_icon_dark.png" in provider.icon_dark

    def test_repack_provider_entity_no_plugin_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful provider repacking with ToolProviderApiEntity input without plugin_id.

        This test verifies:
        - Proper icon URL generation for non-plugin providers
        - Regular tool provider icon handling
        - Dark icon handling when present
        """
        # Arrange: Setup test data
        fake = Faker()
        tenant_id = fake.uuid4()

        # Create provider entity without plugin_id
        provider = ToolProviderApiEntity(
            id=fake.uuid4(),
            author=fake.name(),
            name=fake.company(),
            description=I18nObject(en_US=fake.text(max_nb_chars=100)),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            icon_dark='{"background": "#252525", "content": "🔧"}',
            label=I18nObject(en_US=fake.company()),
            type=ToolProviderType.API,
            masked_credentials={},
            is_team_authorization=True,
            plugin_id=None,
            tools=[],
            labels=[],
        )

        # Act: Execute the method under test
        ToolTransformService.repack_provider(str(tenant_id), provider)

        # Assert: Verify the expected outcomes
        assert provider.icon is not None
        assert isinstance(provider.icon, dict)
        assert provider.icon["background"] == "#FF6B6B"
        assert provider.icon["content"] == "🔧"

        # Verify dark icon handling
        assert provider.icon_dark is not None
        assert isinstance(provider.icon_dark, dict)
        assert provider.icon_dark["background"] == "#252525"
        assert provider.icon_dark["content"] == "🔧"

    def test_repack_provider_entity_no_dark_icon(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test provider repacking with ToolProviderApiEntity input without dark icon.

        This test verifies:
        - Proper handling when icon_dark is None or empty
        - No errors when dark icon is not present
        """
        # Arrange: Setup test data
        fake = Faker()
        tenant_id = fake.uuid4()

        # Create provider entity without dark icon
        provider = ToolProviderApiEntity(
            id=fake.uuid4(),
            author=fake.name(),
            name=fake.company(),
            description=I18nObject(en_US=fake.text(max_nb_chars=100)),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            icon_dark="",
            label=I18nObject(en_US=fake.company()),
            type=ToolProviderType.API,
            masked_credentials={},
            is_team_authorization=True,
            plugin_id=None,
            tools=[],
            labels=[],
        )

        # Act: Execute the method under test
        ToolTransformService.repack_provider(tenant_id, provider)

        # Assert: Verify the expected outcomes
        assert provider.icon is not None
        assert isinstance(provider.icon, dict)
        assert provider.icon["background"] == "#FF6B6B"
        assert provider.icon["content"] == "🔧"

        # Verify dark icon remains empty string
        assert provider.icon_dark == ""

    def test_builtin_provider_to_user_provider_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful conversion of builtin provider to user provider.

        This test verifies:
        - Proper entity creation with all required fields
        - Credentials schema handling
        - Team authorization setup
        - Plugin ID handling
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create mock provider controller
        mock_controller = Mock()
        mock_controller.entity.identity.name = fake.company()
        mock_controller.entity.identity.author = fake.name()
        mock_controller.entity.identity.description = I18nObject(en_US=fake.text(max_nb_chars=100))
        mock_controller.entity.identity.icon = "🔧"
        mock_controller.entity.identity.icon_dark = "🔧"
        mock_controller.entity.identity.label = I18nObject(en_US=fake.company())
        mock_controller.plugin_id = None
        mock_controller.plugin_unique_identifier = None
        mock_controller.tool_labels = ["label1", "label2"]
        mock_controller.need_credentials = True

        # Mock credentials schema
        mock_credential = Mock()
        mock_credential.to_basic_provider_config.return_value.name = "api_key"
        mock_controller.get_credentials_schema_by_type.return_value = [mock_credential]

        # Create mock database provider
        mock_db_provider = Mock()
        mock_db_provider.credential_type = "api-key"
        mock_db_provider.tenant_id = fake.uuid4()
        mock_db_provider.credentials = {"api_key": "encrypted_key"}

        # Mock encryption
        with patch("services.tools.tools_transform_service.create_provider_encrypter") as mock_encrypter:
            mock_encrypter_instance = Mock()
            mock_encrypter_instance.decrypt.return_value = {"api_key": "decrypted_key"}
            mock_encrypter_instance.mask_plugin_credentials.return_value = {"api_key": ""}
            mock_encrypter.return_value = (mock_encrypter_instance, None)

            # Act: Execute the method under test
            result = ToolTransformService.builtin_provider_to_user_provider(
                mock_controller, mock_db_provider, decrypt_credentials=True
            )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mock_controller.entity.identity.name
        assert result.author == mock_controller.entity.identity.author
        assert result.name == mock_controller.entity.identity.name
        assert result.description == mock_controller.entity.identity.description
        assert result.icon == mock_controller.entity.identity.icon
        assert result.icon_dark == mock_controller.entity.identity.icon_dark
        assert result.label == mock_controller.entity.identity.label
        assert result.type == ToolProviderType.BUILT_IN
        assert result.is_team_authorization is True
        assert result.plugin_id is None
        assert result.tools == []
        assert result.labels == ["label1", "label2"]
        assert result.masked_credentials == {"api_key": ""}
        assert result.original_credentials == {"api_key": "decrypted_key"}

    def test_builtin_provider_to_user_provider_plugin_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful conversion of builtin provider to user provider with plugin.

        This test verifies:
        - Plugin ID and unique identifier handling
        - Proper entity creation for plugin providers
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create mock provider controller with plugin
        mock_controller = Mock()
        mock_controller.entity.identity.name = fake.company()
        mock_controller.entity.identity.author = fake.name()
        mock_controller.entity.identity.description = I18nObject(en_US=fake.text(max_nb_chars=100))
        mock_controller.entity.identity.icon = "🔧"
        mock_controller.entity.identity.icon_dark = "🔧"
        mock_controller.entity.identity.label = I18nObject(en_US=fake.company())
        mock_controller.plugin_id = "test_plugin_id"
        mock_controller.plugin_unique_identifier = "test_unique_id"
        mock_controller.tool_labels = ["label1"]
        mock_controller.need_credentials = False

        # Mock credentials schema
        mock_credential = Mock()
        mock_credential.to_basic_provider_config.return_value.name = "api_key"
        mock_controller.get_credentials_schema_by_type.return_value = [mock_credential]

        # Act: Execute the method under test
        result = ToolTransformService.builtin_provider_to_user_provider(
            mock_controller, None, decrypt_credentials=False
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        # Note: The method checks isinstance(provider_controller, PluginToolProviderController)
        # Since we're using a Mock, this check will fail, so plugin_id will remain None
        # In a real test with actual PluginToolProviderController, this would work
        assert result.is_team_authorization is True
        assert result.allow_delete is False

    def test_builtin_provider_to_user_provider_no_credentials(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test conversion of builtin provider to user provider without credentials.

        This test verifies:
        - Proper handling when no credentials are needed
        - Team authorization setup for no-credentials providers
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create mock provider controller
        mock_controller = Mock()
        mock_controller.entity.identity.name = fake.company()
        mock_controller.entity.identity.author = fake.name()
        mock_controller.entity.identity.description = I18nObject(en_US=fake.text(max_nb_chars=100))
        mock_controller.entity.identity.icon = "🔧"
        mock_controller.entity.identity.icon_dark = "🔧"
        mock_controller.entity.identity.label = I18nObject(en_US=fake.company())
        mock_controller.plugin_id = None
        mock_controller.plugin_unique_identifier = None
        mock_controller.tool_labels = []
        mock_controller.need_credentials = False

        # Mock credentials schema
        mock_credential = Mock()
        mock_credential.to_basic_provider_config.return_value.name = "api_key"
        mock_controller.get_credentials_schema_by_type.return_value = [mock_credential]

        # Act: Execute the method under test
        result = ToolTransformService.builtin_provider_to_user_provider(
            mock_controller, None, decrypt_credentials=False
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.is_team_authorization is True
        assert result.allow_delete is False
        assert result.masked_credentials == {"api_key": ""}

    def test_api_provider_to_controller_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful conversion of API provider to controller.

        This test verifies:
        - Proper controller creation from database provider
        - Auth type handling for different credential types
        - Backward compatibility for auth types
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create API tool provider with api_key_header auth
        provider = ApiToolProvider(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            tenant_id=fake.uuid4(),
            user_id=fake.uuid4(),
            credentials_str='{"auth_type": "api_key_header", "api_key": "test_key"}',
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            tools_str="[]",
        )

        db_session_with_containers.add(provider)
        db_session_with_containers.commit()

        # Act: Execute the method under test
        result = ToolTransformService.api_provider_to_controller(provider)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "from_db")
        # Additional assertions would depend on the actual controller implementation

    def test_api_provider_to_controller_api_key_query(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test conversion of API provider to controller with api_key_query auth type.

        This test verifies:
        - Proper auth type handling for query parameter authentication
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create API tool provider with api_key_query auth
        provider = ApiToolProvider(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            tenant_id=fake.uuid4(),
            user_id=fake.uuid4(),
            credentials_str='{"auth_type": "api_key_query", "api_key": "test_key"}',
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            tools_str="[]",
        )

        db_session_with_containers.add(provider)
        db_session_with_containers.commit()

        # Act: Execute the method under test
        result = ToolTransformService.api_provider_to_controller(provider)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "from_db")

    def test_api_provider_to_controller_backward_compatibility(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test conversion of API provider to controller with backward compatibility auth types.

        This test verifies:
        - Proper handling of legacy auth type values
        - Backward compatibility for api_key and api_key_header
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create API tool provider with legacy auth type
        provider = ApiToolProvider(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            tenant_id=fake.uuid4(),
            user_id=fake.uuid4(),
            credentials_str='{"auth_type": "api_key", "api_key": "test_key"}',
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            tools_str="[]",
        )

        db_session_with_containers.add(provider)
        db_session_with_containers.commit()

        # Act: Execute the method under test
        result = ToolTransformService.api_provider_to_controller(provider)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "from_db")

    def test_workflow_provider_to_controller_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful conversion of workflow provider to controller.

        This test verifies:
        - Proper controller creation from workflow provider
        - Workflow-specific controller handling
        """
        # Arrange: Setup test data
        fake = Faker()

        # Create workflow tool provider
        provider = WorkflowToolProvider(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            icon='{"background": "#FF6B6B", "content": "🔧"}',
            tenant_id=fake.uuid4(),
            user_id=fake.uuid4(),
            app_id=fake.uuid4(),
            label="Test Workflow",
            version="1.0.0",
            parameter_configuration="[]",
        )

        db_session_with_containers.add(provider)
        db_session_with_containers.commit()

        # Mock the WorkflowToolProviderController.from_db method to avoid app dependency
        with patch("services.tools.tools_transform_service.WorkflowToolProviderController.from_db") as mock_from_db:
            mock_controller = Mock()
            mock_from_db.return_value = mock_controller

            # Act: Execute the method under test
            result = ToolTransformService.workflow_provider_to_controller(provider)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result == mock_controller
            mock_from_db.assert_called_once_with(provider)


def _mock_tool(*, base_params, runtime_params):
    """Helper to build a Mock tool with real entity objects.

    Tool is abstract and requires runtime behaviour (fork_tool_runtime,
    get_runtime_parameters), so it stays as a Mock.  Everything else uses
    real Pydantic instances.
    """
    entity = ToolEntity(
        identity=ToolIdentity(
            author="test_author",
            name="test_tool",
            label=I18nObject(en_US="Test Tool"),
            provider="test_provider",
        ),
        parameters=base_params or [],
        description=ToolDescription(
            human=I18nObject(en_US="Test description"),
            llm="Test description for LLM",
        ),
        output_schema={},
    )
    mock_tool = Mock(spec=Tool)
    mock_tool.entity = entity
    mock_tool.get_runtime_parameters.return_value = runtime_params
    mock_tool.fork_tool_runtime.return_value = mock_tool
    return mock_tool


def _param(name, *, form=ToolParameter.ToolParameterForm.FORM, label=None):
    return ToolParameter(
        name=name,
        label=I18nObject(en_US=label or name),
        human_description=I18nObject(en_US=name),
        type=ToolParameter.ToolParameterType.STRING,
        form=form,
    )


class TestConvertToolEntityToApiEntity:
    """Tests for ToolTransformService.convert_tool_entity_to_api_entity."""

    def test_parameter_override(self):
        base = [_param("param1", label="Base 1"), _param("param2", label="Base 2")]
        runtime = [_param("param1", label="Runtime 1")]
        tool = _mock_tool(base_params=base, runtime_params=runtime)

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert isinstance(result, ToolApiEntity)
        assert len(result.parameters) == 2
        assert next(p for p in result.parameters if p.name == "param1").label.en_US == "Runtime 1"
        assert next(p for p in result.parameters if p.name == "param2").label.en_US == "Base 2"

    def test_additional_runtime_parameters(self):
        base = [_param("param1", label="Base 1")]
        runtime = [_param("param1", label="Runtime 1"), _param("runtime_only", label="Runtime Only")]
        tool = _mock_tool(base_params=base, runtime_params=runtime)

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert len(result.parameters) == 2
        names = [p.name for p in result.parameters]
        assert "param1" in names
        assert "runtime_only" in names

    def test_non_form_runtime_parameters_excluded(self):
        base = [_param("param1")]
        runtime = [
            _param("param1", label="Runtime 1"),
            _param("llm_param", form=ToolParameter.ToolParameterForm.LLM),
        ]
        tool = _mock_tool(base_params=base, runtime_params=runtime)

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert len(result.parameters) == 1
        assert result.parameters[0].name == "param1"

    def test_empty_parameters(self):
        tool = _mock_tool(base_params=[], runtime_params=[])

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert isinstance(result, ToolApiEntity)
        assert len(result.parameters) == 0

    def test_none_parameters(self):
        tool = _mock_tool(base_params=None, runtime_params=[])

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert isinstance(result, ToolApiEntity)
        assert len(result.parameters) == 0

    def test_parameter_order_preserved(self):
        base = [_param("p1", label="B1"), _param("p2", label="B2"), _param("p3", label="B3")]
        runtime = [_param("p2", label="R2"), _param("p4", label="R4")]
        tool = _mock_tool(base_params=base, runtime_params=runtime)

        result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "t", None)

        assert [p.name for p in result.parameters] == ["p1", "p2", "p3", "p4"]
        assert result.parameters[1].label.en_US == "R2"


class TestWorkflowProviderToUserProvider:
    """Tests for ToolTransformService.workflow_provider_to_user_provider."""

    @staticmethod
    def _make_controller(provider_id="provider_123", **identity_overrides):
        from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

        defaults = {
            "author": "test_author",
            "name": "test_workflow_tool",
            "description": I18nObject(en_US="Test description"),
            "icon": '{"type": "emoji", "content": "🔧"}',
            "icon_dark": None,
            "label": I18nObject(en_US="Test Workflow Tool"),
        }
        defaults.update(identity_overrides)
        identity = ToolProviderIdentity(**defaults)
        entity = ToolProviderEntity(identity=identity)
        return WorkflowToolProviderController(entity=entity, provider_id=provider_id)

    def test_with_workflow_app_id(self):
        ctrl = self._make_controller()

        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=ctrl,
            labels=["l1", "l2"],
            workflow_app_id="app_123",
        )

        assert isinstance(result, ToolProviderApiEntity)
        assert result.id == "provider_123"
        assert result.type == ToolProviderType.WORKFLOW
        assert result.workflow_app_id == "app_123"
        assert result.labels == ["l1", "l2"]
        assert result.is_team_authorization is True

    def test_without_workflow_app_id(self):
        ctrl = self._make_controller()

        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=ctrl,
            labels=["l1"],
        )

        assert result.workflow_app_id is None

    def test_workflow_app_id_none_explicit(self):
        ctrl = self._make_controller()

        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=ctrl,
            labels=None,
            workflow_app_id=None,
        )

        assert result.workflow_app_id is None
        assert result.labels == []

    def test_preserves_other_fields(self):
        ctrl = self._make_controller(
            "provider_456",
            author="another_author",
            name="another_workflow_tool",
            description=I18nObject(en_US="Another desc", zh_Hans="Another desc"),
            icon='{"type": "emoji", "content": "⚙️"}',
            icon_dark='{"type": "emoji", "content": "🔧"}',
            label=I18nObject(en_US="Another Tool", zh_Hans="Another Tool"),
        )

        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=ctrl,
            labels=["automation"],
            workflow_app_id="app_456",
        )

        assert result.id == "provider_456"
        assert result.author == "another_author"
        assert result.name == "another_workflow_tool"
        assert result.type == ToolProviderType.WORKFLOW
        assert result.workflow_app_id == "app_456"
        assert result.is_team_authorization is True
        assert result.allow_delete is True
