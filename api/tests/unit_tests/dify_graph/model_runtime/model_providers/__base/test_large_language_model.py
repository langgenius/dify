import logging
from collections.abc import Generator, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import dify_graph.model_runtime.model_providers.__base.large_language_model as llm_module

# Access large_language_model members via llm_module to avoid partial import issues in CI
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from dify_graph.model_runtime.callbacks.base_callback import Callback
from dify_graph.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
)
from dify_graph.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from dify_graph.model_runtime.entities.model_entities import ModelType, PriceInfo
from dify_graph.model_runtime.model_providers.__base.large_language_model import _build_llm_result_from_chunks


def _usage(prompt_tokens: int = 1, completion_tokens: int = 2) -> LLMUsage:
    return LLMUsage(
        prompt_tokens=prompt_tokens,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal(1),
        prompt_price=Decimal(prompt_tokens) * Decimal("0.001"),
        completion_tokens=completion_tokens,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal(1),
        completion_price=Decimal(completion_tokens) * Decimal("0.002"),
        total_tokens=prompt_tokens + completion_tokens,
        total_price=Decimal(prompt_tokens) * Decimal("0.001") + Decimal(completion_tokens) * Decimal("0.002"),
        currency="USD",
        latency=0.0,
    )


def _tool_call_delta(
    *,
    tool_call_id: str,
    tool_type: str = "function",
    function_name: str = "",
    function_arguments: str = "",
) -> AssistantPromptMessage.ToolCall:
    return AssistantPromptMessage.ToolCall(
        id=tool_call_id,
        type=tool_type,
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name=function_name, arguments=function_arguments),
    )


def _chunk(
    *,
    model: str = "test-model",
    content: str | list[Any] | None = None,
    tool_calls: list[AssistantPromptMessage.ToolCall] | None = None,
    usage: LLMUsage | None = None,
    system_fingerprint: str | None = None,
) -> LLMResultChunk:
    return LLMResultChunk(
        model=model,
        system_fingerprint=system_fingerprint,
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content=content, tool_calls=tool_calls or []),
            usage=usage,
        ),
    )


@dataclass
class SpyCallback(Callback):
    raise_error: bool = False
    before: list[dict[str, Any]] = field(default_factory=list)
    new_chunk: list[dict[str, Any]] = field(default_factory=list)
    after: list[dict[str, Any]] = field(default_factory=list)
    error: list[dict[str, Any]] = field(default_factory=list)

    def on_before_invoke(self, **kwargs: Any) -> None:  # type: ignore[override]
        self.before.append(kwargs)

    def on_new_chunk(self, **kwargs: Any) -> None:  # type: ignore[override]
        self.new_chunk.append(kwargs)

    def on_after_invoke(self, **kwargs: Any) -> None:  # type: ignore[override]
        self.after.append(kwargs)

    def on_invoke_error(self, **kwargs: Any) -> None:  # type: ignore[override]
        self.error.append(kwargs)


class _TestLLM(llm_module.LargeLanguageModel):
    def get_price(self, model: str, credentials: dict, price_type: Any, tokens: int) -> PriceInfo:  # type: ignore[override]
        return PriceInfo(
            unit_price=Decimal("0.01"),
            unit=Decimal(1),
            total_amount=Decimal(tokens) * Decimal("0.01"),
            currency="USD",
        )

    def _transform_invoke_error(self, error: Exception) -> Exception:  # type: ignore[override]
        return RuntimeError(f"transformed: {error}")


@pytest.fixture
def llm() -> _TestLLM:
    plugin_provider = PluginModelProviderEntity.model_construct(
        id="provider-id",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        provider="provider",
        tenant_id="tenant",
        plugin_unique_identifier="plugin-uid",
        plugin_id="plugin-id",
        declaration=MagicMock(),
    )
    return _TestLLM.model_construct(
        tenant_id="tenant",
        model_type=ModelType.LLM,
        plugin_id="plugin-id",
        provider_name="provider",
        plugin_model_provider=plugin_provider,
        started_at=1.0,
    )


def test_gen_tool_call_id_is_uuid_based(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module.uuid, "uuid4", lambda: SimpleNamespace(hex="abc123"))
    assert llm_module._gen_tool_call_id() == "chatcmpl-tool-abc123"


def test_run_callbacks_no_callbacks_noop() -> None:
    invoked: list[int] = []
    llm_module._run_callbacks(None, event="x", invoke=lambda _: invoked.append(1))
    llm_module._run_callbacks([], event="x", invoke=lambda _: invoked.append(1))
    assert invoked == []


