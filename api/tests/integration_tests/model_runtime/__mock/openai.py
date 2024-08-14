import os
from collections.abc import Callable
from typing import Literal

import pytest

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch
from openai.resources.audio.transcriptions import Transcriptions
from openai.resources.chat import Completions as ChatCompletions
from openai.resources.completions import Completions
from openai.resources.embeddings import Embeddings
from openai.resources.models import Models
from openai.resources.moderations import Moderations

from tests.integration_tests.model_runtime.__mock.openai_chat import MockChatClass
from tests.integration_tests.model_runtime.__mock.openai_completion import MockCompletionsClass
from tests.integration_tests.model_runtime.__mock.openai_embeddings import MockEmbeddingsClass
from tests.integration_tests.model_runtime.__mock.openai_moderation import MockModerationClass
from tests.integration_tests.model_runtime.__mock.openai_remote import MockModelClass
from tests.integration_tests.model_runtime.__mock.openai_speech2text import MockSpeech2TextClass


def mock_openai(monkeypatch: MonkeyPatch, methods: list[Literal["completion", "chat", "remote", "moderation", "speech2text", "text_embedding"]]) -> Callable[[], None]:
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

    if "moderation" in methods:
        monkeypatch.setattr(Moderations, "create", MockModerationClass.moderation_create)

    if "speech2text" in methods:
        monkeypatch.setattr(Transcriptions, "create", MockSpeech2TextClass.speech2text_create)

    if "text_embedding" in methods:
        monkeypatch.setattr(Embeddings, "create", MockEmbeddingsClass.create_embeddings)

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