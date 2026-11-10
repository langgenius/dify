from textwrap import dedent

from flask import Flask

from .test_utils import CodeExecutorTestMixin


class TestPython3CodeExecutor(CodeExecutorTestMixin):
    """Test class for Python3 code executor functionality."""

    def test_python3_plain(self, flask_app_with_containers: Flask):
        """Test basic Python3 code execution with print output"""
        code_executor, code_language = self.code_executor_imports

        code = 'print("Hello World")'
        result = code_executor.execute_code(language=code_language.PYTHON3, preload="", code=code)
        assert result == "Hello World\n"

    def test_python3_json(self, flask_app_with_containers: Flask):
        """Test Python3 code execution with JSON output"""
        code_executor, code_language = self.code_executor_imports

        code = dedent("""
        import json
        print(json.dumps({'Hello': 'World'}))
        """)
        result = code_executor.execute_code(language=code_language.PYTHON3, preload="", code=code)
        assert result == '{"Hello": "World"}\n'

    def test_python3_with_code_template(self, flask_app_with_containers: Flask):
        """Test Python3 workflow code template execution with inputs"""
        code_executor, code_language = self.code_executor_imports
        python3_code_provider, _ = self.python3_imports

        result = code_executor.execute_workflow_code_template(
            language=code_language.PYTHON3,
            code=python3_code_provider.get_default_code(),
            inputs={"arg1": "Hello", "arg2": "World"},
        )
        assert result == {"result": "HelloWorld"}

    def test_python3_get_runner_script(self, flask_app_with_containers: Flask):
        """Test Python3 template transformer runner script generation"""
        _, python3_template_transformer = self.python3_imports

        runner_script = python3_template_transformer.get_runner_script()
        assert runner_script.count(python3_template_transformer._code_placeholder) == 1
        assert runner_script.count(python3_template_transformer._inputs_placeholder) == 1
        assert runner_script.count(python3_template_transformer._result_tag) == 2
