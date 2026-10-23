from unittest.mock import ANY, MagicMock, Mock, patch

import pytest
from pytest_mock import MockerFixture

from core.mcp.types import Tool as MCPTool
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolParameter,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from models.account import Account
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService
from tests.tool_fixtures import make_runtime_tool

"""Test cases for MCP tool transformation functionality."""


class TestMcpToolsTransformCases:
    @staticmethod
    @pytest.fixture
    def mock_user():
        """Provides a real mapped account returned by the provider lookup."""
        return Account(name="Test User", email="user@example.com")

    @staticmethod
    @pytest.fixture
    def mock_provider(mock_user, mocker: MockerFixture):
        """Provides a mock MCPToolProvider with a loaded user."""
        provider = MCPToolProvider(
            name="Test Provider",
            server_identifier="test-provider",
            server_url="https://example.com",
            server_url_hash="hash",
            icon="icon",
            tenant_id="tenant-id",
            user_id="user-id",
        )
        mocker.patch.object(provider, "load_user", return_value=mock_user)
        return provider

    @staticmethod
    @pytest.fixture
    def mock_provider_no_user(mocker: MockerFixture):
        """Provides a mock MCPToolProvider with no user."""
        provider = MCPToolProvider(
            name="Test Provider",
            server_identifier="test-provider",
            server_url="https://example.com",
            server_url_hash="hash",
            icon="icon",
            tenant_id="tenant-id",
            user_id="user-id",
        )
        mocker.patch.object(provider, "load_user", return_value=None)
        return provider

    @staticmethod
    @pytest.fixture
    def mock_provider_full(mock_user, mocker: MockerFixture):
        """Provides a fully configured mock MCPToolProvider for detailed tests."""
        provider = MCPToolProvider(
            name="Test MCP Provider",
            server_identifier="server-identifier-456",
            server_url="https://example.com",
            server_url_hash="hash",
            icon="icon",
            tenant_id="tenant-id",
            user_id="user-id",
            authed=True,
            timeout=30,
            sse_read_timeout=300,
        )
        provider.id = "provider-id-123"
        provider.provider_icon = "icon.png"
        provider.masked_server_url = "https://*****.com/mcp"
        provider.masked_headers = {"Authorization": "Bearer *****"}
        provider.decrypted_headers = {"Authorization": "Bearer secret-token"}

        # Mock timestamp
        mock_updated_at = Mock()
        mock_updated_at.timestamp.return_value = 1234567890
        provider.updated_at = mock_updated_at

        mocker.patch.object(provider, "load_user", return_value=mock_user)
        return provider

    @staticmethod
    @pytest.fixture
    def sample_mcp_tools():
        """Provides sample MCP tools for testing."""
        return {
            "simple": MCPTool(
                name="simple_tool", description="A simple test tool", inputSchema={"type": "object", "properties": {}}
            ),
            "none_desc": MCPTool(
                name="tool_none_desc", description=None, inputSchema={"type": "object", "properties": {}}
            ),
            "complex": MCPTool(
                name="complex_tool",
                description="A tool with complex parameters",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Input text"},
                        "count": {"type": "integer", "description": "Number of items", "minimum": 1, "maximum": 100},
                        "options": {"type": "array", "items": {"type": "string"}, "description": "List of options"},
                    },
                    "required": ["text"],
                },
            ),
        }

    class TestMCPToolTransform:
        """Test cases for MCP tool transformation methods."""

        def test_mcp_tool_to_user_tool_with_none_description(self, mock_provider):
            """Test that mcp_tool_to_user_tool handles None description correctly."""
            # Create MCP tools with None description
            tools = [
                MCPTool(
                    name="tool1",
                    description=None,  # This is the case that caused the error
                    inputSchema={"type": "object", "properties": {}},
                ),
                MCPTool(
                    name="tool2",
                    description=None,
                    inputSchema={
                        "type": "object",
                        "properties": {"param1": {"type": "string", "description": "A parameter"}},
                    },
                ),
            ]

            # Call the method
            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

            # Verify the result
            assert len(result) == 2
            assert all(isinstance(tool, ToolApiEntity) for tool in result)

            # Check first tool
            assert result[0].name == "tool1"
            assert result[0].author == "Test User"
            assert isinstance(result[0].label, I18nObject)
            assert result[0].label.en_US == "tool1"
            assert isinstance(result[0].description, I18nObject)
            assert result[0].description.en_US == ""  # Should be empty string, not None
            assert result[0].description.zh_Hans == ""

            # Check second tool
            assert result[1].name == "tool2"
            assert result[1].description.en_US == ""
            assert result[1].description.zh_Hans == ""

        def test_mcp_tool_to_user_tool_with_description(self, mock_provider):
            """Test that mcp_tool_to_user_tool handles normal description correctly."""
            # Create MCP tools with description
            tools = [
                MCPTool(
                    name="tool_with_desc",
                    description="This is a test tool that does something useful",
                    inputSchema={"type": "object", "properties": {}},
                )
            ]

            # Call the method
            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

            # Verify the result
            assert len(result) == 1
            assert isinstance(result[0], ToolApiEntity)
            assert result[0].name == "tool_with_desc"
            assert result[0].description.en_US == "This is a test tool that does something useful"
            assert result[0].description.zh_Hans == "This is a test tool that does something useful"

        def test_mcp_tool_to_user_tool_with_no_user(self, mock_provider_no_user):
            """Test that mcp_tool_to_user_tool handles None user correctly."""
            # Create MCP tool
            tools = [MCPTool(name="tool1", description="Test tool", inputSchema={"type": "object", "properties": {}})]

            # Call the method
            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider_no_user, tools)

            # Verify the result
            assert len(result) == 1
            assert result[0].author == "Anonymous"

        def test_mcp_tool_to_user_tool_with_complex_schema(self, mock_provider, sample_mcp_tools):
            """Test that mcp_tool_to_user_tool correctly converts complex input schemas."""
            # Use complex tool from fixtures
            tools = [sample_mcp_tools["complex"]]

            # Call the method
            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

            # Verify the result
            assert len(result) == 1
            assert result[0].name == "complex_tool"
            assert result[0].parameters is not None
            # The actual parameter conversion is handled by convert_mcp_schema_to_parameter
            # which should be tested separately

        def test_convert_mcp_schema_to_parameter_preserves_anyof_object_type(self):
            """Nullable object schemas should keep the object parameter type."""
            schema = {
                "type": "object",
                "properties": {
                    "retrieval_model": {
                        "anyOf": [{"type": "object"}, {"type": "null"}],
                        "description": "检索模型配置",
                    }
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 1
            assert result[0].name == "retrieval_model"
            assert result[0].type == ToolParameter.ToolParameterType.OBJECT
            assert result[0].input_schema == schema["properties"]["retrieval_model"]

        def test_convert_mcp_schema_to_parameter_preserves_oneof_object_type(self):
            """Nullable oneOf object schemas should keep the object parameter type."""
            schema = {
                "type": "object",
                "properties": {
                    "retrieval_model": {
                        "oneOf": [{"type": "object"}, {"type": "null"}],
                        "description": "检索模型配置",
                    }
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 1
            assert result[0].name == "retrieval_model"
            assert result[0].type == ToolParameter.ToolParameterType.OBJECT
            assert result[0].input_schema == schema["properties"]["retrieval_model"]

        def test_convert_mcp_schema_to_parameter_handles_null_type(self):
            """Schemas with only a null type should fall back to string."""
            schema = {
                "type": "object",
                "properties": {
                    "null_prop_str": {"type": "null"},
                    "null_prop_list": {"type": ["null"]},
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 2
            param_map = {parameter.name: parameter for parameter in result}
            assert "null_prop_str" in param_map
            assert param_map["null_prop_str"].type == ToolParameter.ToolParameterType.STRING
            assert "null_prop_list" in param_map
            assert param_map["null_prop_list"].type == ToolParameter.ToolParameterType.STRING

        def test_convert_mcp_schema_to_parameter_preserves_allof_object_type_with_multiple_object_items(self):
            """Property-level allOf with multiple object items should still resolve to object."""
            schema = {
                "type": "object",
                "properties": {
                    "config": {
                        "allOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "enabled": {"type": "boolean"},
                                },
                                "required": ["enabled"],
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "priority": {"type": "integer", "minimum": 1, "maximum": 10},
                                },
                                "required": ["priority"],
                            },
                        ],
                        "description": "Config must match all schemas (allOf)",
                    }
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 1
            assert result[0].name == "config"
            assert result[0].type == ToolParameter.ToolParameterType.OBJECT
            assert result[0].input_schema == schema["properties"]["config"]

        def test_convert_mcp_schema_to_parameter_preserves_allof_object_type(self):
            """Composed property schemas should keep the object parameter type."""
            schema = {
                "type": "object",
                "properties": {
                    "retrieval_model": {
                        "allOf": [
                            {"type": "object"},
                            {"properties": {"top_k": {"type": "integer"}}},
                        ],
                        "description": "检索模型配置",
                    }
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 1
            assert result[0].name == "retrieval_model"
            assert result[0].type == ToolParameter.ToolParameterType.OBJECT
            assert result[0].input_schema == schema["properties"]["retrieval_model"]

        def test_convert_mcp_schema_to_parameter_limits_recursive_schema_depth(self):
            """Self-referential composed schemas should stop resolving after the configured max depth."""
            recursive_property: dict[str, object] = {"description": "Recursive schema"}
            recursive_property["anyOf"] = [recursive_property]
            schema = {
                "type": "object",
                "properties": {
                    "recursive_config": recursive_property,
                },
            }

            result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(result) == 1
            assert result[0].name == "recursive_config"
            assert result[0].type == ToolParameter.ToolParameterType.STRING
            assert result[0].input_schema is None

        def test_mcp_provider_to_user_provider_minimal_response(self, mock_provider_full, mocker: MockerFixture):
            """Test mcp_provider_to_user_provider with a response that omits optional fields."""
            # Set tools data with null description
            mock_provider_full.tools = '[{"name": "tool1", "description": null, "inputSchema": {}}]'

            # Mock the to_entity and to_api_response methods
            mock_entity = Mock()
            mock_entity.to_api_response.return_value = {
                "name": "Test MCP Provider",
                "type": ToolProviderType.MCP,
                "is_team_authorization": True,
                "server_url": "https://*****.com/mcp",
                "provider_icon": "icon.png",
                "masked_headers": {"Authorization": "Bearer *****"},
                "updated_at": 1234567890,
                "labels": [],
                "author": "Test User",
                "description": I18nObject(
                    en_US="Test MCP Provider Description", zh_Hans="Test MCP Provider Description"
                ),
                "icon": "icon.png",
                "label": I18nObject(en_US="Test MCP Provider", zh_Hans="Test MCP Provider"),
                "masked_credentials": {},
            }
            mocker.patch.object(mock_provider_full, "to_entity", return_value=mock_entity)

            result = ToolTransformService.mcp_provider_to_user_provider(mock_provider_full)

            # Verify the result
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == "provider-id-123"
            assert result.name == "Test MCP Provider"
            assert result.type == ToolProviderType.MCP
            assert result.is_team_authorization is True
            assert result.server_url == "https://*****.com/mcp"
            assert len(result.tools) == 1
            assert result.tools[0].description.en_US == ""  # Should handle None description

        def test_mcp_provider_to_user_provider_full_response(self, mock_provider_full, mocker: MockerFixture):
            """Test mcp_provider_to_user_provider with configuration and sensitive fields."""
            # Set tools data with description
            mock_provider_full.tools = '[{"name": "tool1", "description": "Tool description", "inputSchema": {}}]'

            # Mock the to_entity and to_api_response methods
            mock_entity = Mock()
            mock_entity.to_api_response.return_value = {
                "name": "Test MCP Provider",
                "type": ToolProviderType.MCP,
                "is_team_authorization": True,
                "server_url": "https://*****.com/mcp",
                "provider_icon": "icon.png",
                "masked_headers": {"Authorization": "Bearer *****"},
                "updated_at": 1234567890,
                "labels": [],
                "configuration": {"timeout": "30", "sse_read_timeout": "300"},
                "original_headers": {"Authorization": "Bearer secret-token"},
                "author": "Test User",
                "description": I18nObject(
                    en_US="Test MCP Provider Description", zh_Hans="Test MCP Provider Description"
                ),
                "icon": "icon.png",
                "label": I18nObject(en_US="Test MCP Provider", zh_Hans="Test MCP Provider"),
                "masked_credentials": {},
            }
            mocker.patch.object(mock_provider_full, "to_entity", return_value=mock_entity)

            result = ToolTransformService.mcp_provider_to_user_provider(mock_provider_full)

            # Verify the result
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == "provider-id-123"
            assert result.server_identifier == "server-identifier-456"
            assert result.configuration is not None
            assert result.configuration.timeout == 30
            assert result.configuration.sse_read_timeout == 300
            assert result.original_headers == {"Authorization": "Bearer secret-token"}
            assert len(result.tools) == 1
            assert result.tools[0].description.en_US == "Tool description"

        def test_mcp_tool_to_user_tool_falls_back_to_name_when_title_is_null(self, mock_provider):
            """Tools where the server returned ``title: null`` should fall back to the tool name.

            Regression test for langgenius/dify#42453: Exa's MCP server returns
            ``title: null`` for some tools, breaking tool conversion when the
            server-provided title is required.
            """
            tools = [
                MCPTool(
                    name="search_web",
                    title=None,
                    description="Search the web",
                    inputSchema={"type": "object", "properties": {}},
                ),
                MCPTool(
                    name="get_content",
                    description="Fetch page content",
                    inputSchema={"type": "object", "properties": {}},
                ),
            ]

            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

            assert len(result) == 2
            # title is explicitly null -> must fall back to ``name``
            assert result[0].name == "search_web"
            assert result[0].label.en_US == "search_web"
            assert result[0].label.zh_Hans == "search_web"
            # title key is absent entirely -> must also fall back to ``name``
            assert result[1].name == "get_content"
            assert result[1].label.en_US == "get_content"
            assert result[1].label.zh_Hans == "get_content"

        def test_mcp_tool_to_user_tool_uses_title_when_provided(self, mock_provider):
            """When the server provides a non-null title, it should be used for the label."""
            tools = [
                MCPTool(
                    name="search_web",
                    title="Search the Web",
                    description="Search the web",
                    inputSchema={"type": "object", "properties": {}},
                )
            ]

            result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

            assert len(result) == 1
            assert result[0].name == "search_web"
            assert result[0].label.en_US == "Search the Web"
            assert result[0].label.zh_Hans == "Search the Web"


MODULE = "services.tools.tools_transform_service"


def _parameter(
    name: str,
    label: str,
    form: ToolParameter.ToolParameterForm = ToolParameter.ToolParameterForm.FORM,
) -> ToolParameter:
    return ToolParameter(
        name=name,
        label=I18nObject(en_US=label),
        human_description=I18nObject(en_US=label),
        type=ToolParameter.ToolParameterType.STRING,
        form=form,
    )


class TestToolsTransformServiceCases:
    class TestToolTransformService:
        """Test cases for ToolTransformService.convert_tool_entity_to_api_entity method"""

        def test_convert_tool_with_parameter_override(self):
            """Test that runtime parameters correctly override base parameters"""
            base_param1 = _parameter("param1", "Base Param 1")
            base_param2 = _parameter("param2", "Base Param 2")

            runtime_param1 = _parameter("param1", "Runtime Param 1")

            tool = make_runtime_tool(base_params=[base_param1, base_param2], runtime_params=[runtime_param1])

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.author == "test_author"
            assert result.name == "test_tool"
            assert result.parameters is not None
            assert len(result.parameters) == 2

            # Find the overridden parameter
            overridden_param = next((p for p in result.parameters if p.name == "param1"), None)
            assert overridden_param is not None
            assert overridden_param.label.en_US == "Runtime Param 1"  # Should be runtime version

            # Find the non-overridden parameter
            original_param = next((p for p in result.parameters if p.name == "param2"), None)
            assert original_param is not None
            assert original_param.label.en_US == "Base Param 2"  # Should be base version

        def test_convert_tool_with_additional_runtime_parameters(self):
            """Test that additional runtime parameters are added to the final list"""
            base_param1 = _parameter("param1", "Base Param 1")

            runtime_param1 = _parameter("param1", "Runtime Param 1")
            runtime_param2 = _parameter("runtime_only", "Runtime Only Param")

            tool = make_runtime_tool(base_params=[base_param1], runtime_params=[runtime_param1, runtime_param2])

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.parameters is not None
            assert len(result.parameters) == 2

            # Check that both parameters are present
            param_names = [p.name for p in result.parameters]
            assert "param1" in param_names
            assert "runtime_only" in param_names

            # Verify the overridden parameter has runtime version
            overridden_param = next((p for p in result.parameters if p.name == "param1"), None)
            assert overridden_param is not None
            assert overridden_param.label.en_US == "Runtime Param 1"

            # Verify the new runtime parameter is included
            new_param = next((p for p in result.parameters if p.name == "runtime_only"), None)
            assert new_param is not None
            assert new_param.label.en_US == "Runtime Only Param"

        def test_convert_tool_with_non_form_runtime_parameters(self):
            """Test that non-FORM runtime parameters are not added as new parameters"""
            base_param1 = _parameter("param1", "Base Param 1")

            runtime_param1 = _parameter("param1", "Runtime Param 1")
            runtime_param2 = _parameter("llm_param", "LLM Param", ToolParameter.ToolParameterForm.LLM)

            tool = make_runtime_tool(base_params=[base_param1], runtime_params=[runtime_param1, runtime_param2])

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.parameters is not None
            assert len(result.parameters) == 1  # Only the FORM parameter should be present

            # Check that only the FORM parameter is present
            param_names = [p.name for p in result.parameters]
            assert "param1" in param_names
            assert "llm_param" not in param_names

        def test_convert_tool_with_empty_parameters(self):
            """Test conversion with empty base and runtime parameters"""
            tool = make_runtime_tool(base_params=[], runtime_params=[])

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.parameters is not None
            assert len(result.parameters) == 0

        def test_convert_tool_with_none_parameters(self):
            """Test conversion when base parameters is None"""
            tool = make_runtime_tool(base_params=None, runtime_params=[])

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.parameters is not None
            assert len(result.parameters) == 0

        def test_convert_tool_parameter_order_preserved(self):
            """Test that parameter order is preserved correctly"""
            base_param1 = _parameter("param1", "Base Param 1")
            base_param2 = _parameter("param2", "Base Param 2")
            base_param3 = _parameter("param3", "Base Param 3")

            # Create runtime parameter that overrides middle parameter
            runtime_param2 = _parameter("param2", "Runtime Param 2")

            # Create new runtime parameter
            runtime_param4 = _parameter("param4", "Runtime Param 4")

            tool = make_runtime_tool(
                base_params=[base_param1, base_param2, base_param3], runtime_params=[runtime_param2, runtime_param4]
            )

            # Call the method
            result = ToolTransformService.convert_tool_entity_to_api_entity(tool, "test_tenant", None)

            # Verify the result
            assert isinstance(result, ToolApiEntity)
            assert result.parameters is not None
            assert len(result.parameters) == 4

            # Check that order is maintained: base parameters first, then new runtime parameters
            param_names = [p.name for p in result.parameters]
            assert param_names == ["param1", "param2", "param3", "param4"]

            # Verify that param2 was overridden with runtime version
            param2 = result.parameters[1]
            assert param2.name == "param2"
            assert param2.label.en_US == "Runtime Param 2"

    class TestWorkflowProviderToUserProvider:
        """Test cases for ToolTransformService.workflow_provider_to_user_provider method"""

        def test_workflow_provider_to_user_provider_with_workflow_app_id(self):
            """Test that workflow_provider_to_user_provider correctly sets workflow_app_id."""
            from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

            workflow_app_id = "app_123"
            provider_id = "provider_123"
            controller = WorkflowToolProviderController(
                provider_id=provider_id,
                entity=ToolProviderEntity(
                    # Retain legacy emoji mappings accepted by the API transformation.
                    identity=ToolProviderIdentity.model_construct(
                        author="test_author",
                        name="test_workflow_tool",
                        description=I18nObject(en_US="Test description"),
                        icon={"type": "emoji", "content": "🔧"},
                        icon_dark=None,
                        label=I18nObject(en_US="Test Workflow Tool"),
                    ),
                ),
            )

            # Call the method
            result = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=controller,
                labels=["label1", "label2"],
                workflow_app_id=workflow_app_id,
            )

            # Verify the result
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == provider_id
            assert result.author == "test_author"
            assert result.name == "test_workflow_tool"
            assert result.type == ToolProviderType.WORKFLOW
            assert result.workflow_app_id == workflow_app_id
            assert result.labels == ["label1", "label2"]
            assert result.is_team_authorization is True
            assert result.plugin_id is None
            assert result.plugin_unique_identifier is None
            assert result.tools == []

        def test_workflow_provider_to_user_provider_without_workflow_app_id(self):
            """Test that workflow_provider_to_user_provider works when workflow_app_id is not provided."""
            from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

            provider_id = "provider_123"
            controller = WorkflowToolProviderController(
                provider_id=provider_id,
                entity=ToolProviderEntity(
                    # Retain legacy emoji mappings accepted by the API transformation.
                    identity=ToolProviderIdentity.model_construct(
                        author="test_author",
                        name="test_workflow_tool",
                        description=I18nObject(en_US="Test description"),
                        icon={"type": "emoji", "content": "🔧"},
                        icon_dark=None,
                        label=I18nObject(en_US="Test Workflow Tool"),
                    ),
                ),
            )

            # Call the method without workflow_app_id
            result = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=controller,
                labels=["label1"],
            )

            # Verify the result
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == provider_id
            assert result.workflow_app_id is None
            assert result.labels == ["label1"]

        def test_workflow_provider_to_user_provider_workflow_app_id_none(self):
            """Test that workflow_provider_to_user_provider handles None workflow_app_id explicitly."""
            from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

            provider_id = "provider_123"
            controller = WorkflowToolProviderController(
                provider_id=provider_id,
                entity=ToolProviderEntity(
                    # Retain legacy emoji mappings accepted by the API transformation.
                    identity=ToolProviderIdentity.model_construct(
                        author="test_author",
                        name="test_workflow_tool",
                        description=I18nObject(en_US="Test description"),
                        icon={"type": "emoji", "content": "🔧"},
                        icon_dark=None,
                        label=I18nObject(en_US="Test Workflow Tool"),
                    ),
                ),
            )

            # Call the method with explicit None values
            result = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=controller,
                labels=None,
                workflow_app_id=None,
            )

            # Verify the result
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == provider_id
            assert result.workflow_app_id is None
            assert result.labels == []

        def test_workflow_provider_to_user_provider_preserves_other_fields(self):
            """Test that workflow_provider_to_user_provider preserves all other entity fields."""
            from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

            workflow_app_id = "app_456"
            provider_id = "provider_456"
            controller = WorkflowToolProviderController(
                provider_id=provider_id,
                entity=ToolProviderEntity(
                    # Retain legacy emoji mappings accepted by the API transformation.
                    identity=ToolProviderIdentity.model_construct(
                        author="another_author",
                        name="another_workflow_tool",
                        description=I18nObject(en_US="Another description", zh_Hans="Another description"),
                        icon={"type": "emoji", "content": "⚙️"},
                        icon_dark={"type": "emoji", "content": "🔧"},
                        label=I18nObject(en_US="Another Workflow Tool", zh_Hans="Another Workflow Tool"),
                    ),
                ),
            )

            # Call the method
            result = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=controller,
                labels=["automation", "workflow"],
                workflow_app_id=workflow_app_id,
            )

            # Verify all fields are preserved correctly
            assert isinstance(result, ToolProviderApiEntity)
            assert result.id == provider_id
            assert result.author == "another_author"
            assert result.name == "another_workflow_tool"
            assert result.description.en_US == "Another description"
            assert result.description.zh_Hans == "Another description"
            assert result.icon == {"type": "emoji", "content": "⚙️"}
            assert result.icon_dark == {"type": "emoji", "content": "🔧"}
            assert result.label.en_US == "Another Workflow Tool"
            assert result.label.zh_Hans == "Another Workflow Tool"
            assert result.type == ToolProviderType.WORKFLOW
            assert result.workflow_app_id == workflow_app_id
            assert result.labels == ["automation", "workflow"]
            assert result.masked_credentials == {}
            assert result.is_team_authorization is True
            assert result.allow_delete is True
            assert result.plugin_id is None
            assert result.plugin_unique_identifier is None
            assert result.tools == []

    class TestGetToolProviderIconUrl:
        def test_builtin_provider_returns_console_url(self, config_overrides):
            config_overrides(CONSOLE_API_URL="https://app.dify.ai")
            url = ToolTransformService.get_tool_provider_icon_url("builtin", "google", "icon.png")

            assert "/builtin/google/icon" in url
            assert url.startswith("https://app.dify.ai/console/api/workspaces/current/tool-provider")

        def test_builtin_provider_with_no_console_url(self, config_overrides):
            config_overrides(CONSOLE_API_URL=None)
            url = ToolTransformService.get_tool_provider_icon_url("builtin", "slack", "icon.png")

            assert "/builtin/slack/icon" in url

        def test_api_provider_parses_json_icon(self):
            icon_json = '{"background": "#fff", "content": "A"}'
            result = ToolTransformService.get_tool_provider_icon_url("api", "my-api", icon_json)
            assert result == {"background": "#fff", "content": "A"}

        def test_api_provider_returns_dict_icon_directly(self):
            icon = {"background": "#000", "content": "B"}
            result = ToolTransformService.get_tool_provider_icon_url("api", "my-api", icon)
            assert result == icon

        def test_api_provider_returns_fallback_on_invalid_json(self):
            result = ToolTransformService.get_tool_provider_icon_url("api", "my-api", "not-json")
            assert result == {"background": "#252525", "content": "\ud83d\ude01"}

        def test_workflow_provider_behaves_like_api(self):
            icon = {"background": "#123", "content": "W"}
            assert ToolTransformService.get_tool_provider_icon_url("workflow", "wf", icon) == icon

        def test_mcp_returns_icon_as_is(self):
            assert ToolTransformService.get_tool_provider_icon_url("mcp", "srv", "icon-value") == "icon-value"

        def test_unknown_type_returns_empty(self):
            assert ToolTransformService.get_tool_provider_icon_url("unknown", "x", "i") == ""

    class TestRepackProvider:
        def test_repacks_dict_provider_icon(self):
            provider = {"type": "builtin", "name": "google", "icon": "old"}
            with patch.object(ToolTransformService, "get_tool_provider_icon_url", return_value="/new-url") as mock_fn:
                ToolTransformService.repack_provider("t1", provider)

            assert provider["icon"] == "/new-url"
            mock_fn.assert_called_once_with(provider_type="builtin", provider_name="google", icon="old")

        def test_repacks_tool_provider_api_entity_without_plugin(self):
            entity = ToolProviderApiEntity(
                id="slack",
                author="test_author",
                name="slack",
                description=I18nObject(en_US="Slack"),
                label=I18nObject(en_US="Slack"),
                type=ToolProviderType.BUILT_IN,
                plugin_id=None,
                icon="icon.svg",
                icon_dark="dark.svg",
            )

            with patch.object(ToolTransformService, "get_tool_provider_icon_url", return_value="/url"):
                ToolTransformService.repack_provider("t1", entity)

            assert entity.icon == "/url"
            assert entity.icon_dark == "/url"

    class TestConvertMcpSchemaToParameter:
        def test_simple_object_schema(self):
            schema = {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "count": {"type": "integer", "description": "Result count"},
                },
                "required": ["query"],
            }

            params = ToolTransformService.convert_mcp_schema_to_parameter(schema)

            assert len(params) == 2
            query_param = next(p for p in params if p.name == "query")
            count_param = next(p for p in params if p.name == "count")
            assert query_param.required is True
            assert count_param.required is False
            assert count_param.type.value == "number"

        def test_float_maps_to_number(self):
            schema = {"type": "object", "properties": {"rate": {"type": "float"}}, "required": []}
            assert ToolTransformService.convert_mcp_schema_to_parameter(schema)[0].type.value == "number"

        def test_array_type_attaches_input_schema(self):
            prop = {"type": "array", "description": "Items", "items": {"type": "string"}}
            schema = {"type": "object", "properties": {"items": prop}, "required": []}
            param = ToolTransformService.convert_mcp_schema_to_parameter(schema)[0]
            assert param.input_schema is not None

        def test_non_object_schema_returns_empty(self):
            assert ToolTransformService.convert_mcp_schema_to_parameter({"type": "string"}) == []

        def test_missing_properties_returns_empty(self):
            assert ToolTransformService.convert_mcp_schema_to_parameter({"type": "object"}) == []

        def test_list_type_uses_first_element(self):
            schema = {"type": "object", "properties": {"f": {"type": ["string", "null"]}}, "required": []}
            assert ToolTransformService.convert_mcp_schema_to_parameter(schema)[0].type.value == "string"

        @pytest.mark.parametrize(
            ("prop", "expected_type"),
            [
                ({"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]}, "string"),
                ({"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "string"}]}, "array"),
                ({"oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]}, "string"),
                ({"oneOf": [{"type": "array", "items": {"type": "string"}}, {"type": "string"}]}, "array"),
                ({"type": ["string", "array"], "items": {"type": "string"}}, "string"),
                ({"type": ["array", "string"], "items": {"type": "string"}}, "array"),
                ({"type": ["string", "array", "null"]}, "string"),
            ],
        )
        def test_mixed_type_union_attaches_input_schema(self, prop, expected_type):
            schema = {"type": "object", "properties": {"domain": prop}, "required": []}
            param = ToolTransformService.convert_mcp_schema_to_parameter(schema)[0]
            assert param.type.value == expected_type
            assert param.input_schema == prop

        @pytest.mark.parametrize(
            "prop",
            [
                {"type": ["string", "null"]},
                {"anyOf": [{"type": "string"}, {"type": "null"}]},
                {"oneOf": [{"type": "null"}, {"type": "string"}]},
                {"oneOf": [{"type": "integer"}, {"type": "number"}]},
            ],
        )
        def test_single_type_union_has_no_input_schema(self, prop):
            schema = {"type": "object", "properties": {"f": prop}, "required": []}
            assert ToolTransformService.convert_mcp_schema_to_parameter(schema)[0].input_schema is None

        def test_missing_description_defaults_empty(self):
            schema = {"type": "object", "properties": {"f": {"type": "string"}}, "required": []}
            assert ToolTransformService.convert_mcp_schema_to_parameter(schema)[0].llm_description == ""

    class TestApiProviderToController:
        def test_api_key_header_auth(self):
            db_provider = MagicMock()
            db_provider.credentials = {"auth_type": "api_key_header"}
            with patch(f"{MODULE}.db.session"), patch(f"{MODULE}.ApiToolProviderController") as ctrl_cls:
                ctrl_cls.from_db.return_value = MagicMock()
                ToolTransformService.api_provider_to_controller(db_provider)
            ctrl_cls.from_db.assert_called_once_with(
                db_provider=db_provider, auth_type=ApiProviderAuthType.API_KEY_HEADER, session=ANY
            )

        def test_api_key_query_auth(self):
            db_provider = MagicMock()
            db_provider.credentials = {"auth_type": "api_key_query"}
            with patch(f"{MODULE}.db.session"), patch(f"{MODULE}.ApiToolProviderController") as ctrl_cls:
                ctrl_cls.from_db.return_value = MagicMock()
                ToolTransformService.api_provider_to_controller(db_provider)
            ctrl_cls.from_db.assert_called_once_with(
                db_provider=db_provider, auth_type=ApiProviderAuthType.API_KEY_QUERY, session=ANY
            )

        def test_legacy_api_key_maps_to_header(self):
            db_provider = MagicMock()
            db_provider.credentials = {"auth_type": "api_key"}
            with patch(f"{MODULE}.db.session"), patch(f"{MODULE}.ApiToolProviderController") as ctrl_cls:
                ctrl_cls.from_db.return_value = MagicMock()
                ToolTransformService.api_provider_to_controller(db_provider)
            ctrl_cls.from_db.assert_called_once_with(
                db_provider=db_provider, auth_type=ApiProviderAuthType.API_KEY_HEADER, session=ANY
            )

        def test_unknown_auth_defaults_to_none(self):
            db_provider = MagicMock()
            db_provider.credentials = {"auth_type": "something_else"}
            with patch(f"{MODULE}.db.session"), patch(f"{MODULE}.ApiToolProviderController") as ctrl_cls:
                ctrl_cls.from_db.return_value = MagicMock()
                ToolTransformService.api_provider_to_controller(db_provider)
            ctrl_cls.from_db.assert_called_once_with(
                db_provider=db_provider, auth_type=ApiProviderAuthType.NONE, session=ANY
            )
