import pytest

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor

CODE_LANGUAGE = "unsupported_language"


def test_unsupported_with_code_template():
    with pytest.raises(CodeExecutionError) as e:
        CodeExecutor.execute_workflow_code_template(language=CODE_LANGUAGE, code="", inputs={})
    assert str(e.value) == f"Unsupported language {CODE_LANGUAGE}"
