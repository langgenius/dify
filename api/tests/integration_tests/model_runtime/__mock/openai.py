from tests.integration_tests.model_runtime.__mock.openai_completion import MockCompletionsClass
from tests.integration_tests.model_runtime.__mock.openai_chat import MockChatClass
from tests.integration_tests.model_runtime.__mock.openai_remote import MockModelClass
from openai.resources.completions import Completions
from openai.resources.chat import Completions as ChatCompletions
from openai.resources.models import Models

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch
from typing import Literal, Callable, List

import os
import pytest

def mock_openai(monkeypatch: MonkeyPatch, methods: List[Literal["completion", "chat", "remote"]]) -> Callable[[], None]:
    """
        mock openai module

        :param monkeypatch: pytest monkeypatch fixture
        :return: unpatch function
    """
    def unpatch() -> None:
        monkeypatch.undo()

    if "completion" in methods:
        monkeypatch.setattr(Completions, "create", MockCompletionsClass.completion_create)

    if "chat" in methods:
        monkeypatch.setattr(ChatCompletions, "create", MockChatClass.chat_create)

    if "remote" in methods:
        monkeypatch.setattr(Models, "list", MockModelClass.list)

    return unpatch


MOCK = os.getenv('MOCK_SWITCH', 'false').lower() == 'true'

@pytest.fixture
def setup_openai_mock(request, monkeypatch):
    methods = request.param if hasattr(request, 'param') else []
    if MOCK:
        unpatch = mock_openai(monkeypatch, methods=methods)
    
    yield

    if MOCK:
        unpatch()