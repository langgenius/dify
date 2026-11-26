"""Connector cause is diagnostic only; it cannot establish native execution evidence."""

import json
from collections.abc import Callable
from contextvars import copy_context

import pytest

from core.dify_builder.contract import AssistantReplyMode, ExecutionProgressStatus
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from runtime_contracts.builder.execution import FailureResourceKind
from services.dify_builder import trace_diagnostics as diagnostics
from services.dify_builder.native_launch_observation import (
    NativeLaunchObservation,
    begin_preparation,
    mark_dispatched,
    observe_resource,
)
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as full_run_harness

harness = full_run_harness

PREFIX = (
    "Failed to activate plugin before invocation: unexpected response from serverless connector activation: status="
)
BODY = json.dumps({"error": "synthetic serviceaccount cannot patch leases token=secret https://private"})
MESSAGE = PREFIX + "500 body=" + BODY


def _typed(message: str = MESSAGE, code: int = -500) -> PluginDaemonInnerError:
    # Keyword construction deliberately does not populate Exception.args.
    return PluginDaemonInnerError(code=code, message=message)


def test_typed_activation_cause_is_bounded_and_does_not_depend_on_str() -> None:
    error = _typed()
    assert str(error) == ""
    assert diagnostics.failure_reason(error) == "service_unavailable"


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError(MESSAGE),
        ValueError(json.dumps({"error_type": "PluginDaemonInnerError", "message": MESSAGE})),
        _typed(code=-400),
        _typed(PREFIX + "400 body=" + BODY),
        _typed(PREFIX + "5000 body=" + BODY),
        _typed("Code output: " + MESSAGE),
        _typed(PREFIX + "500 body=not-json"),
        _typed(PREFIX + '500 body={"error":{"message":"nested"}}'),
        _typed(PREFIX + '500 body=["error"]'),
        _typed(json.dumps({"error_type": "PluginDaemonInnerError", "message": MESSAGE})),
    ],
)
def test_text_and_malformed_envelopes_cannot_claim_activation(error: Exception) -> None:
    assert diagnostics.failure_reason(error) == "unknown"
    records = []
    observation = NativeLaunchObservation()
    with diagnostics.scope(records.append, "native"), observation.track():
        begin_preparation()
        with pytest.raises(type(error)):
            with observe_resource(FailureResourceKind.MODEL, "provider", "model"):
                raise error
    assert records == []


def _runtime_failure(monkeypatch: pytest.MonkeyPatch) -> Callable[[], AIModelEntity | None]:
    client = PluginModelClient()
    envelope = {"code": -500, "message": json.dumps({"error_type": "PluginDaemonInnerError", "message": MESSAGE})}
    monkeypatch.setattr(client, "_stream_request", lambda *_a, **_k: iter([json.dumps(envelope)]))
    # Only this test-local object misses the schema cache; shared Redis is untouched.
    monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client.get", lambda _: None)
    runtime = PluginModelRuntime("tenant", "account", client, PluginService)
    return lambda: runtime.get_model_schema(
        provider="langgenius/synthetic/synthetic", model_type=ModelType.LLM, model="synthetic", credentials={}
    )


@pytest.mark.parametrize("dispatched", [False, True])
def test_real_metadata_adapter_preserves_safe_cause_across_worker_context(
    monkeypatch: pytest.MonkeyPatch, dispatched: bool
) -> None:
    fail = _runtime_failure(monkeypatch)
    records = []
    observation = NativeLaunchObservation()
    with diagnostics.scope(records.append, "build-test-and-repair"), observation.track():
        begin_preparation()
        worker_context = copy_context()
        if dispatched:
            mark_dispatched()
        with pytest.raises(PluginDaemonInnerError) as caught:
            worker_context.run(fail)
    assert observation.failed_before_dispatch is not dispatched
    assert observation.resource_for(caught.value) == ("model", "langgenius/synthetic/synthetic", "synthetic")
    assert len(records) == 1
    assert records[0]["code"] == ("native_outcome_unknown" if dispatched else "native_preparation_failed")
    assert records[0]["reason"] == "service_unavailable"
    assert records[0]["provider"] == "langgenius/synthetic/synthetic"
    assert records[0]["model"] == "synthetic"
    assert records[0]["span_id"] == "build-test-and-repair"
    assert "secret" not in json.dumps(records)
    assert "serviceaccount" not in json.dumps(records)
    assert "https://private" not in json.dumps(records)


