import os
from collections.abc import Iterable
from typing import Any, Literal, Union

import anthropic
import pytest
from _pytest.monkeypatch import MonkeyPatch
from anthropic import Stream
from anthropic.resources import Messages
from anthropic.types import (
    ContentBlock,
    ContentBlockDeltaEvent,
    Message,
    MessageDeltaEvent,
    MessageDeltaUsage,
    MessageParam,
    MessageStartEvent,
    MessageStopEvent,
    MessageStreamEvent,
    TextDelta,
    Usage,
)
from anthropic.types.message_delta_event import Delta

MOCK = os.getenv("MOCK_SWITCH", "false") == "true"


class MockAnthropicClass:
    @staticmethod
    def mocked_anthropic_chat_create_sync(model: str) -> Message:
        return Message(
            id="msg-123",
            type="message",
            role="assistant",
            content=[ContentBlock(text="hello, I'm a chatbot from anthropic", type="text")],
            model=model,
            stop_reason="stop_sequence",
            usage=Usage(input_tokens=1, output_tokens=1),
        )

    @staticmethod
    def mocked_anthropic_chat_create_stream(model: str) -> Stream[MessageStreamEvent]:
        full_response_text = "hello, I'm a chatbot from anthropic"

        yield MessageStartEvent(
            type="message_start",
            message=Message(
                id="msg-123",
                content=[],
                role="assistant",
                model=model,
                stop_reason=None,
                type="message",
                usage=Usage(input_tokens=1, output_tokens=1),
            ),
        )

        index = 0
        for i in range(0, len(full_response_text)):
            yield ContentBlockDeltaEvent(
                type="content_block_delta", delta=TextDelta(text=full_response_text[i], type="text_delta"), index=index
            )

            index += 1

        yield MessageDeltaEvent(
            type="message_delta", delta=Delta(stop_reason="stop_sequence"), usage=MessageDeltaUsage(output_tokens=1)
        )

        yield MessageStopEvent(type="message_stop")

    def mocked_anthropic(
        self: Messages,
        *,
        max_tokens: int,
        messages: Iterable[MessageParam],
        model: str,
        stream: Literal[True],
        **kwargs: Any,
    ) -> Union[Message, Stream[MessageStreamEvent]]:
        if len(self._client.api_key) < 18:
            raise anthropic.AuthenticationError("Invalid API key")

        if stream:
            return MockAnthropicClass.mocked_anthropic_chat_create_stream(model=model)
        else:
            return MockAnthropicClass.mocked_anthropic_chat_create_sync(model=model)


@pytest.fixture
def setup_anthropic_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Messages, "create", MockAnthropicClass.mocked_anthropic)

    yield

    if MOCK:
        monkeypatch.undo()
