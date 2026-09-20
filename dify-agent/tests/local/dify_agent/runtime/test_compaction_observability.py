import asyncio
import logging
from typing import Any

import pytest
from pydantic_ai.messages import ModelRequest, UserPromptPart

from dify_agent.runtime.compaction_observability import ObservableCompactionAdapter, wrap_compaction_observability


class FakeRequestContext:
    def __init__(self, messages: list[ModelRequest]) -> None:
        self.messages = messages
        self.model_request_parameters = None


class FakeDelegate:
    def __init__(self, messages: list[ModelRequest], *, target_tokens: int = 10) -> None:
        self.messages = messages
        self.target_tokens = target_tokens
        self.tokenizer = None

    async def before_model_request(self, ctx: Any, request_context: FakeRequestContext) -> FakeRequestContext:
        del ctx
        request_context.messages = self.messages
        return request_context


def _history(*content: str) -> list[ModelRequest]:
    return [ModelRequest(parts=[UserPromptPart(item)]) for item in content]


def test_wrapper_returns_none_without_changing_null_contract() -> None:
    assert wrap_compaction_observability(None, run_id="run-1") is None


def test_wrapper_delegates_to_the_real_capability() -> None:
    delegate = FakeDelegate(_history("short"))
    wrapped = wrap_compaction_observability(delegate, run_id="run-1")  # pyright: ignore[reportArgumentType]

    assert isinstance(wrapped, ObservableCompactionAdapter)
    assert wrapped.delegate is delegate  # pyright: ignore[reportAttributeAccessIssue]


def test_wrapper_does_not_log_when_history_is_not_rewritten(caplog: pytest.LogCaptureFixture) -> None:
    async def scenario() -> None:
        messages = _history("same")
        delegate = FakeDelegate(messages)
        request_context = FakeRequestContext(messages)
        wrapped = wrap_compaction_observability(delegate, run_id="run-1", logger=logging.getLogger(__name__))
        assert wrapped is not None

        result = await wrapped.before_model_request(None, request_context)  # pyright: ignore[reportArgumentType]

        assert result is request_context

    with caplog.at_level(logging.INFO, logger=__name__):
        asyncio.run(scenario())

    assert not [record for record in caplog.records if record.message == "agent context compacted"]


def test_wrapper_logs_counts_and_estimates_when_history_is_rewritten(caplog: pytest.LogCaptureFixture) -> None:
    async def scenario() -> FakeRequestContext:
        delegate = FakeDelegate(_history("short summary"))
        request_context = FakeRequestContext(_history("before-" + "x" * 100, "second"))
        wrapped = wrap_compaction_observability(delegate, run_id="run-1", logger=logging.getLogger(__name__))
        assert wrapped is not None

        return await wrapped.before_model_request(None, request_context)  # pyright: ignore[reportArgumentType]

    with caplog.at_level(logging.INFO, logger=__name__):
        result = asyncio.run(scenario())

    records = [record for record in caplog.records if record.message == "agent context compacted"]
    assert len(records) == 1
    attributes = records[0].__dict__
    assert attributes["run_id"] == "run-1"
    assert attributes["target_tokens"] == 10
    assert attributes["tier"] == "unknown"
    assert attributes["before_message_count"] == 2
    assert attributes["after_message_count"] == 1
    assert attributes["before_estimated_tokens"] > 0
    assert attributes["after_estimated_tokens"] > 0
    assert len(result.messages) == 1


def test_wrapper_propagates_delegate_failure_without_logging_success(caplog: pytest.LogCaptureFixture) -> None:
    class FailingDelegate:
        target_tokens = 10
        tokenizer = None

        async def before_model_request(self, ctx: Any, request_context: FakeRequestContext) -> FakeRequestContext:
            del ctx
            raise RuntimeError("compaction failed")

    async def scenario() -> None:
        wrapped = wrap_compaction_observability(
            FailingDelegate(),  # pyright: ignore[reportArgumentType]
            run_id="run-1",
            logger=logging.getLogger(__name__),
        )
        assert wrapped is not None
        await wrapped.before_model_request(
            None,
            FakeRequestContext(_history("before")),  # pyright: ignore[reportArgumentType]
        )

    with caplog.at_level(logging.INFO, logger=__name__), pytest.raises(RuntimeError, match="compaction failed"):
        asyncio.run(scenario())

    assert not [record for record in caplog.records if record.message == "agent context compacted"]
