import pytest
from pydantic import ValidationError

from core.workflow.enums import ErrorStrategy
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData


class TestTemplateTransformNodeData:
    """Test suite for TemplateTransformNodeData entity."""

    def test_valid_template_transform_node_data(self):
        """Test creating valid TemplateTransformNodeData."""
        data = {
            "title": "Template Transform",
            "desc": "Transform data using Jinja2 template",
            "variables": [
                {"variable": "name", "value_selector": ["sys", "user_name"]},
                {"variable": "age", "value_selector": ["sys", "user_age"]},
            ],
            "template": "Hello {{ name }}, you are {{ age }} years old!",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.title == "Template Transform"
        assert node_data.desc == "Transform data using Jinja2 template"
        assert len(node_data.variables) == 2
        assert node_data.variables[0].variable == "name"
        assert node_data.variables[0].value_selector == ["sys", "user_name"]
        assert node_data.variables[1].variable == "age"
        assert node_data.variables[1].value_selector == ["sys", "user_age"]
        assert node_data.template == "Hello {{ name }}, you are {{ age }} years old!"

    def test_template_transform_node_data_with_empty_variables(self):
        """Test TemplateTransformNodeData with no variables."""
        data = {
            "title": "Static Template",
            "variables": [],
            "template": "This is a static template with no variables.",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.title == "Static Template"
        assert len(node_data.variables) == 0
        assert node_data.template == "This is a static template with no variables."

    def test_template_transform_node_data_with_complex_template(self):
        """Test TemplateTransformNodeData with complex Jinja2 template."""
        data = {
            "title": "Complex Template",
            "variables": [
                {"variable": "items", "value_selector": ["sys", "item_list"]},
                {"variable": "total", "value_selector": ["sys", "total_count"]},
            ],
            "template": (
                "{% for item in items %}{{ item }}{% if not loop.last %}, {% endif %}{% endfor %}. Total: {{ total }}"
            ),
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.title == "Complex Template"
        assert len(node_data.variables) == 2
        assert "{% for item in items %}" in node_data.template
        assert "{{ total }}" in node_data.template

    def test_template_transform_node_data_with_error_strategy(self):
        """Test TemplateTransformNodeData with error handling strategy."""
        data = {
            "title": "Template with Error Handling",
            "variables": [{"variable": "value", "value_selector": ["sys", "input"]}],
            "template": "{{ value }}",
            "error_strategy": "fail-branch",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.error_strategy == ErrorStrategy.FAIL_BRANCH

    def test_template_transform_node_data_with_retry_config(self):
        """Test TemplateTransformNodeData with retry configuration."""
        data = {
            "title": "Template with Retry",
            "variables": [{"variable": "data", "value_selector": ["sys", "data"]}],
            "template": "{{ data }}",
            "retry_config": {"enabled": True, "max_retries": 3, "retry_interval": 1000},
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.retry_config.enabled is True
        assert node_data.retry_config.max_retries == 3
        assert node_data.retry_config.retry_interval == 1000

    def test_template_transform_node_data_missing_required_fields(self):
        """Test that missing required fields raises ValidationError."""
        data = {
            "title": "Incomplete Template",
            # Missing 'variables' and 'template'
        }

        with pytest.raises(ValidationError) as exc_info:
            TemplateTransformNodeData.model_validate(data)

        errors = exc_info.value.errors()
        assert len(errors) >= 2
        error_fields = {error["loc"][0] for error in errors}
        assert "variables" in error_fields
        assert "template" in error_fields

    def test_template_transform_node_data_invalid_variable_selector(self):
        """Test that invalid variable selector format raises ValidationError."""
        data = {
            "title": "Invalid Variable",
            "variables": [
                {"variable": "name", "value_selector": "invalid_format"}  # Should be list
            ],
            "template": "{{ name }}",
        }

        with pytest.raises(ValidationError):
            TemplateTransformNodeData.model_validate(data)

    def test_template_transform_node_data_with_default_value_dict(self):
        """Test TemplateTransformNodeData with default value dictionary."""
        data = {
            "title": "Template with Defaults",
            "variables": [
                {"variable": "name", "value_selector": ["sys", "user_name"]},
                {"variable": "greeting", "value_selector": ["sys", "greeting"]},
            ],
            "template": "{{ greeting }} {{ name }}!",
            "default_value_dict": {"greeting": "Hello", "name": "Guest"},
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.default_value_dict == {"greeting": "Hello", "name": "Guest"}

    def test_template_transform_node_data_with_nested_selectors(self):
        """Test TemplateTransformNodeData with nested variable selectors."""
        data = {
            "title": "Nested Selectors",
            "variables": [
                {"variable": "user_info", "value_selector": ["sys", "user", "profile", "name"]},
                {"variable": "settings", "value_selector": ["sys", "config", "app", "theme"]},
            ],
            "template": "User: {{ user_info }}, Theme: {{ settings }}",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert len(node_data.variables) == 2
        assert node_data.variables[0].value_selector == ["sys", "user", "profile", "name"]
        assert node_data.variables[1].value_selector == ["sys", "config", "app", "theme"]

    def test_template_transform_node_data_with_multiline_template(self):
        """Test TemplateTransformNodeData with multiline template."""
        data = {
            "title": "Multiline Template",
            "variables": [
                {"variable": "title", "value_selector": ["sys", "title"]},
                {"variable": "content", "value_selector": ["sys", "content"]},
            ],
            "template": """
# {{ title }}

{{ content }}

---
Generated by Template Transform Node
            """,
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert "# {{ title }}" in node_data.template
        assert "{{ content }}" in node_data.template
        assert "Generated by Template Transform Node" in node_data.template

    def test_template_transform_node_data_serialization(self):
        """Test that TemplateTransformNodeData can be serialized and deserialized."""
        original_data = {
            "title": "Serialization Test",
            "desc": "Test serialization",
            "variables": [{"variable": "test", "value_selector": ["sys", "test"]}],
            "template": "{{ test }}",
        }

        node_data = TemplateTransformNodeData.model_validate(original_data)
        serialized = node_data.model_dump()
        deserialized = TemplateTransformNodeData.model_validate(serialized)

        assert deserialized.title == node_data.title
        assert deserialized.desc == node_data.desc
        assert len(deserialized.variables) == len(node_data.variables)
        assert deserialized.template == node_data.template

    def test_template_transform_node_data_with_special_characters(self):
        """Test TemplateTransformNodeData with special characters in template."""
        data = {
            "title": "Special Characters",
            "variables": [{"variable": "text", "value_selector": ["sys", "input"]}],
            "template": "Special: {{ text }} | Symbols: @#$%^&*() | Unicode: 你好 🎉",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert "@#$%^&*()" in node_data.template
        assert "你好" in node_data.template
        assert "🎉" in node_data.template

    def test_template_transform_node_data_empty_template(self):
        """Test TemplateTransformNodeData with empty template string."""
        data = {
            "title": "Empty Template",
            "variables": [],
            "template": "",
        }

        node_data = TemplateTransformNodeData.model_validate(data)

        assert node_data.template == ""
        assert len(node_data.variables) == 0
