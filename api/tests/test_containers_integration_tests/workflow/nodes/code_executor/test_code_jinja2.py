import base64

from .test_utils import CodeExecutorTestMixin


class TestJinja2CodeExecutor(CodeExecutorTestMixin):
    """Test class for Jinja2 code executor functionality."""

    def test_jinja2(self, flask_app_with_containers):
        """Test basic Jinja2 template execution with variable substitution"""
        CodeExecutor, CodeLanguage = self.code_executor_imports
        _, Jinja2TemplateTransformer = self.jinja2_imports

        template = "Hello {{template}}"
        # Template must be base64 encoded to match the new safe embedding approach
        template_b64 = base64.b64encode(template.encode("utf-8")).decode("utf-8")
        inputs = base64.b64encode(b'{"template": "World"}').decode("utf-8")
        code = (
            Jinja2TemplateTransformer.get_runner_script()
            .replace(Jinja2TemplateTransformer._template_b64_placeholder, template_b64)
            .replace(Jinja2TemplateTransformer._inputs_placeholder, inputs)
        )
        result = CodeExecutor.execute_code(
            language=CodeLanguage.JINJA2, preload=Jinja2TemplateTransformer.get_preload_script(), code=code
        )
        assert result == "<<RESULT>>Hello World<<RESULT>>\n"

    def test_jinja2_with_code_template(self, flask_app_with_containers):
        """Test Jinja2 workflow code template execution with inputs"""
        CodeExecutor, CodeLanguage = self.code_executor_imports

        result = CodeExecutor.execute_workflow_code_template(
            language=CodeLanguage.JINJA2, code="Hello {{template}}", inputs={"template": "World"}
        )
        assert result == {"result": "Hello World"}

    def test_jinja2_get_runner_script(self, flask_app_with_containers):
        """Test Jinja2 template transformer runner script generation"""
        _, Jinja2TemplateTransformer = self.jinja2_imports

        runner_script = Jinja2TemplateTransformer.get_runner_script()
        assert runner_script.count(Jinja2TemplateTransformer._template_b64_placeholder) == 1
        assert runner_script.count(Jinja2TemplateTransformer._inputs_placeholder) == 1
        assert runner_script.count(Jinja2TemplateTransformer._result_tag) == 2

    def test_jinja2_template_with_special_characters(self, flask_app_with_containers):
        """
        Test that templates with special characters (quotes, newlines) render correctly.
        This is a regression test for issue #26818 where textarea pre-fill values
        containing special characters would break template rendering.
        """
        CodeExecutor, CodeLanguage = self.code_executor_imports

        # Template with triple quotes, single quotes, double quotes, and newlines
        template = """<html>
<body>
    <input value="{{ task.get('Task ID', '') }}"/>
    <textarea>{{ task.get('Issues', 'No issues reported') }}</textarea>
    <p>Status: "{{ status }}"</p>
    <pre>'''code block'''</pre>
</body>
</html>"""
        inputs = {"task": {"Task ID": "TASK-123", "Issues": "Line 1\nLine 2\nLine 3"}, "status": "completed"}

        result = CodeExecutor.execute_workflow_code_template(language=CodeLanguage.JINJA2, code=template, inputs=inputs)

        # Verify the template rendered correctly with all special characters
        output = result["result"]
        assert 'value="TASK-123"' in output
        assert "<textarea>Line 1\nLine 2\nLine 3</textarea>" in output
        assert 'Status: "completed"' in output
        assert "'''code block'''" in output
