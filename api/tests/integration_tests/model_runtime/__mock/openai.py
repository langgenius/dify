from tests.integration_tests.model_runtime.__mock.openai_completion import MockCompletionsClass
from tests.integration_tests.model_runtime.__mock.openai_chat import MockChatClass
from openai.resources.completions import Completions
from openai.resources.chat import Completions as ChatCompletions

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch
from typing import Literal, Callable, List

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

    return unpatch