from textwrap import dedent

from .test_utils import CodeExecutorTestMixin


class TestPython3CodeExecutor(CodeExecutorTestMixin):
    """Test class for Python3 code executor functionality."""

    def test_python3_plain(self, flask_app_with_containers):
        """Test basic Python3 code execution with print output"""
        CodeExecutor, CodeLanguage = self.code_executor_imports

        code = 'print("Hello World")'
        result = CodeExecutor.execute_code(language=CodeLanguage.PYTHON3, preload="", code=code)
        assert result == "Hello World\n"

    def test_python3_json(self, flask_app_with_containers):
        """Test Python3 code execution with JSON output"""
        CodeExecutor, CodeLanguage = self.code_executor_imports

        code = dedent("""
        import json
        print(json.dumps({'Hello': 'World'}))
        """)
        result = CodeExecutor.execute_code(language=CodeLanguage.PYTHON3, preload="", code=code)
        assert result == '{"Hello": "World"}\n'

    def test_python3_with_code_template(self, flask_app_with_containers):
        """Test Python3 workflow code template execution with inputs"""
        CodeExecutor, CodeLanguage = self.code_executor_imports
        Python3CodeProvider, _ = self.python3_imports

        result = CodeExecutor.execute_workflow_code_template(
            language=CodeLanguage.PYTHON3,
            code=Python3CodeProvider.get_default_code(),
            inputs={"arg1": "Hello", "arg2": "World"},
        )
        assert result == {"result": "HelloWorld"}

    def test_python3_get_runner_script(self, flask_app_with_containers):
        """Test Python3 template transformer runner script generation"""
        _, Python3TemplateTransformer = self.python3_imports

        runner_script = Python3TemplateTransformer.get_runner_script()
        assert runner_script.count(Python3TemplateTransformer._code_placeholder) == 1
        assert runner_script.count(Python3TemplateTransformer._inputs_placeholder) == 1
        assert runner_script.count(Python3TemplateTransformer._result_tag) == 2
