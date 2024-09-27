import os
from typing import Literal, Optional

import pytest
from _pytest.monkeypatch import MonkeyPatch
from jinja2 import Template

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage

MOCK = os.getenv("MOCK_SWITCH", "false") == "true"


class MockedCodeExecutor:
    @classmethod
    def invoke(cls, language: Literal["python3", "javascript", "jinja2"], code: str, inputs: dict) -> dict:
        # invoke directly
        match language:
            case CodeLanguage.PYTHON3:
                return {"result": 3}
            case CodeLanguage.JINJA2:
                return {"result": Template(code).render(inputs)}
            case _:
                raise Exception("Language not supported")


@pytest.fixture()
def setup_code_executor_mock(request, monkeypatch: MonkeyPatch):
    if not MOCK:
        yield
        return

    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", MockedCodeExecutor.invoke)
    yield
    monkeypatch.undo()
