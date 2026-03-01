from unittest.mock import Mock

from core.tools.__base.tool import Tool
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter, ToolProviderType
from services.tools.tools_transform_service import ToolTransformService


class TestToolTransformService:
    """Test cases for ToolTransformService.convert_tool_entity_to_api_entity method"""

    def test_convert_tool_with_parameter_override(self):
        """Test that runtime parameters correctly override base parameters"""
        # Create mock base parameters
        base_param1 = Mock(spec=ToolParameter)
        base_param1.name = "param1"
        base_param1.form = ToolParameter.ToolParameterForm.FORM
        base_param1.type = "string"
        base_param1.label = "Base Param 1"

        base_param2 = Mock(spec=ToolParameter)
        base_param2.name = "param2"
        base_param2.form = ToolParameter.ToolParameterForm.FORM
        base_param2.type = "string"
        base_param2.label = "Base Param 2"

        # Create mock runtime parameters that override base parameters
        runtime_param1 = Mock(spec=ToolParameter)
        runtime_param1.name = "param1"
        runtime_param1.form = ToolParameter.ToolParameterForm.FORM
        runtime_param1.type = "string"
        runtime_param1.label = "Runtime Param 1"  # Different label to verify override

        # Create mock tool
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = [base_param1, base_param2]
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = [runtime_param1]

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

        # Verify the result
        assert isinstance(result, ToolApiEntity)
        assert result.author == "test_author"
        assert result.name == "test_tool"
        assert result.parameters is not None
        assert len(result.parameters) == 2

        # Find the overridden parameter
        overridden_param = next((p for p in result.parameters if p.name == "param1"), None)
        assert overridden_param is not None
        assert overridden_param.label == "Runtime Param 1"  # Should be runtime version

        # Find the non-overridden parameter
        original_param = next((p for p in result.parameters if p.name == "param2"), None)
        assert original_param is not None
        assert original_param.label == "Base Param 2"  # Should be base version

    def test_convert_tool_with_additional_runtime_parameters(self):
        """Test that additional runtime parameters are added to the final list"""
        # Create mock base parameters
        base_param1 = Mock(spec=ToolParameter)
        base_param1.name = "param1"
        base_param1.form = ToolParameter.ToolParameterForm.FORM
        base_param1.type = "string"
        base_param1.label = "Base Param 1"

        # Create mock runtime parameters - one that overrides and one that's new
        runtime_param1 = Mock(spec=ToolParameter)
        runtime_param1.name = "param1"
        runtime_param1.form = ToolParameter.ToolParameterForm.FORM
        runtime_param1.type = "string"
        runtime_param1.label = "Runtime Param 1"

        runtime_param2 = Mock(spec=ToolParameter)
        runtime_param2.name = "runtime_only"
        runtime_param2.form = ToolParameter.ToolParameterForm.FORM
        runtime_param2.type = "string"
        runtime_param2.label = "Runtime Only Param"

        # Create mock tool
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = [base_param1]
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = [runtime_param1, runtime_param2]

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

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
        assert overridden_param.label == "Runtime Param 1"

        # Verify the new runtime parameter is included
        new_param = next((p for p in result.parameters if p.name == "runtime_only"), None)
        assert new_param is not None
        assert new_param.label == "Runtime Only Param"

    def test_convert_tool_with_non_form_runtime_parameters(self):
        """Test that non-FORM runtime parameters are not added as new parameters"""
        # Create mock base parameters
        base_param1 = Mock(spec=ToolParameter)
        base_param1.name = "param1"
        base_param1.form = ToolParameter.ToolParameterForm.FORM
        base_param1.type = "string"
        base_param1.label = "Base Param 1"

        # Create mock runtime parameters with different forms
        runtime_param1 = Mock(spec=ToolParameter)
        runtime_param1.name = "param1"
        runtime_param1.form = ToolParameter.ToolParameterForm.FORM
        runtime_param1.type = "string"
        runtime_param1.label = "Runtime Param 1"

        runtime_param2 = Mock(spec=ToolParameter)
        runtime_param2.name = "llm_param"
        runtime_param2.form = ToolParameter.ToolParameterForm.LLM
        runtime_param2.type = "string"
        runtime_param2.label = "LLM Param"

        # Create mock tool
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = [base_param1]
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = [runtime_param1, runtime_param2]

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

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
        # Create mock tool with no parameters
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = []
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = []

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

        # Verify the result
        assert isinstance(result, ToolApiEntity)
        assert result.parameters is not None
        assert len(result.parameters) == 0

    def test_convert_tool_with_none_parameters(self):
        """Test conversion when base parameters is None"""
        # Create mock tool with None parameters
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = None
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = []

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

        # Verify the result
        assert isinstance(result, ToolApiEntity)
        assert result.parameters is not None
        assert len(result.parameters) == 0

    def test_convert_tool_parameter_order_preserved(self):
        """Test that parameter order is preserved correctly"""
        # Create mock base parameters in specific order
        base_param1 = Mock(spec=ToolParameter)
        base_param1.name = "param1"
        base_param1.form = ToolParameter.ToolParameterForm.FORM
        base_param1.type = "string"
        base_param1.label = "Base Param 1"

        base_param2 = Mock(spec=ToolParameter)
        base_param2.name = "param2"
        base_param2.form = ToolParameter.ToolParameterForm.FORM
        base_param2.type = "string"
        base_param2.label = "Base Param 2"

        base_param3 = Mock(spec=ToolParameter)
        base_param3.name = "param3"
        base_param3.form = ToolParameter.ToolParameterForm.FORM
        base_param3.type = "string"
        base_param3.label = "Base Param 3"

        # Create runtime parameter that overrides middle parameter
        runtime_param2 = Mock(spec=ToolParameter)
        runtime_param2.name = "param2"
        runtime_param2.form = ToolParameter.ToolParameterForm.FORM
        runtime_param2.type = "string"
        runtime_param2.label = "Runtime Param 2"

        # Create new runtime parameter
        runtime_param4 = Mock(spec=ToolParameter)
        runtime_param4.name = "param4"
        runtime_param4.form = ToolParameter.ToolParameterForm.FORM
        runtime_param4.type = "string"
        runtime_param4.label = "Runtime Param 4"

        # Create mock tool
        mock_tool = Mock(spec=Tool)
        mock_tool.entity = Mock()
        mock_tool.entity.parameters = [base_param1, base_param2, base_param3]
        mock_tool.entity.identity = Mock()
        mock_tool.entity.identity.author = "test_author"
        mock_tool.entity.identity.name = "test_tool"
        mock_tool.entity.identity.label = I18nObject(en_US="Test Tool")
        mock_tool.entity.description = Mock()
        mock_tool.entity.description.human = I18nObject(en_US="Test description")
        mock_tool.entity.output_schema = {}
        mock_tool.get_runtime_parameters.return_value = [runtime_param2, runtime_param4]

        # Mock fork_tool_runtime to return the same tool
        mock_tool.fork_tool_runtime.return_value = mock_tool

        # Call the method
        result = ToolTransformService.convert_tool_entity_to_api_entity(mock_tool, "test_tenant", None)

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
        assert param2.label == "Runtime Param 2"


