"""Model result receipts match the SDK's exact Graphon chunk wire representation."""

import copy
import json
from types import SimpleNamespace

import pytest
from dify_agent.adapters.llm.provider import ProtectedModelChunkReceipt
from dify_agent.runtime.native_continuation import NativePolicyStopped

from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.dify_builder_native_tests import NativeEffectOperation
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_json
from runtime_contracts.builder.native.contracts import operation_digest
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope


@pytest.mark.parametrize("with_tool_history", [False, True])
@pytest.mark.parametrize("repeated_prompt", [False, True])
def test_model_receipt_matches_sdk_roundtrip_without_changing_stream_or_accepting_replacement(
    sqlite_session_factory, monkeypatch, with_tool_history, repeated_prompt
):
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
    stored, claims, outcomes, calls = {}, [], [], []

    def store(**kwargs):
        stored["actual-result"] = copy.deepcopy(kwargs["result"])
        return "actual-result"

    def completed(**kwargs):
        outcomes.append(kwargs)
        with sqlite_session_factory() as sql:
            sql.add(
                NativeEffectOperation(
                    tenant_id="tenant",
                    request_id=pending.ref.request_id,
                    invocation_id=pending.ref.invocation_id,
                    operation_digest=operation_digest(pending.intent.key),
                    intent_digest="a" * 64,
                    scope_digest="b" * 64,
                    state=kwargs["outcome"],
                    result_ref=kwargs["result_ref"],
                )
            )
            sql.commit()

    service = AgentOperationService(
        loader=SimpleNamespace(
            load=lambda **_kwargs: SimpleNamespace(tenant_id="tenant"), session_factory=sqlite_session_factory
        ),
        state_store=SimpleNamespace(
            store_result=store, load_result=lambda **kwargs: copy.deepcopy(stored[kwargs["result_ref"]])
        ),
        assessor=object(),
    )
    service.bridge.authorization = SimpleNamespace(
        claim_dispatch=lambda **kwargs: claims.append(kwargs), record_outcome=completed
    )
    monkeypatch.setattr(service, "validate_model", lambda **_kwargs: None)
    monkeypatch.setattr(service, "_endpoint", lambda _ref: None)

    def provider():
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
    assert stored["actual-result"]["format"] == "dify-model-chunks-v1"
    assert len(stored["actual-result"]["prompts"]) == 1
    if repeated_prompt:
        assert len(json.dumps([chunk.model_dump(mode="json") for chunk in chunks]).encode()) > 1024 * 1024
        assert len(json.dumps(stored["actual-result"]).encode()) < 1024 * 1024
    changed["chunks"][-1]["chunk"]["delta"]["message"]["content"] = "fabricated"
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_conflict"):
        service.store_result(ref=pending.ref, key=pending.intent.key, result=changed)
    assert calls == ["provider"]


def test_actual_oversized_model_output_stops_before_yield_and_keeps_unknown_without_replay(monkeypatch):
    pending = envelope()
    claims, outcomes, stores, calls = [], [], [], []
    service = AgentOperationService(
        loader=object(),
        state_store=SimpleNamespace(store_result=lambda **kwargs: stores.append(kwargs)),
        assessor=object(),
    )
    service.bridge.authorization = SimpleNamespace(
        claim_dispatch=lambda **kwargs: claims.append(kwargs), record_outcome=lambda **kwargs: outcomes.append(kwargs)
    )
    monkeypatch.setattr(service, "validate_model", lambda **_kwargs: None)

    def provider():
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
