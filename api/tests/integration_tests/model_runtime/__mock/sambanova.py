import os
from collections.abc import Iterator
from typing import Any, Optional

import pytest
from _pytest.monkeypatch import MonkeyPatch

MOCK = os.getenv("MOCK_SWITCH", "false") == "true"


class MockSambanovaClass:
    @staticmethod
    def mocked_sambanova_chat_create_sync(model: str) -> dict[str, Any]:
        return {
            "id": "chat-123",
            "response": "hello, I'm a chatbot from SambaNova",
            "model": model,
            "usage": {
                "prompt_tokens": 1,
                "completion_tokens": 1,
                "total_tokens": 2
            }
        }

    @staticmethod
    def mocked_sambanova_chat_create_stream(model: str) -> Iterator[dict[str, Any]]:
        full_response_text = "hello, I'm a chatbot from SambaNova"
        
        # Yield initial response
        yield {
            "id": "chat-123",
            "response": "",
            "model": model,
            "usage": None,
            "done": False
        }

        # Stream the response character by character
        for char in full_response_text:
            yield {
                "id": "chat-123",
                "response": char,
                "model": model,
                "usage": None,
                "done": False
            }

        # Yield final response with usage information
        yield {
            "id": "chat-123",
            "response": "",
            "model": model,
            "usage": {
                "prompt_tokens": 1,
                "completion_tokens": 1,
                "total_tokens": 2
            },
            "done": True
        }

    @staticmethod
    def mocked_sambanova_chat(
        model: str,
        messages: list,
        stream: bool = False,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any
    ) -> dict[str, Any]:
        if stream:
            return MockSambanovaClass.mocked_sambanova_chat_create_stream(model=model)
        return MockSambanovaClass.mocked_sambanova_chat_create_sync(model=model)


@pytest.fixture
def setup_sambanova_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        # Import the actual SambaNova client class here and patch its methods
        from api.core.model_runtime.model_providers.sambanova.llm.llm import SambaNovaLargeLanguageModel
        
        # Check the actual method name in SambaNovaLargeLanguageModel
        # For example, if the method is named `chat` instead of `_chat`, update it here
        monkeypatch.setattr(SambaNovaLargeLanguageModel, "_invoke", MockSambanovaClass.mocked_sambanova_chat)

    yield

    if MOCK:
        monkeypatch.undo() 