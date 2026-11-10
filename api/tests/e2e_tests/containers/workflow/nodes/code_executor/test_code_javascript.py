from textwrap import dedent

from flask import Flask

from .test_utils import CodeExecutorTestMixin


class TestJavaScriptCodeExecutor(CodeExecutorTestMixin):
    """Test class for JavaScript code executor functionality."""

    def test_javascript_plain(self, flask_app_with_containers: Flask):
        """Test basic JavaScript code execution with console.log output"""
        code_executor, code_language = self.code_executor_imports

        code = 'console.log("Hello World")'
        result_message = code_executor.execute_code(language=code_language.JAVASCRIPT, preload="", code=code)
        assert result_message == "Hello World\n"

    def test_javascript_json(self, flask_app_with_containers: Flask):
        """Test JavaScript code execution with JSON output"""
        code_executor, code_language = self.code_executor_imports

        code = dedent("""
        obj = {'Hello': 'World'}
        console.log(JSON.stringify(obj))
        """)
        result = code_executor.execute_code(language=code_language.JAVASCRIPT, preload="", code=code)
        assert result == '{"Hello":"World"}\n'

    def test_javascript_with_code_template(self, flask_app_with_containers: Flask):
        """Test JavaScript workflow code template execution with inputs"""
        code_executor, code_language = self.code_executor_imports
        javascript_code_provider, _ = self.javascript_imports

        result = code_executor.execute_workflow_code_template(
            language=code_language.JAVASCRIPT,
            code=javascript_code_provider.get_default_code(),
            inputs={"arg1": "Hello", "arg2": "World"},
        )
        assert result == {"result": "HelloWorld"}

    def test_javascript_get_runner_script(self, flask_app_with_containers: Flask):
        """Test JavaScript template transformer runner script generation"""
        _, node_js_template_transformer = self.javascript_imports

        runner_script = node_js_template_transformer.get_runner_script()
        assert runner_script.count(node_js_template_transformer._code_placeholder) == 1
        assert runner_script.count(node_js_template_transformer._inputs_placeholder) == 1
        assert runner_script.count(node_js_template_transformer._result_tag) == 2
