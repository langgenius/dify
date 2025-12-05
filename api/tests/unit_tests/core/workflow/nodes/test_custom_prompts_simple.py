"""
Test cases for custom prompt functionality in Parameter Extractor and Question Classifier nodes.
Simplified tests that focus on data structure validation rather than complex node instantiation.
"""

from core.variables.types import SegmentType
from core.workflow.nodes.llm import ModelConfig
from core.workflow.nodes.parameter_extractor.entities import ParameterConfig, ParameterExtractorNodeData
from core.workflow.nodes.question_classifier.entities import ClassConfig, QuestionClassifierNodeData


class TestParameterExtractorCustomPrompts:
    """Test custom prompt functionality for Parameter Extractor node."""

    def test_custom_prompt_fields_are_stored_correctly(self):
        """Test that Parameter Extractor custom prompt fields are properly stored."""
        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            query=["test query"],
            parameters=[
                ParameterConfig(name="location", type=SegmentType.STRING, description="Location", required=True)
            ],
            reasoning_mode="function_call",
            system_prompt="Custom system prompt with {histories} and {instruction}",
            user_prompt_template="Custom user prompt with {content} and {structure}",
            completion_prompt="Custom completion prompt",
            chat_prompt="Custom chat prompt",
        )

        # Verify custom prompt fields are stored correctly
        assert node_data.system_prompt == "Custom system prompt with {histories} and {instruction}"
        assert node_data.user_prompt_template == "Custom user prompt with {content} and {structure}"
        assert node_data.completion_prompt == "Custom completion prompt"
        assert node_data.chat_prompt == "Custom chat prompt"

    def test_default_prompt_fields_are_none(self):
        """Test that Parameter Extractor default prompt fields are None when not provided."""
        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            query=["test query"],
            parameters=[
                ParameterConfig(name="location", type=SegmentType.STRING, description="Location", required=True)
            ],
            reasoning_mode="function_call",
            # No custom prompts provided
        )

        # Verify custom prompt fields default to None
        assert node_data.system_prompt is None
        assert node_data.user_prompt_template is None
        assert node_data.completion_prompt is None
        assert node_data.chat_prompt is None

    def test_json_schema_generation_still_works(self):
        """Test that parameter JSON schema generation still works with custom prompts."""
        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            query=["test query"],
            parameters=[
                ParameterConfig(name="location", type=SegmentType.STRING, description="Location", required=True),
                ParameterConfig(name="count", type=SegmentType.NUMBER, description="Count", required=False),
            ],
            reasoning_mode="function_call",
            system_prompt="Custom system prompt",
        )

        schema = node_data.get_parameter_json_schema()

        # Verify schema structure is correct
        assert schema["type"] == "object"
        assert "location" in schema["properties"]
        assert "count" in schema["properties"]
        assert "location" in schema["required"]
        assert "count" not in schema["required"]


class TestQuestionClassifierCustomPrompts:
    """Test custom prompt functionality for Question Classifier node."""

    def test_custom_prompt_fields_are_stored_correctly(self):
        """Test that Question Classifier custom prompt fields are properly stored."""
        node_data = QuestionClassifierNodeData(
            title="Test Node",
            query_variable_selector=["query"],
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            classes=[
                ClassConfig(id="class1", name="Customer Service"),
                ClassConfig(id="class2", name="Technical Support"),
            ],
            system_prompt="Custom system prompt: {histories}",
            completion_prompt="Custom completion prompt: {histories} {input_text} {categories}",
        )

        # Verify custom prompt fields are stored correctly
        assert node_data.system_prompt == "Custom system prompt: {histories}"
        assert node_data.completion_prompt == "Custom completion prompt: {histories} {input_text} {categories}"

    def test_default_prompt_fields_are_none(self):
        """Test that Question Classifier default prompt fields are None when not provided."""
        node_data = QuestionClassifierNodeData(
            title="Test Node",
            query_variable_selector=["query"],
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            classes=[ClassConfig(id="class1", name="Customer Service")],
            # No custom prompts provided
        )

        # Verify custom prompt fields default to None
        assert node_data.system_prompt is None
        assert node_data.completion_prompt is None

    def test_structured_output_property_works(self):
        """Test that structured_output_enabled property still works."""
        node_data = QuestionClassifierNodeData(
            title="Test Node",
            query_variable_selector=["query"],
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            classes=[ClassConfig(id="class1", name="Customer Service")],
            system_prompt="Custom system prompt",
        )

        # The structured_output_enabled property should return False (as per existing implementation)
        assert node_data.structured_output_enabled is False


class TestBackwardCompatibility:
    """Test backward compatibility with existing DSL files."""

    def test_parameter_extractor_backward_compatibility(self):
        """Test that Parameter Extractor nodes without custom prompts still work."""
        # Create node data without custom prompt fields (simulating old DSL)
        node_data_dict = {
            "title": "Test Node",
            "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
            "query": ["test query"],
            "parameters": [
                {"name": "location", "type": "string", "description": "Location to extract", "required": True}
            ],
            "reasoning_mode": "function_call",
            # No custom prompt fields
        }

        # Should validate successfully
        node_data = ParameterExtractorNodeData.model_validate(node_data_dict)

        assert node_data.system_prompt is None
        assert node_data.user_prompt_template is None
        assert node_data.completion_prompt is None
        assert node_data.chat_prompt is None

    def test_question_classifier_backward_compatibility(self):
        """Test that Question Classifier nodes without custom prompts still work."""
        # Create node data without custom prompt fields (simulating old DSL)
        node_data_dict = {
            "title": "Test Node",
            "query_variable_selector": ["query"],
            "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
            "classes": [{"id": "class1", "name": "Category 1"}],
            # No custom prompt fields
        }

        # Should validate successfully
        node_data = QuestionClassifierNodeData.model_validate(node_data_dict)

        assert node_data.system_prompt is None
        assert node_data.completion_prompt is None

    def test_new_dsl_with_custom_prompts(self):
        """Test that new DSL files with custom prompts work correctly."""
        # Create node data with custom prompt fields
        node_data_dict = {
            "title": "Test Node",
            "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
            "query": ["test query"],
            "parameters": [
                {"name": "location", "type": "string", "description": "Location to extract", "required": True}
            ],
            "reasoning_mode": "function_call",
            "system_prompt": "Custom system prompt",
            "user_prompt_template": "Custom user prompt with {content} and {structure}",
            "completion_prompt": "Custom completion prompt",
            "chat_prompt": "Custom chat prompt",
        }

        # Should validate successfully
        node_data = ParameterExtractorNodeData.model_validate(node_data_dict)

        assert node_data.system_prompt == "Custom system prompt"
        assert node_data.user_prompt_template == "Custom user prompt with {content} and {structure}"
        assert node_data.completion_prompt == "Custom completion prompt"
        assert node_data.chat_prompt == "Custom chat prompt"
