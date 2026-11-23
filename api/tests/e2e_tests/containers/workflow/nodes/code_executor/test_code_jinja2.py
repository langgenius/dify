from .test_utils import CodeExecutorTestMixin


class TestJinja2CodeExecutor(CodeExecutorTestMixin):
    """Exercise Jinja2 workflow templates through the real Sandbox."""

    def test_jinja2_with_code_template(self) -> None:
        """Test Jinja2 workflow code template execution with inputs"""
        code_executor, code_language = self.code_executor_imports

        result = code_executor.execute_workflow_code_template(
            language=code_language.JINJA2, code="Hello {{template}}", inputs={"template": "World"}
        )
        assert result == {"result": "Hello World"}
