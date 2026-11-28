"""Tests for native agent construction."""

from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.settings import ModelSettings

from dify_agent.runtime.agent_factory import create_agent


def _stub_model() -> Model:
    class _StubModel(Model):
        @property
        def model_name(self) -> str:
            return "stub-model"

        @property
        def system(self) -> str:
            return "stub"

        async def request(
            self,
            messages: list[ModelMessage],
            model_settings: ModelSettings | None,
            model_request_parameters: ModelRequestParameters,
        ) -> ModelResponse:
            raise AssertionError("stub model must not be called")

    return _StubModel()


def test_create_agent_raises_output_retry_budget_for_thinking_only_turns() -> None:
    agent = create_agent(_stub_model(), toolsets=[], capabilities=[])

    # Thinking-capable models can answer with reasoning content only; the default
    # output retry budget of 1 fails the run on a double miss. The factory must
    # raise it so the retry prompt can elicit an actionable answer.
    assert agent._max_output_retries > 1  # pyright: ignore[reportPrivateUsage]
