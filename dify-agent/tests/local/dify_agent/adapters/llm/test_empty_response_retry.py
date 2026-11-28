"""Tests for EmptyResponseRetryModel: resampling thinking-only model responses."""

import unittest
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ThinkingPart, ToolCallPart
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.settings import ModelSettings

from dify_agent.adapters.llm import EmptyResponseRetryModel
from dify_agent.adapters.llm.empty_response_retry import has_actionable_parts


class _ScriptedModel(Model):
    """Model that replays a scripted list of responses, one per request."""

    def __init__(self, responses: list[ModelResponse]) -> None:
        super().__init__()
        self._responses = list(responses)
        self.request_count = 0

    @property
    def model_name(self) -> str:
        return "scripted"

    @property
    def system(self) -> str:
        return "scripted"

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.request_count += 1
        return self._responses.pop(0)


def _thinking_only() -> ModelResponse:
    return ModelResponse(parts=[ThinkingPart(content="let me think about this for a while...")])


def _text(text: str) -> ModelResponse:
    return ModelResponse(parts=[TextPart(content=text)])


def _tool_call() -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="browse_web", args={"task": "x"})])


class HasActionablePartsTests(unittest.TestCase):
    def test_thinking_only_is_not_actionable(self) -> None:
        self.assertFalse(has_actionable_parts(_thinking_only()))

    def test_empty_response_is_not_actionable(self) -> None:
        self.assertFalse(has_actionable_parts(ModelResponse(parts=[])))

    def test_text_is_actionable(self) -> None:
        self.assertTrue(has_actionable_parts(_text("hello")))

    def test_whitespace_text_is_not_actionable(self) -> None:
        self.assertFalse(has_actionable_parts(_text("   \n\t ")))

    def test_tool_call_is_actionable_even_without_text(self) -> None:
        self.assertTrue(has_actionable_parts(_tool_call()))


class EmptyResponseRetryModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_first_response_when_actionable(self) -> None:
        expected = _text("done")
        inner = _ScriptedModel([expected])
        wrapped = EmptyResponseRetryModel(inner)
        response = await wrapped.request([], None, ModelRequestParameters())
        self.assertIs(response, expected)
        self.assertEqual(inner.request_count, 1)

    async def test_resamples_thinking_only_response_until_actionable(self) -> None:
        inner = _ScriptedModel([_thinking_only(), _thinking_only(), _tool_call()])
        wrapped = EmptyResponseRetryModel(inner)
        response = await wrapped.request([], None, ModelRequestParameters())
        self.assertEqual(inner.request_count, 3)
        self.assertTrue(has_actionable_parts(response))

    async def test_gives_up_after_max_attempts(self) -> None:
        inner = _ScriptedModel([_thinking_only(), _thinking_only(), _thinking_only()])
        wrapped = EmptyResponseRetryModel(inner, max_attempts=3)
        response = await wrapped.request([], None, ModelRequestParameters())
        self.assertEqual(inner.request_count, 3)
        self.assertFalse(has_actionable_parts(response))

    async def test_max_attempts_floor_of_one_makes_no_retry(self) -> None:
        inner = _ScriptedModel([_thinking_only()])
        wrapped = EmptyResponseRetryModel(inner, max_attempts=0)
        response = await wrapped.request([], None, ModelRequestParameters())
        self.assertEqual(inner.request_count, 1)
        self.assertFalse(has_actionable_parts(response))

    async def test_forwards_request_arguments_unchanged(self) -> None:
        seen: list[tuple[Any, Any, Any]] = []

        class _RecordingModel(_ScriptedModel):
            async def request(
                self,
                messages: list[ModelMessage],
                model_settings: ModelSettings | None,
                model_request_parameters: ModelRequestParameters,
            ) -> ModelResponse:
                seen.append((messages, model_settings, model_request_parameters))
                return await super().request(messages, model_settings, model_request_parameters)

        inner = _RecordingModel([_thinking_only(), _text("ok")])
        wrapped = EmptyResponseRetryModel(inner)
        messages: list[ModelMessage] = []
        settings = ModelSettings(temperature=0.2)
        params = ModelRequestParameters()
        await wrapped.request(messages, settings, params)
        self.assertEqual(len(seen), 2)
        for forwarded_messages, forwarded_settings, forwarded_params in seen:
            self.assertIs(forwarded_messages, messages)
            self.assertIs(forwarded_settings, settings)
            self.assertIs(forwarded_params, params)