class TestWorkflowProviderToUserProvider:
    """Test cases for ToolTransformService.workflow_provider_to_user_provider method"""

    def test_workflow_provider_to_user_provider_with_workflow_app_id(self):
        """Test that workflow_provider_to_user_provider correctly sets workflow_app_id."""
        from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

        # Create mock workflow tool provider controller
        workflow_app_id = "app_123"
        provider_id = "provider_123"
        mock_controller = Mock(spec=WorkflowToolProviderController)
        mock_controller.provider_id = provider_id
        mock_controller.entity = Mock()
        mock_controller.entity.identity = Mock()
        mock_controller.entity.identity.author = "test_author"
        mock_controller.entity.identity.name = "test_workflow_tool"
        mock_controller.entity.identity.description = I18nObject(en_US="Test description")
        mock_controller.entity.identity.icon = {"type": "emoji", "content": "🔧"}
        mock_controller.entity.identity.icon_dark = None
        mock_controller.entity.identity.label = I18nObject(en_US="Test Workflow Tool")

        # Call the method
        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=mock_controller,
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

        # Create mock workflow tool provider controller
        provider_id = "provider_123"
        mock_controller = Mock(spec=WorkflowToolProviderController)
        mock_controller.provider_id = provider_id
        mock_controller.entity = Mock()
        mock_controller.entity.identity = Mock()
        mock_controller.entity.identity.author = "test_author"
        mock_controller.entity.identity.name = "test_workflow_tool"
        mock_controller.entity.identity.description = I18nObject(en_US="Test description")
        mock_controller.entity.identity.icon = {"type": "emoji", "content": "🔧"}
        mock_controller.entity.identity.icon_dark = None
        mock_controller.entity.identity.label = I18nObject(en_US="Test Workflow Tool")

        # Call the method without workflow_app_id
        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=mock_controller,
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

        # Create mock workflow tool provider controller
        provider_id = "provider_123"
        mock_controller = Mock(spec=WorkflowToolProviderController)
        mock_controller.provider_id = provider_id
        mock_controller.entity = Mock()
        mock_controller.entity.identity = Mock()
        mock_controller.entity.identity.author = "test_author"
        mock_controller.entity.identity.name = "test_workflow_tool"
        mock_controller.entity.identity.description = I18nObject(en_US="Test description")
        mock_controller.entity.identity.icon = {"type": "emoji", "content": "🔧"}
        mock_controller.entity.identity.icon_dark = None
        mock_controller.entity.identity.label = I18nObject(en_US="Test Workflow Tool")

        # Call the method with explicit None values
        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=mock_controller,
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

        # Create mock workflow tool provider controller with various fields
        workflow_app_id = "app_456"
        provider_id = "provider_456"
        mock_controller = Mock(spec=WorkflowToolProviderController)
        mock_controller.provider_id = provider_id
        mock_controller.entity = Mock()
        mock_controller.entity.identity = Mock()
        mock_controller.entity.identity.author = "another_author"
        mock_controller.entity.identity.name = "another_workflow_tool"
        mock_controller.entity.identity.description = I18nObject(
            en_US="Another description", zh_Hans="Another description"
        )
        mock_controller.entity.identity.icon = {"type": "emoji", "content": "⚙️"}
        mock_controller.entity.identity.icon_dark = {"type": "emoji", "content": "🔧"}
        mock_controller.entity.identity.label = I18nObject(
            en_US="Another Workflow Tool", zh_Hans="Another Workflow Tool"
        )

        # Call the method
        result = ToolTransformService.workflow_provider_to_user_provider(
            provider_controller=mock_controller,
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
