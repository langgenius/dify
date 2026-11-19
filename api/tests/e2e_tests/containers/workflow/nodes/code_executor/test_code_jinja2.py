import base64

from .test_utils import CodeExecutorTestMixin


class TestJinja2CodeExecutor(CodeExecutorTestMixin):
    """Test class for Jinja2 code executor functionality."""

    def test_jinja2(self):
        """Test basic Jinja2 template execution with variable substitution"""
        code_executor, code_language = self.code_executor_imports
        _, jinja2_template_transformer = self.jinja2_imports

        template = "Hello {{template}}"
        # Template must be base64 encoded to match the new safe embedding approach
        template_b64 = base64.b64encode(template.encode("utf-8")).decode("utf-8")
        inputs = base64.b64encode(b'{"template": "World"}').decode("utf-8")
        code = (
            jinja2_template_transformer.get_runner_script()
            .replace(jinja2_template_transformer._template_b64_placeholder, template_b64)
            .replace(jinja2_template_transformer._inputs_placeholder, inputs)
        )
        result = code_executor.execute_code(
            language=code_language.JINJA2, preload=jinja2_template_transformer.get_preload_script(), code=code
        )
        assert result == "<<RESULT>>Hello World<<RESULT>>\n"

    def test_jinja2_with_code_template(self):
        """Test Jinja2 workflow code template execution with inputs"""
        code_executor, code_language = self.code_executor_imports

        result = code_executor.execute_workflow_code_template(
            language=code_language.JINJA2, code="Hello {{template}}", inputs={"template": "World"}
        )
        assert result == {"result": "Hello World"}

    def test_jinja2_get_runner_script(self):
        """Test Jinja2 template transformer runner script generation"""
        _, jinja2_template_transformer = self.jinja2_imports

        runner_script = jinja2_template_transformer.get_runner_script()
        assert runner_script.count(jinja2_template_transformer._template_b64_placeholder) == 1
        assert runner_script.count(jinja2_template_transformer._inputs_placeholder) == 1
        assert runner_script.count(jinja2_template_transformer._result_tag) == 2
