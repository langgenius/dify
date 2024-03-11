import os
import pytest

from typing import Literal
from _pytest.monkeypatch import MonkeyPatch
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
                "result": "3"
            }

@pytest.fixture
def setup_code_executor_mock(request, monkeypatch: MonkeyPatch):
    if not MOCK:
        yield
        return

    monkeypatch.setattr(CodeExecutor, "execute_code", MockedCodeExecutor.invoke)
    yield
    monkeypatch.undo()
