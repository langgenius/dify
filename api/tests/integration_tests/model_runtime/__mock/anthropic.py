import anthropic
from anthropic import Anthropic
from anthropic.resources.completions import Completions
from anthropic.types import completion_create_params, Completion
from anthropic._types import NOT_GIVEN, NotGiven, Headers, Query, Body

from _pytest.monkeypatch import MonkeyPatch

from typing import List, Union, Literal, Any, Generator
from time import sleep

import pytest
import os

MOCK = os.getenv('MOCK_SWITCH', 'false') == 'true'

class MockAnthropicClass(object):
    @staticmethod
    def mocked_anthropic_chat_create_sync(model: str) -> Completion:
        return Completion(
            completion='hello, I\'m a chatbot from anthropic',
            model=model,
            stop_reason='stop_sequence'
        )

    @staticmethod
    def mocked_anthropic_chat_create_stream(model: str) -> Generator[Completion, None, None]:
        full_response_text = "hello, I'm a chatbot from anthropic"

        for i in range(0, len(full_response_text) + 1):
            sleep(0.1)
            if i == len(full_response_text):
                yield Completion(
                    completion='',
                    model=model,
                    stop_reason='stop_sequence'
                )
            else:
                yield Completion(
                    completion=full_response_text[i],
                    model=model,
                    stop_reason=''
                )

    def mocked_anthropic(self: Completions, *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        stream: Literal[True],
        **kwargs: Any
    ) -> Union[Completion, Generator[Completion, None, None]]:
        if len(self._client.api_key) < 18:
            raise anthropic.AuthenticationError('Invalid API key')

        if stream:
            return MockAnthropicClass.mocked_anthropic_chat_create_stream(model=model)
        else:
            return MockAnthropicClass.mocked_anthropic_chat_create_sync(model=model)

@pytest.fixture
def setup_anthropic_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Completions, 'create', MockAnthropicClass.mocked_anthropic)

    yield

    if MOCK:
        monkeypatch.undo()