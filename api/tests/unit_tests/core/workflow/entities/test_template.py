"""Tests for template module."""

from core.workflow.nodes.base.template import Template, TextSegment, VariableSegment


class TestTemplate:
    """Test Template class functionality."""

    def test_from_answer_template_simple(self):
        """Test parsing a simple answer template."""
        template_str = "Hello, {{#node1.name#}}!"
        template = Template.from_answer_template(template_str)

        assert len(template.segments) == 3
        assert isinstance(template.segments[0], TextSegment)
        assert template.segments[0].text == "Hello, "
        assert isinstance(template.segments[1], VariableSegment)
        assert template.segments[1].selector == ["node1", "name"]
        assert isinstance(template.segments[2], TextSegment)
        assert template.segments[2].text == "!"

    def test_from_answer_template_multiple_vars(self):
        """Test parsing an answer template with multiple variables."""
        template_str = "Hello {{#node1.name#}}, your age is {{#node2.age#}}."
        template = Template.from_answer_template(template_str)

        assert len(template.segments) == 5
        assert isinstance(template.segments[0], TextSegment)
        assert template.segments[0].text == "Hello "
        assert isinstance(template.segments[1], VariableSegment)
        assert template.segments[1].selector == ["node1", "name"]
        assert isinstance(template.segments[2], TextSegment)
        assert template.segments[2].text == ", your age is "
        assert isinstance(template.segments[3], VariableSegment)
        assert template.segments[3].selector == ["node2", "age"]
        assert isinstance(template.segments[4], TextSegment)
        assert template.segments[4].text == "."

    def test_from_answer_template_no_vars(self):
        """Test parsing an answer template with no variables."""
        template_str = "Hello, world!"
        template = Template.from_answer_template(template_str)

        assert len(template.segments) == 1
        assert isinstance(template.segments[0], TextSegment)
        assert template.segments[0].text == "Hello, world!"

    def test_from_end_outputs_single(self):
        """Test creating template from End node outputs with single variable."""
        outputs_config = [{"variable": "text", "value_selector": ["node1", "text"]}]
        template = Template.from_end_outputs(outputs_config)

        assert len(template.segments) == 1
        assert isinstance(template.segments[0], VariableSegment)
        assert template.segments[0].selector == ["node1", "text"]

    def test_from_end_outputs_multiple(self):
        """Test creating template from End node outputs with multiple variables."""
        outputs_config = [
            {"variable": "text", "value_selector": ["node1", "text"]},
            {"variable": "result", "value_selector": ["node2", "result"]},
        ]
        template = Template.from_end_outputs(outputs_config)

        assert len(template.segments) == 3
        assert isinstance(template.segments[0], VariableSegment)
        assert template.segments[0].selector == ["node1", "text"]
        assert template.segments[0].variable_name == "text"
        assert isinstance(template.segments[1], TextSegment)
        assert template.segments[1].text == "\n"
        assert isinstance(template.segments[2], VariableSegment)
        assert template.segments[2].selector == ["node2", "result"]
        assert template.segments[2].variable_name == "result"

    def test_from_end_outputs_empty(self):
        """Test creating template from empty End node outputs."""
        outputs_config = []
        template = Template.from_end_outputs(outputs_config)

        assert len(template.segments) == 0

    def test_template_str_representation(self):
        """Test string representation of template."""
        template_str = "Hello, {{#node1.name#}}!"
        template = Template.from_answer_template(template_str)

        assert str(template) == template_str
