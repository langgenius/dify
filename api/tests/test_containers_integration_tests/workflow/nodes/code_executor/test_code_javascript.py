from textwrap import dedent

from .test_utils import CodeExecutorTestMixin


class TestJavaScriptCodeExecutor(CodeExecutorTestMixin):
    """Test class for JavaScript code executor functionality."""

    def test_javascript_plain(self, flask_app_with_containers):
        """Test basic JavaScript code execution with console.log output"""
        CodeExecutor, CodeLanguage = self.code_executor_imports

        code = 'console.log("Hello World")'
        result_message = CodeExecutor.execute_code(language=CodeLanguage.JAVASCRIPT, preload="", code=code)
        assert result_message == "Hello World\n"

    def test_javascript_json(self, flask_app_with_containers):
        """Test JavaScript code execution with JSON output"""
        CodeExecutor, CodeLanguage = self.code_executor_imports

        code = dedent("""
        obj = {'Hello': 'World'}
        console.log(JSON.stringify(obj))
        """)
        result = CodeExecutor.execute_code(language=CodeLanguage.JAVASCRIPT, preload="", code=code)
        assert result == '{"Hello":"World"}\n'

    def test_javascript_with_code_template(self, flask_app_with_containers):
        """Test JavaScript workflow code template execution with inputs"""
        CodeExecutor, CodeLanguage = self.code_executor_imports
        JavascriptCodeProvider, _ = self.javascript_imports

        result = CodeExecutor.execute_workflow_code_template(
            language=CodeLanguage.JAVASCRIPT,
            code=JavascriptCodeProvider.get_default_code(),
            inputs={"arg1": "Hello", "arg2": "World"},
        )
        assert result == {"result": "HelloWorld"}

    def test_javascript_get_runner_script(self, flask_app_with_containers):
        """Test JavaScript template transformer runner script generation"""
        _, NodeJsTemplateTransformer = self.javascript_imports

        runner_script = NodeJsTemplateTransformer.get_runner_script()
        assert runner_script.count(NodeJsTemplateTransformer._code_placeholder) == 1
        assert runner_script.count(NodeJsTemplateTransformer._inputs_placeholder) == 1
        assert runner_script.count(NodeJsTemplateTransformer._result_tag) == 2
