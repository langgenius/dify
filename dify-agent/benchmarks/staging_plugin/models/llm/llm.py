# pyright: reportMissingImports=false, reportMissingTypeArgument=false
"""Dify Plugin SDK adapter for the deterministic staging benchmark model."""

from __future__ import annotations

import time
from collections.abc import Generator, Mapping
from decimal import Decimal

from dify_plugin.entities.model.llm import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from dify_plugin.entities.model.message import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    ToolPromptMessage,
    UserPromptMessage,
)
from dify_plugin.errors.model import InvokeBadRequestError, InvokeError
from dify_plugin.interfaces.model.large_language_model import LargeLanguageModel

from .contract import (
    MODEL_DELAY_SECONDS,
    MODEL_NAME,
    SHELL_TOOL_NAME,
    BenchmarkIdentity,
    ResponsePlan,
    build_response_plan,
    parse_benchmark_request,
)


_ZERO = Decimal("0")


class DifyAgentBenchmarkLargeLanguageModel(LargeLanguageModel):
    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]:
        del model_parameters, stop, user
        if model != MODEL_NAME:
            raise ValueError(f"unsupported deterministic benchmark model: {model!r}")
        _validate_benchmark_enabled(credentials)
        user_message_index, identity = _latest_benchmark_request(prompt_messages)
        plan = build_response_plan(
            identity=identity,
            tool_result_count=sum(
                isinstance(message, ToolPromptMessage) for message in prompt_messages[user_message_index + 1 :]
            ),
        )
        if plan.tool_name is not None and not any(tool.name == SHELL_TOOL_NAME for tool in tools or []):
            raise ValueError(f"runtime benchmark requires the {SHELL_TOOL_NAME!r} tool")

        time.sleep(MODEL_DELAY_SECONDS)
        message = _assistant_message(plan)
        usage = _fixed_usage()
        if stream:
            return _one_chunk_stream(message=message, usage=usage, finish_reason=plan.finish_reason)
        return LLMResult(
            model=MODEL_NAME,
            message=message,
            usage=usage,
            system_fingerprint="dify-agent-benchmark-model-v1",
        )

    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        if model != MODEL_NAME:
            raise ValueError(f"unsupported deterministic benchmark model: {model!r}")
        _validate_benchmark_enabled(credentials)

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        del credentials, prompt_messages, tools
        if model != MODEL_NAME:
            raise ValueError(f"unsupported deterministic benchmark model: {model!r}")
        return 10

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {InvokeBadRequestError: [ValueError]}


def _assistant_message(plan: ResponsePlan) -> AssistantPromptMessage:
    tool_calls: list[AssistantPromptMessage.ToolCall] = []
    if plan.tool_call_id is not None and plan.tool_name is not None and plan.tool_arguments is not None:
        tool_calls.append(
            AssistantPromptMessage.ToolCall(
                id=plan.tool_call_id,
                type="function",
                function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=plan.tool_name,
                    arguments=plan.tool_arguments,
                ),
            )
        )
    return AssistantPromptMessage(content=plan.content, tool_calls=tool_calls)


def _latest_benchmark_request(
    prompt_messages: list[PromptMessage],
) -> tuple[int, BenchmarkIdentity]:
    for index in range(len(prompt_messages) - 1, -1, -1):
        message = prompt_messages[index]
        if isinstance(message, UserPromptMessage):
            return index, parse_benchmark_request(message.content)
    raise ValueError("benchmark prompt did not contain a UserPromptMessage")


def _validate_benchmark_enabled(credentials: Mapping) -> None:
    if credentials.get("benchmark_enabled") != "enabled":
        raise ValueError("benchmark provider must be explicitly enabled")


def _one_chunk_stream(
    *,
    message: AssistantPromptMessage,
    usage: LLMUsage,
    finish_reason: str,
) -> Generator[LLMResultChunk, None, None]:
    yield LLMResultChunk(
        model=MODEL_NAME,
        system_fingerprint="dify-agent-benchmark-model-v1",
        delta=LLMResultChunkDelta(
            index=0,
            message=message,
            usage=usage,
            finish_reason=finish_reason,
        ),
    )


def _fixed_usage() -> LLMUsage:
    return LLMUsage(
        prompt_tokens=10,
        prompt_unit_price=_ZERO,
        prompt_price_unit=_ZERO,
        prompt_price=_ZERO,
        completion_tokens=5,
        completion_unit_price=_ZERO,
        completion_price_unit=_ZERO,
        completion_price=_ZERO,
        total_tokens=15,
        total_price=_ZERO,
        currency="USD",
        latency=MODEL_DELAY_SECONDS,
    )


__all__ = ["DifyAgentBenchmarkLargeLanguageModel"]