def test_run_callbacks_swallows_error_when_raise_error_false(caplog: pytest.LogCaptureFixture) -> None:
    class Boom:
        raise_error = False

    caplog.set_level(logging.WARNING)
    llm_module._run_callbacks(
        [Boom()], event="on_before_invoke", invoke=lambda _: (_ for _ in ()).throw(ValueError("boom"))
    )
    assert any("Callback" in record.message and "failed with error" in record.message for record in caplog.records)


def test_run_callbacks_reraises_when_raise_error_true() -> None:
    class Boom:
        raise_error = True

    with pytest.raises(ValueError, match="boom"):
        llm_module._run_callbacks(
            [Boom()], event="on_before_invoke", invoke=lambda _: (_ for _ in ()).throw(ValueError("boom"))
        )


def test_get_or_create_tool_call_empty_id_returns_last() -> None:
    calls = [
        _tool_call_delta(tool_call_id="id1", function_name="a"),
        _tool_call_delta(tool_call_id="id2", function_name="b"),
    ]
    assert llm_module._get_or_create_tool_call(calls, "") is calls[-1]


def test_get_or_create_tool_call_empty_id_without_existing_raises() -> None:
    with pytest.raises(ValueError, match="tool_call_id is empty"):
        llm_module._get_or_create_tool_call([], "")


def test_get_or_create_tool_call_creates_if_missing() -> None:
    calls: list[AssistantPromptMessage.ToolCall] = []
    tool_call = llm_module._get_or_create_tool_call(calls, "new-id")
    assert tool_call.id == "new-id"
    assert tool_call.function.name == ""
    assert tool_call.function.arguments == ""
    assert calls == [tool_call]


def test_get_or_create_tool_call_returns_existing_when_found() -> None:
    existing = _tool_call_delta(tool_call_id="same-id", function_name="fn", function_arguments="{}")
    calls = [existing]
    assert llm_module._get_or_create_tool_call(calls, "same-id") is existing


def test_merge_tool_call_delta_updates_fields_and_appends_arguments() -> None:
    tool_call = _tool_call_delta(tool_call_id="id", tool_type="function", function_name="x", function_arguments="{")
    delta = _tool_call_delta(tool_call_id="id2", tool_type="function", function_name="y", function_arguments="}")
    llm_module._merge_tool_call_delta(tool_call, delta)
    assert tool_call.id == "id2"
    assert tool_call.type == "function"
    assert tool_call.function.name == "y"
    assert tool_call.function.arguments == "{}"


def test_increase_tool_call_generates_id_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module.uuid, "uuid4", lambda: SimpleNamespace(hex="fixed"))
    delta = _tool_call_delta(tool_call_id="", function_name="fn", function_arguments="{")
    existing: list[AssistantPromptMessage.ToolCall] = []
    llm_module._increase_tool_call([delta], existing)
    assert len(existing) == 1
    assert existing[0].id == "chatcmpl-tool-fixed"
    assert existing[0].function.name == "fn"
    assert existing[0].function.arguments == "{"


def test_increase_tool_call_merges_incremental_arguments() -> None:
    existing: list[AssistantPromptMessage.ToolCall] = []
    llm_module._increase_tool_call(
        [_tool_call_delta(tool_call_id="id", function_name="fn", function_arguments="{")], existing
    )
    llm_module._increase_tool_call(
        [_tool_call_delta(tool_call_id="id", function_name="", function_arguments="}")], existing
    )
    assert len(existing) == 1
    assert existing[0].function.name == "fn"
    assert existing[0].function.arguments == "{}"


