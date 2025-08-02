import base64

from .test_utils import CodeExecutorTestMixin


class TestJinja2CodeExecutor(CodeExecutorTestMixin):
    """Test class for Jinja2 code executor functionality."""

    def test_jinja2(self, flask_app_with_containers):
        """Test basic Jinja2 template execution with variable substitution"""
        CodeExecutor, CodeLanguage = self.code_executor_imports
        _, Jinja2TemplateTransformer = self.jinja2_imports

        template = "Hello {{template}}"
        inputs = base64.b64encode(b'{"template": "World"}').decode("utf-8")
        code = (
            Jinja2TemplateTransformer.get_runner_script()
            .replace(Jinja2TemplateTransformer._code_placeholder, template)
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
        assert runner_script.count(Jinja2TemplateTransformer._code_placeholder) == 1
        assert runner_script.count(Jinja2TemplateTransformer._inputs_placeholder) == 1
        assert runner_script.count(Jinja2TemplateTransformer._result_tag) == 2
