"""Tests for ResilientPydanticAIChatModel: the sub-agent's output retry budget."""

from __future__ import annotations

import unittest
from typing import Any

from browser_use.llm.messages import UserMessage
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ThinkingPart
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.settings import ModelSettings

from dify_agent.layers.browser.resilient_model import DEFAULT_OUTPUT_RETRIES, ResilientPydanticAIChatModel


class _ThinkingOnlyModel(Model):
    """Model that always answers with reasoning content only."""

    def __init__(self) -> None:
        super().__init__()
        self.request_count = 0

    @property
    def model_name(self) -> str:
        return "thinking-only"

    @property
    def system(self) -> str:
        return "stub"

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.request_count += 1
        return ModelResponse(parts=[ThinkingPart(content="thinking about the tab...")])


class _TextModel(Model):
    """Model that always answers with plain text."""

    def __init__(self, text: str) -> None:
        super().__init__()
        self._text = text
        self.request_count = 0

    @property
    def model_name(self) -> str:
        return "text"

    @property
    def system(self) -> str:
        return "stub"

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.request_count += 1
        return ModelResponse(parts=[TextPart(content=self._text)])


class ResilientPydanticAIChatModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_thinking_only_turns_up_to_budget(self) -> None:
        inner = _ThinkingOnlyModel()
        model = ResilientPydanticAIChatModel(inner, output_retries=2)
        with self.assertRaises(UnexpectedModelBehavior):
            await model.ainvoke(messages=[UserMessage(content="go")])
        self.assertEqual(inner.request_count, 3)

    async def test_uses_default_budget_when_not_configured(self) -> None:
        inner = _ThinkingOnlyModel()
        model = ResilientPydanticAIChatModel(inner)
        with self.assertRaises(UnexpectedModelBehavior):
            await model.ainvoke(messages=[UserMessage(content="go")])
        self.assertEqual(inner.request_count, DEFAULT_OUTPUT_RETRIES + 1)

    async def test_zero_budget_makes_no_retry(self) -> None:
        inner = _ThinkingOnlyModel()
        model = ResilientPydanticAIChatModel(inner, output_retries=0)
        with self.assertRaises(UnexpectedModelBehavior):
            await model.ainvoke(messages=[UserMessage(content="go")])
        self.assertEqual(inner.request_count, 1)

    async def test_actionable_response_passes_through_without_retry(self) -> None:
        inner = _TextModel("opened the page")
        model = ResilientPydanticAIChatModel(inner)
        completion = await model.ainvoke(messages=[UserMessage(content="go")])
        self.assertEqual(completion.completion, "opened the page")
        self.assertEqual(inner.request_count, 1)

    async def test_inner_model_is_forwarded_unchanged(self) -> None:
        inner: Any = _ThinkingOnlyModel()
        model = ResilientPydanticAIChatModel(inner)
        self.assertIs(model._model, inner)