@pytest.mark.parametrize(
    ("content", "expected_type"),
    [
        ("hello", str),
        ([TextPromptMessageContent(data="hello")], list),
    ],
)
def test_build_llm_result_from_chunks_accumulates_and_raises_error(
    content: str | list[TextPromptMessageContent],
    expected_type: type,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(llm_module.uuid, "uuid4", lambda: SimpleNamespace(hex="drain"))
    caplog.set_level(logging.DEBUG)

    tool_delta = _tool_call_delta(tool_call_id="", function_name="fn", function_arguments="{}")
    first = _chunk(content=content, tool_calls=[tool_delta], usage=_usage(3, 4), system_fingerprint="fp1")

    def iter_with_error() -> Iterator[LLMResultChunk]:
        yield first
        raise RuntimeError("drain boom")

    with pytest.raises(RuntimeError, match="drain boom"):
        _build_llm_result_from_chunks(
            model="m", prompt_messages=[UserPromptMessage(content="u")], chunks=iter_with_error()
        )

    assert any("Error while consuming non-stream plugin chunk iterator" in record.message for record in caplog.records)


def test_build_llm_result_from_chunks_empty_iterator() -> None:
    def empty() -> Iterator[LLMResultChunk]:
        if False:  # pragma: no cover
            yield _chunk()
        return

    result = _build_llm_result_from_chunks(model="m", prompt_messages=[], chunks=empty())
    assert result.message.content == []
    assert result.usage.total_tokens == 0
    assert result.system_fingerprint is None


def test_build_llm_result_from_chunks_accumulates_all_chunks() -> None:
    chunks = iter([_chunk(content="first"), _chunk(content="second")])
    result = _build_llm_result_from_chunks(model="m", prompt_messages=[], chunks=chunks)
    assert result.message.content == "firstsecond"


def test_invoke_llm_via_plugin_passes_list_converted_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    invoked: dict[str, Any] = {}

    class FakePluginModelClient:
        def invoke_llm(self, **kwargs: Any) -> str:
            invoked.update(kwargs)
            return "ok"

    import core.plugin.impl.model as plugin_model_module

    monkeypatch.setattr(plugin_model_module, "PluginModelClient", FakePluginModelClient)

    prompt_messages: Sequence[PromptMessage] = (UserPromptMessage(content="hi"),)
    result = llm_module._invoke_llm_via_plugin(
        tenant_id="t",
        user_id="u",
        plugin_id="p",
        provider="prov",
        model="m",
        credentials={"k": "v"},
        model_parameters={"temp": 1},
        prompt_messages=prompt_messages,
        tools=None,
        stop=("a", "b"),
        stream=True,
    )

    assert result == "ok"
    assert invoked["prompt_messages"] == list(prompt_messages)
    assert invoked["stop"] == ["a", "b"]


def test_normalize_non_stream_plugin_result_passthrough_llmresult() -> None:
    llm_result = LLMResult(model="m", message=AssistantPromptMessage(content="x"), usage=_usage())
    assert (
        llm_module._normalize_non_stream_plugin_result(model="m", prompt_messages=[], result=llm_result) is llm_result
    )


def test_normalize_non_stream_plugin_result_builds_from_chunks() -> None:
    chunks = iter([_chunk(content="hello", usage=_usage(1, 1))])
    result = llm_module._normalize_non_stream_plugin_result(
        model="m", prompt_messages=[UserPromptMessage(content="u")], result=chunks
    )
    assert isinstance(result, LLMResult)
    assert result.message.content == "hello"


def test_invoke_non_stream_normalizes_and_sets_prompt_messages(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    plugin_result = LLMResult(model="m", message=AssistantPromptMessage(content="x"), usage=_usage())
    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.__base.large_language_model._invoke_llm_via_plugin",
        lambda **_: plugin_result,
    )
    cb = SpyCallback()
    prompt_messages = [UserPromptMessage(content="hi")]
    result = llm.invoke(model="m", credentials={}, prompt_messages=prompt_messages, stream=False, callbacks=[cb])
    assert isinstance(result, LLMResult)
    assert result.prompt_messages == prompt_messages
    assert len(cb.before) == 1
    assert len(cb.after) == 1
    assert cb.after[0]["result"].prompt_messages == prompt_messages


def test_invoke_stream_wraps_generator_and_triggers_callbacks(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    plugin_chunks = iter(
        [
            _chunk(model="m1", content="a"),
            _chunk(
                model="m2", content=[TextPromptMessageContent(data="b")], usage=_usage(2, 3), system_fingerprint="fp"
            ),
            _chunk(model="m3", content=None),
        ]
    )
    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.__base.large_language_model._invoke_llm_via_plugin",
        lambda **_: plugin_chunks,
    )

    cb = SpyCallback()
    prompt_messages = [UserPromptMessage(content="hi")]
    gen = llm.invoke(model="m", credentials={}, prompt_messages=prompt_messages, stream=True, callbacks=[cb])

    assert isinstance(gen, Generator)
    chunks = list(gen)
    assert len(chunks) == 3
    assert all(chunk.prompt_messages == prompt_messages for chunk in chunks)
    assert len(cb.before) == 1
    assert len(cb.new_chunk) == 3
    assert len(cb.after) == 1
    final_result: LLMResult = cb.after[0]["result"]
    assert final_result.model == "m3"
    assert final_result.system_fingerprint == "fp"
    assert isinstance(final_result.message.content, list)
    assert [c.data for c in final_result.message.content] == ["a", "b"]
    assert final_result.usage.total_tokens == 5


def test_invoke_triggers_error_callbacks_and_raises_transformed(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**_: Any) -> Any:
        raise ValueError("plugin down")

    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.__base.large_language_model._invoke_llm_via_plugin", boom
    )
    cb = SpyCallback()
    with pytest.raises(RuntimeError, match="transformed: plugin down"):
        llm.invoke(
            model="m", credentials={}, prompt_messages=[UserPromptMessage(content="x")], stream=False, callbacks=[cb]
        )
    assert len(cb.error) == 1
    assert isinstance(cb.error[0]["ex"], ValueError)


