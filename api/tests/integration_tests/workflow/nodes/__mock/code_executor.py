import os
from typing import Literal

import pytest
from _pytest.monkeypatch import MonkeyPatch
from jinja2 import Template

from core.helper.code_executor.code_executor import CodeExecutor

MOCK = os.getenv('MOCK_SWITCH', 'false') == 'true'

class MockedCodeExecutor:
    @classmethod
    def invoke(cls, language: Literal['python3', 'javascript', 'jinja2'], code: str, inputs: dict) -> dict:
        # invoke directly
        if language == 'python3':
            return {
                "result": 3
            }
        elif language == 'jinja2':
            return {
                "result": Template(code).render(inputs)
            }

@pytest.fixture
def setup_code_executor_mock(request, monkeypatch: MonkeyPatch):
    if not MOCK:
        yield
        return

    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", MockedCodeExecutor.invoke)
    yield
    monkeypatch.undo()
