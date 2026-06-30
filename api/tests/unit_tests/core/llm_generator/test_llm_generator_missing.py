import sys
from unittest.mock import MagicMock, patch

from core.app.app_config.entities import ModelConfig
from core.llm_generator.llm_generator import LLMGenerator, _parse_string_list


class TestParseStringList:
    def test_empty(self):
        assert _parse_string_list("") == []
        
    def test_no_match(self):
        assert _parse_string_list("no list here") == []
        
    def test_valid_json(self):
        assert _parse_string_list('["item1", "item2"]') == ["item1", "item2"]
        
    def test_with_surrounding_text(self):
        assert _parse_string_list('Here is the list: ["a", "b"] enjoy!') == ["a", "b"]
        
    def test_invalid_json_fallback(self):
        # json_repair can fix missing quotes
        assert _parse_string_list('[item1, item2]') == ["item1", "item2"]
        
    def test_completely_invalid_json(self):
        assert _parse_string_list('[{}}]') == []
        
    def test_not_a_list(self):
        assert _parse_string_list('{"a": "b"}') == []
        
    def test_filter_non_strings(self):
        assert _parse_string_list('["a", 1, "b", {"foo": "bar"}]') == ["a", "b"]


class TestGenerateWorkflowInstructionSuggestions:
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    def test_no_default_model(self, mock_for_tenant):
        mock_for_tenant.return_value.get_default_model_instance.side_effect = Exception("No model")
        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []
        
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    @patch('core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context')
    def test_llm_success(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = '["idea 1", "idea 2"]'
        
        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model
        
        result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")
        assert result == ["idea 1", "idea 2"]
        
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    @patch('core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context')
    def test_llm_error(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        
        mock_model = MagicMock()
        mock_model.invoke_llm.side_effect = Exception("API error")
        
        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model
        
        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []
        
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    @patch('core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context')
    def test_llm_bad_output(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "Not a list"
        
        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model
        
        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []


class TestBuildSuggestionContext:
    @patch('core.llm_generator.llm_generator.db.session.scalars')
    def test_both_success(self, mock_scalars):
        mock_scalars.return_value.all.return_value = ["kb1", "kb2"]
        
        # We need to mock the imports that happen inside the function
        # Create a mock module structure for core.workflow.generator.tool_catalogue
        mock_tool_catalogue = MagicMock()
        mock_tool_catalogue.build_tool_catalogue.return_value = "catalog"
        mock_tool_catalogue.format_tool_catalogue.return_value = "tool1\ntool2"
        
        # Add the mock module to sys.modules
        sys.modules['core.workflow.generator.tool_catalogue'] = mock_tool_catalogue
        
        try:
            result = LLMGenerator._build_suggestion_context("tenant")
            assert "Knowledge bases:\n- kb1\n- kb2" in result
            assert "Installed tools:\ntool1\ntool2" in result
        finally:
            # Clean up
            del sys.modules['core.workflow.generator.tool_catalogue']
            
    @patch('core.llm_generator.llm_generator.db.session.scalars')
    def test_both_fail(self, mock_scalars):
        mock_scalars.side_effect = Exception("DB error")
        
        # We need to mock the imports that happen inside the function
        # Create a mock module structure for core.workflow.generator.tool_catalogue
        mock_tool_catalogue = MagicMock()
        mock_tool_catalogue.build_tool_catalogue.side_effect = Exception("Tool error")
        
        # Add the mock module to sys.modules
        sys.modules['core.workflow.generator.tool_catalogue'] = mock_tool_catalogue
        
        try:
            assert LLMGenerator._build_suggestion_context("tenant") == ""
        finally:
            # Clean up
            del sys.modules['core.workflow.generator.tool_catalogue']


class TestClassifyWorkflowMode:
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    def test_model_error(self, mock_for_tenant):
        mock_for_tenant.return_value.get_model_instance.side_effect = Exception("API error")
        
        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "advanced-chat"
        
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    def test_workflow_match(self, mock_for_tenant):
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "  workflow "
        
        mock_for_tenant.return_value.get_model_instance.return_value = mock_model
        
        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "workflow"
        
    @patch('core.llm_generator.llm_generator.ModelManager.for_tenant')
    def test_other_match(self, mock_for_tenant):
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "chatflow"
        
        mock_for_tenant.return_value.get_model_instance.return_value = mock_model
        
        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "advanced-chat"


class TestWorkflowServiceInterface:
    def test_protocol_methods(self):
        # Just to cover the 'pass' statements in the Protocol definition
        from core.llm_generator.llm_generator import WorkflowServiceInterface
        
        class MockService(WorkflowServiceInterface):
            def get_draft_workflow(self, app_model, workflow_id=None):
                return super().get_draft_workflow(app_model, workflow_id)
                
            def get_node_last_run(self, app_model, workflow, node_id):
                return super().get_node_last_run(app_model, workflow, node_id)
                
        service = MockService()
        service.get_draft_workflow(None)
        service.get_node_last_run(None, None, "node")
