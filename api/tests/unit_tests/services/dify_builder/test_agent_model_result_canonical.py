"""Model result receipts match the SDK's exact Graphon chunk wire representation."""

import copy
import json
from collections.abc import Iterator

import pytest
from dify_agent.adapters.llm.provider import ProtectedModelChunkReceipt
from dify_agent.runtime.native_continuation import NativePolicyStopped
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.dify_builder_native_tests import NativeEffectOperation
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_json
from runtime_contracts.builder.native.contracts import operation_digest
from services.dify_builder.native_testing.agent_bridge import api_intent
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from tests.unit_tests.services.dify_builder import native_owner_fixtures
from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

operations_service = native_owner_fixtures.operations_service


@pytest.mark.parametrize("with_tool_history", [False, True])
@pytest.mark.parametrize("repeated_prompt", [False, True])
def test_model_receipt_matches_sdk_roundtrip_without_changing_stream_or_accepting_replacement(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    with_tool_history: bool,
    repeated_prompt: bool,
    operations_service: AgentOperationService,
) -> None:
    pending = envelope()
    messages = (
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "synthetic-call",
                        "type": "function",
                        "function": {"name": "synthetic_parse", "arguments": "{}"},
                    }
                ],
            },
            {"role": "tool", "content": "synthetic-result", "tool_call_id": "synthetic-call"},
        ]
        if with_tool_history
        else []
    )
    if repeated_prompt:
        messages.append({"role": "user", "content": "Synthetic prompt " * 4096})
    contents = ["synthetic-", "answer"] if not repeated_prompt else ["a"] * 24
    # Plugins provide dict prompt messages; construct preserves that actual input
    # shape. All fixture values are invented, rather than copied runtime payloads.
    chunks = [
        LLMResultChunk.model_construct(
            model="synthetic-model",
            prompt_messages=messages,
            delta=LLMResultChunkDelta(index=index, message=AssistantPromptMessage(content=content)),
        )
        for index, content in enumerate(contents)
    ]
    stored: dict[str, JsonValue] = {}
    claims: list[dict[str, object]] = []
    outcomes: list[dict[str, object]] = []
    calls: list[str] = []

    def store(*, result: JsonValue, **_kwargs: object) -> str:
        stored["actual-result"] = copy.deepcopy(result)
        return "actual-result"

    def completed(*, outcome: str, result_ref: str | None, **kwargs: object) -> None:
        outcomes.append({**kwargs, "outcome": outcome, "result_ref": result_ref})
        with sqlite_session_factory() as sql:
            sql.add(
                NativeEffectOperation(
                    tenant_id="tenant",
                    request_id=pending.ref.request_id,
                    invocation_id=pending.ref.invocation_id,
                    operation_digest=operation_digest(api_intent(pending.intent).key),
                    intent_digest="a" * 64,
                    scope_digest="b" * 64,
                    state=outcome,
                    result_ref=result_ref,
                )
            )
            sql.commit()

    from dataclasses import replace

    from services.dify_builder.native_testing.agent_bridge import api_ref
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner

    service = operations_service
    owned = replace(preparation_owner(), ref=api_ref(pending.ref))
    monkeypatch.setattr(service.loader, "load", lambda **_kwargs: owned)
    monkeypatch.setattr(service.loader, "session_factory", sqlite_session_factory)
    monkeypatch.setattr(service.state_store, "store_result", store)
    monkeypatch.setattr(
        service.state_store, "load_result", lambda **kwargs: copy.deepcopy(stored[kwargs["result_ref"]])
    )
    monkeypatch.setattr(service.bridge.authorization, "claim_dispatch", lambda **kwargs: claims.append(kwargs))
    monkeypatch.setattr(service.bridge.authorization, "record_outcome", completed)
    monkeypatch.setattr(service, "validate_model", lambda **_kwargs: None)
    monkeypatch.setattr(service, "_endpoint", lambda _ref: None)

    def provider() -> Iterator[LLMResultChunk]:
        calls.append("provider")
        yield from chunks

    yielded = list(service.invoke_model(envelope=pending, invoke=provider))
    sdk_receipt = ProtectedModelChunkReceipt()
    for chunk in yielded:
        sdk_receipt.append(LLMResultChunk.model_validate(chunk.model_dump(mode="json")))
    sdk_result = sdk_receipt.value
    assert all(actual is original for actual, original in zip(yielded, chunks, strict=True))
    assert [chunk.delta.message.content for chunk in yielded] == contents
    assert calls == ["provider"]
    assert len(claims) == len(outcomes) == 1
    assert outcomes[0]["outcome"] == "completed"
    assert canonical_json(stored["actual-result"]) == canonical_json(sdk_result)
    assert service.store_result(ref=pending.ref, key=pending.intent.key, result=sdk_result) == "actual-result"
    changed = copy.deepcopy(sdk_result)
    protected = stored["actual-result"]
    assert isinstance(protected, dict)
    assert protected["format"] == "dify-model-chunks-v1"
    assert isinstance(protected["prompts"], list)
    assert len(protected["prompts"]) == 1
    if repeated_prompt:
        assert len(json.dumps([chunk.model_dump(mode="json") for chunk in chunks]).encode()) > 1024 * 1024
        assert len(json.dumps(stored["actual-result"]).encode()) < 1024 * 1024
    changed_chunks = changed["chunks"]
    assert isinstance(changed_chunks, list)
    changed_entry = changed_chunks[-1]
    assert isinstance(changed_entry, dict)
    changed_chunk = changed_entry["chunk"]
    assert isinstance(changed_chunk, dict)
    changed_delta = changed_chunk["delta"]
    assert isinstance(changed_delta, dict)
    changed_message = changed_delta["message"]
    assert isinstance(changed_message, dict)
    changed_message["content"] = "fabricated"
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_conflict"):
        service.store_result(ref=pending.ref, key=pending.intent.key, result=changed)
    assert calls == ["provider"]


def test_actual_oversized_model_output_stops_before_yield_and_keeps_unknown_without_replay(
    monkeypatch: pytest.MonkeyPatch, operations_service: AgentOperationService
) -> None:
    pending = envelope()
    claims: list[dict[str, object]] = []
    outcomes: list[dict[str, object]] = []
    stores: list[dict[str, object]] = []
    calls: list[str] = []
    service = operations_service
    monkeypatch.setattr(service.state_store, "store_result", lambda **kwargs: stores.append(kwargs))
    monkeypatch.setattr(service.bridge.authorization, "claim_dispatch", lambda **kwargs: claims.append(kwargs))
    monkeypatch.setattr(service.bridge.authorization, "record_outcome", lambda **kwargs: outcomes.append(kwargs))
    monkeypatch.setattr(service, "validate_model", lambda **_kwargs: None)

    def provider() -> Iterator[LLMResultChunk]:
        calls.append("provider")
        for index, text in enumerate(("small", "x" * (1024 * 1024))):
            yield LLMResultChunk(
                model="synthetic-model",
                prompt_messages=[],
                delta=LLMResultChunkDelta(index=index, message=AssistantPromptMessage(content=text)),
            )

    stream = service.invoke_model(envelope=pending, invoke=provider)
    assert next(stream).delta.message.content == "small"
    with pytest.raises(NativePolicyStopped, match="native_model_result_too_large"):
        next(stream)
    assert len(claims) == 1
    assert calls == ["provider"]
    assert stores == []
    assert len(outcomes) == 1
    assert outcomes[0]["outcome"] == "unknown"
    assert outcomes[0]["result_ref"] is None