def test_invoke_raises_not_implemented_for_unsupported_result_type(
    llm: _TestLLM, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(llm_module, "_invoke_llm_via_plugin", lambda **_: "not-a-result")
    monkeypatch.setattr(llm_module, "_normalize_non_stream_plugin_result", lambda **_: "not-a-result")
    with pytest.raises(NotImplementedError, match="unsupported invoke result type"):
        llm.invoke(model="m", credentials={}, prompt_messages=[UserPromptMessage(content="x")], stream=False)


def test_invoke_appends_logging_callback_in_debug(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    captured_callbacks: list[list[Callback]] = []

    class FakeLoggingCallback(SpyCallback):
        pass

    monkeypatch.setattr(llm_module, "LoggingCallback", FakeLoggingCallback)
    monkeypatch.setattr(llm_module.dify_config, "DEBUG", True)
    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.__base.large_language_model._invoke_llm_via_plugin",
        lambda **_: LLMResult(model="m", message=AssistantPromptMessage(content="x"), usage=_usage()),
    )

    original_trigger = llm._trigger_before_invoke_callbacks

    def spy_trigger(*args: Any, **kwargs: Any) -> None:
        captured_callbacks.append(list(kwargs["callbacks"]))
        original_trigger(*args, **kwargs)

    monkeypatch.setattr(llm, "_trigger_before_invoke_callbacks", spy_trigger)
    llm.invoke(model="m", credentials={}, prompt_messages=[UserPromptMessage(content="x")], stream=False)
    assert any(isinstance(cb, FakeLoggingCallback) for cb in captured_callbacks[0])


def test_get_num_tokens_returns_0_when_plugin_disabled(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module.dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", False)
    assert llm.get_num_tokens(model="m", credentials={}, prompt_messages=[UserPromptMessage(content="x")]) == 0


def test_get_num_tokens_uses_plugin_when_enabled(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module.dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", True)

    class FakePluginModelClient:
        def get_llm_num_tokens(self, **kwargs: Any) -> int:
            assert kwargs["tenant_id"] == "tenant"
            assert kwargs["plugin_id"] == "plugin-id"
            assert kwargs["provider"] == "provider"
            assert kwargs["model_type"] == "llm"
            return 42

    import core.plugin.impl.model as plugin_model_module

    monkeypatch.setattr(plugin_model_module, "PluginModelClient", FakePluginModelClient)
    assert llm.get_num_tokens(model="m", credentials={}, prompt_messages=[UserPromptMessage(content="x")]) == 42


def test_calc_response_usage_uses_prices_and_latency(llm: _TestLLM, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module.time, "perf_counter", lambda: 4.5)
    llm.started_at = 1.0
    usage = llm.calc_response_usage(model="m", credentials={}, prompt_tokens=10, completion_tokens=5)
    assert usage.total_tokens == 15
    assert usage.total_price == Decimal("0.15")
    assert usage.latency == 3.5


def test_invoke_result_generator_raises_transformed_on_iteration_error(llm: _TestLLM) -> None:
    def broken() -> Iterator[LLMResultChunk]:
        yield _chunk(content="ok")
        raise ValueError("chunk stream broken")

    gen = llm._invoke_result_generator(
        model="m",
        result=broken(),
        credentials={},
        prompt_messages=[UserPromptMessage(content="u")],
        model_parameters={},
        callbacks=[SpyCallback()],
    )

    with pytest.raises(RuntimeError, match="transformed: chunk stream broken"):
        list(gen)