def test_no_active_native_observation_does_not_emit_native_diagnostic(monkeypatch: pytest.MonkeyPatch) -> None:
    fail = _runtime_failure(monkeypatch)
    records = []
    with diagnostics.scope(records.append, "inventory"), pytest.raises(PluginDaemonInnerError):
        fail()
    assert records == []


def test_emitted_and_persisted_trace_retains_actual_worker_resource(
    repo: SqlDifyBuilderRepository, monkeypatch: pytest.MonkeyPatch
) -> None:

    from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
    from core.dify_builder.models import Action, DifyBuilderContext, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.runner import Env, Runner, StepResult
    from tests.unit_tests.core.dify_builder.test_runner import _actor, _new_env, _session

    fail = _runtime_failure(monkeypatch)
    env, _ = _new_env()
    env.repo = repo
    events = []
    env.emit_item = events.append
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])

    def handler(_env: Env, _turn: Turn, session: Session, context: DifyBuilderContext) -> StepResult:
        observation = NativeLaunchObservation()
        with observation.track():
            begin_preparation()
            worker_context = copy_context()
            mark_dispatched()
            with pytest.raises(PluginDaemonInnerError):
                worker_context.run(fail)
        assert not observation.failed_before_dispatch
        item = AssistantTurnItem(
            turn_id="resource-trace-turn",
            stage_id=str(session.current_state),
            execution=ExecutionProgress(status=ExecutionProgressStatus.COMPLETED),
            reply_text="Review existing Run",
            reply_mode=AssistantReplyMode.COMPLETE,
        ).to_item(seq=0, at_version=2)
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=context, items=[item])

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id, Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    )
    assistant = repo.list_conversation(session.id)[-1]
    persisted = assistant.payload["diagnostics"]
    assert events[-1].item.payload["diagnostics"] == persisted
    projected = diagnostics.from_history([assistant], session_id=session.id, version=assistant.at_version)
    for record in (persisted[0], projected[0]):
        assert record["code"] == "native_outcome_unknown"
        assert record["reason"] == "service_unavailable"
        assert record["provider"] == "langgenius/synthetic/synthetic"
        assert record["model"] == "synthetic"
        assert record["at_version"] == assistant.at_version
        assert "secret" not in json.dumps(record)


@pytest.mark.parametrize("identifier", ["https://private?token=secret", "x" * 129, "private\nsecret"])
def test_trace_projection_rejects_unsafe_resource_identifiers(identifier: str) -> None:
    records = []
    with diagnostics.scope(records.append, "native"), NativeLaunchObservation().track():
        begin_preparation()
        mark_dispatched()
        with pytest.raises(PluginDaemonInnerError):
            with observe_resource(FailureResourceKind.MODEL, identifier, identifier):
                raise _typed()
    assert records[0]["reason"] == "service_unavailable"
    assert "provider" not in records[0]
    assert "model" not in records[0]
    assert "secret" not in json.dumps(records)


def test_tool_resource_name_does_not_become_a_model_identifier() -> None:
    records = []
    with diagnostics.scope(records.append, "native"), NativeLaunchObservation().track():
        begin_preparation()
        with pytest.raises(PluginDaemonInnerError):
            with observe_resource(FailureResourceKind.TOOL, "synthetic/tool", "send_message"):
                raise _typed()
    assert records[0]["provider"] == "synthetic/tool"
    assert "model" not in records[0]
