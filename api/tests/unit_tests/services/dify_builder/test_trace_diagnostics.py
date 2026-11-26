"""Safe diagnostics must survive the real cognition boundary without response data."""

import json
from collections.abc import Iterator
from typing import Protocol

import pytest

from core.dify_builder.contract import AssistantReplyMode, ExecutionProgressStatus
from core.dify_builder.models import Session
from core.model_manager import ModelInstance
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from services.dify_builder import trace_diagnostics as diagnostics
from services.dify_builder.agent import build, llm
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.agent.resources import TenantResources
from services.dify_builder.application.runner import Env
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.unit_tests.core.dify_builder.test_runner import _new_env, _session


class DiagnosticFactory(Protocol):
    def __call__(
        self,
        text: str = "{}",
        *,
        failure: BaseException | None = None,
        stream_failure: BaseException | None = None,
        metadata: bool = True,
    ) -> ModelInstance: ...


@pytest.fixture
def diagnostic_model(monkeypatch: pytest.MonkeyPatch) -> DiagnosticFactory:
    """Keep the actual model owner and control only its provider invocation."""

    def create(
        text: str = "{}",
        *,
        failure: BaseException | None = None,
        stream_failure: BaseException | None = None,
        metadata: bool = True,
    ) -> ModelInstance:
        model = make_model_instance(provider="langgenius/openai/openai", model="gpt-4")

        def invoke(**_kwargs: object) -> LLMResult | Iterator[LLMResultChunk]:
            if failure is not None:
                raise failure
            if stream_failure is not None:

                def chunks() -> Iterator[LLMResultChunk]:
                    raise stream_failure
                    yield

                return chunks()
            return LLMResult(model="gpt-4", message=AssistantPromptMessage(content=text), usage=LLMUsage.empty_usage())

        monkeypatch.setattr(model, "invoke_llm", invoke)
        if not metadata:
            del model.provider
            del model.model_name
        return model

    return create


def test_provider_failure_is_scoped_safe_and_recoverable(
    monkeypatch: pytest.MonkeyPatch, diagnostic_model: DiagnosticFactory
) -> None:
    monkeypatch.setattr(
        build, "planning_catalogue", lambda *_a, **_k: TenantResources(models=[], datasets=[], tools=[])
    )
    agent = LlmBuilderAgent("tenant")
    agent._model_instance = diagnostic_model(
        failure=ConnectionRefusedError("secret-token https://host/?key=secret"), metadata=False
    )
    records = []
    agent.set_diagnostic_callback(records.append)
    assert agent.propose_plan_v1({}, goal_text="private prompt") is None
    provider = next(record for record in records if record["code"] == "provider_invocation_failed")
    assert provider["span_id"] == "propose-plan-v1"
    assert provider["exception_type"] == "ConnectionRefusedError"
    assert "provider" not in provider
    assert "model" not in provider
    assert "secret" not in json.dumps(records)
    assert "private prompt" not in json.dumps(records)


def test_generation_projection_retains_attempt_not_arbitrary_strings() -> None:
    records = []
    with diagnostics.scope(records.append, "build-nodes"):
        diagnostics.generation(
            [{"attempt": 1, "message": "secret", "codes": ["UNRESOLVED_REFERENCE"], "errors": [{"detail": "secret"}]}]
        )
    assert records[0]["attempt"] == 1
    assert records[0]["code"] == "generation_validation_failed"
    assert "secret" not in json.dumps(records)


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (RuntimeError("connection refused http://internal?token=secret"), "unknown"),
        (ConnectionRefusedError("connection refused http://internal?token=secret"), "connection_refused"),
    ],
)
def test_connection_refusal_requires_typed_error_without_echo(failure: Exception, reason: str) -> None:
    records = []
    with diagnostics.scope(records.append, "plan"):
        diagnostics.report("provider_invocation_failed", error=failure)
    assert records[0]["reason"] == reason
    assert "secret" not in json.dumps(records)


def test_cas_emission_and_reload_preserve_additive_safe_diagnostics(
    repo: SqlDifyBuilderRepository, monkeypatch: pytest.MonkeyPatch, diagnostic_model: DiagnosticFactory
) -> None:
    from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
    from core.dify_builder.models import Action, DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.runner import Runner, StepResult
    from tests.unit_tests.core.dify_builder.test_runner import _actor

    env, _ = _new_env()
    env.repo = repo
    agent = LlmBuilderAgent("tenant")
    agent._model_instance = diagnostic_model(
        failure=ConnectionRefusedError("connection refused http://internal?token=secret")
    )
    env.agent = agent
    monkeypatch.setattr(
        build, "planning_catalogue", lambda *_a, **_k: TenantResources(models=[], datasets=[], tools=[])
    )
    events = []
    env.emit_item = events.append
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])

    def handler(env: Env, _turn: Turn, session: Session, context: DifyBuilderContext) -> StepResult:
        assert env.agent.propose_plan_v1({}, goal_text="private goal") is None
        item = AssistantTurnItem(
            turn_id="trace-turn",
            stage_id=str(session.current_state),
            execution=ExecutionProgress(status=ExecutionProgressStatus.COMPLETED),
            reply_text="Review result",
            reply_mode=AssistantReplyMode.COMPLETE,
        ).to_item(seq=0, at_version=2)
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=context, items=[item])

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id, Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    )
    assistant = repo.list_conversation(session.id)[-1]
    assert assistant.payload["diagnostics"][0]["reason"] == "connection_refused"
    assert assistant.payload["diagnostics"][0]["at_version"] == assistant.at_version
    assert events[-1].item.payload["diagnostics"] == assistant.payload["diagnostics"]


def test_context_scope_does_not_leak_between_nested_calls() -> None:
    outer: list[dict[str, object]] = []
    inner: list[dict[str, object]] = []
    with diagnostics.scope(outer.append, "outer"):
        with diagnostics.scope(inner.append, "inner"):
            diagnostics.report("empty_response")
        diagnostics.report("empty_response")
    diagnostics.report("empty_response")
    assert [r["span_id"] for r in outer] == ["outer"]
    assert [r["span_id"] for r in inner] == ["inner"]


def test_resolved_model_identifiers_are_bounded_without_extra_config(
    diagnostic_model: DiagnosticFactory,
) -> None:
    agent = LlmBuilderAgent("tenant", {"provider": "langgenius/openai/openai", "name": "gpt-4", "api_key": "secret"})
    agent._model_instance = diagnostic_model(failure=ConnectionRefusedError())
    records = []
    agent.set_diagnostic_callback(records.append)
    agent.analyze_goal("goal")
    assert records[0]["provider"] == "langgenius/openai/openai"
    assert records[0]["model"] == "gpt-4"
    assert "secret" not in json.dumps(records)


def test_previous_operation_callback_cannot_contaminate_new_operation() -> None:
    env, _ = _new_env()
    agent = LlmBuilderAgent("tenant")
    env.agent = agent
    session = _session()
    env.begin_operation(session)
    old_callback = agent._diagnostic_callback
    assert old_callback is not None
    env.begin_operation(session)
    old_callback({"code": "empty_response"})
    assert env.diagnostics == []


def test_stream_iterator_failure_retains_scope(diagnostic_model: DiagnosticFactory) -> None:
    records = []
    with diagnostics.scope(records.append, "respond-to-message"):
        with pytest.raises(TimeoutError):
            list(llm.invoke_text_stream(diagnostic_model(stream_failure=TimeoutError("secret")), system="", user=""))
    assert records[0]["reason"] == "timeout"
    assert records[0]["span_id"] == "respond-to-message"
    assert "secret" not in json.dumps(records)


def test_snapshot_history_preserves_identity_and_previous_failure_after_success() -> None:
    from core.dify_builder.models import ConversationItem

    record = diagnostics.project({"code": "provider_invocation_failed"})
    rows = [
        ConversationItem(seq=1, kind="assistant_turn", payload={"diagnostics": [record]}),
        ConversationItem(seq=2, kind="assistant_turn", payload={}),
    ]
    safe = diagnostics.from_history(rows, session_id="session", version=2)
    assert safe[0]["id"] == record["id"]
    assert safe[0]["at"] == record["at"]
    assert safe[0]["session_id"] == "session"


def test_native_preparation_diagnostic_is_persisted_with_handler_reply() -> None:
    from core.dify_builder.models import Action, ConversationItem, DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.runner import Runner, StepResult
    from tests.unit_tests.core.dify_builder.test_runner import _actor

    env, memory_repo = _new_env()
    session = _session()
    memory_repo.create_session(session, DifyBuilderContext(), [])

    def handler(_env: Env, _turn: Turn, _session: Session, context: DifyBuilderContext) -> StepResult:
        diagnostics.report("native_preparation_failed", error=ConnectionRefusedError("private-secret-address"))
        return StepResult(
            next=PcState.FIX_AWAIT_APPROVAL,
            context=context,
            items=[
                ConversationItem(seq=0, kind="assistant_turn", payload={"reply_mode": "complete", "reply": "failed"})
            ],
        )

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id, Turn(actor=_actor(), action=Action(kind="request_fix", base_version=1))
    )
    records = memory_repo.list_conversation(session.id)[0].payload["diagnostics"]
    assert records[0]["code"] == "native_preparation_failed"
    assert records[0]["span_id"] == "fix-diagnose"
    assert records[0]["reason"] == "connection_refused"
    assert "secret" not in json.dumps(records)


def test_resource_binding_refusal_retains_safe_code_and_target_without_private_message() -> None:
    records = []
    with diagnostics.scope(records.append, "edit-apply"):
        diagnostics.report(
            "validation_refused",
            error=ValueError("token=private"),
            validation_code="RESOURCE_SELECTION_REQUIRED",
            node_id="order_explain_llm",
        )
    assert records[0]["validation_codes"] == ["RESOURCE_SELECTION_REQUIRED"]
    assert records[0]["node_id"] == "order_explain_llm"
    assert "private" not in json.dumps(records)


def test_native_model_projection_is_fixed_and_does_not_copy_exception_metadata() -> None:
    safe = diagnostics.project(
        {
            "code": "native_model_invocation_failed",
            "native_stage": "invoke",
            "native_category": "quota_exceeded",
            "exception_type": "PrivateException",
            "message": "private provider body",
            "provider": "private/provider",
            "reason": "rate_limit",
        }
    )
    assert safe["native_stage"] == "invoke"
    assert safe["native_category"] == "quota_exceeded"
    assert safe["category"] == "native"
    assert "exception_type" not in safe
    assert "provider" not in safe
    assert "reason" not in safe
    assert "private" not in json.dumps(safe).lower()
    assert (
        diagnostics.project(
            {"code": "native_model_invocation_failed", "native_stage": "forged", "native_category": "quota_exceeded"}
        )
        == {}
    )


@pytest.mark.parametrize(
    ("stage", "category"), [("invoke", "provider secret"), (None, "timeout"), ("invoke", None), ({}, [])]
)
def test_native_model_projection_rejects_malformed_classification(stage: object, category: object) -> None:
    assert (
        diagnostics.project(
            {"code": "native_model_invocation_failed", "native_stage": stage, "native_category": category}
        )
        == {}
    )


def test_repair_detail_projection_bounds_counts_and_drops_arbitrary_metadata() -> None:
    raw = {
        "stage": "operation",
        "reason_code": "invalid_path",
        "op": "set_node_config",
        "node_index": 1,
        "node_id": "SECRET",
        "path": ["cases", "*", "SECRET"],
        "value": {"SECRET": "SECRET"},
        "message": "SECRET",
        "exception_type": "SECRET",
    }
    projected = diagnostics.project({"code": "validation_refused", "validation_details": [raw] * 40})
    assert len(projected["validation_details"]) == 16
    assert projected["validation_detail_count"] == 40
    assert projected["validation_details_truncated"] is True
    assert projected["validation_details"][0]["path"] == ["cases", "*", "unknown"]
    assert "SECRET" not in json.dumps(projected)
    assert diagnostics.project(projected)["validation_detail_count"] == 40
    assert "validation_details" not in diagnostics.project({"code": "validation_refused"})
    deep = diagnostics.project(
        {"code": "validation_refused", "validation_details": [{**raw, "path": ["cases"] * 10000}]}
    )
    assert len(deep["validation_details"][0]["path"]) == 8
    assert deep["validation_details"][0]["path_truncated"] is True
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.preflight import vet_intents

    actual = vet_intents({"nodes": [], "edges": []}, [MutationIntent(op="SECRET", args={}) for _ in range(40)])
    records = []
    with diagnostics.scope(records.append, "propose-repair"):
        diagnostics.report("validation_refused", attempt=1, validation_details=actual.validation_details)
    assert len(records[0]["validation_details"]) == 16
    assert records[0]["validation_detail_count"] == 40
    assert records[0]["validation_details_truncated"] is True
    for unknown in ("SECRET", {"SECRET": "SECRET"}, ["SECRET"], None):
        detail = diagnostics.validation_detail({"stage": "native_config", "reason_code": unknown, "path": [unknown]})
        assert detail == {"stage": "native_config", "reason_code": "native_validation_error", "path": ["unknown"]}
    assert "SECRET" not in json.dumps(records)


def test_repair_details_survive_real_cas_item_history_and_http_projection(repo: SqlDifyBuilderRepository) -> None:
    from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse
    from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
    from core.dify_builder.models import Action, DifyBuilderContext, MutationIntent, Turn
    from core.dify_builder.state import PcState
    from libs.helper import dump_response
    from services.dify_builder.application.runner import Runner, StepResult
    from services.dify_builder.preflight import vet_intents
    from tests.unit_tests.core.dify_builder.test_runner import _actor

    env, _ = _new_env()
    env.repo = repo
    events = []
    env.emit_item = events.append
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])

    def handler(_env: Env, _turn: Turn, current: Session, context: DifyBuilderContext) -> StepResult:
        vetted = vet_intents(
            {"nodes": [], "edges": []}, [MutationIntent(op="PRIVATE_OP", args={"value": "PRIVATE_VALUE"})]
        )
        diagnostics.report("validation_refused", attempt=2, validation_details=vetted.validation_details)
        item = AssistantTurnItem(
            turn_id="repair-trace",
            stage_id=str(current.current_state),
            execution=ExecutionProgress(status=ExecutionProgressStatus.COMPLETED),
            reply_text="Review repair",
            reply_mode=AssistantReplyMode.COMPLETE,
        ).to_item(seq=0, at_version=2)
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=context, items=[item])

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id, Turn(action=Action(kind="request_fix", base_version=1, command_id="repair-command"), actor=_actor())
    )
    assistant = repo.list_conversation(session.id)[-1]
    _, context = repo.get_session(session.id)
    assert context.last_command_id == "repair-command"
    assert events[-1].command_id == "repair-command"
    stored = assistant.payload["diagnostics"][0]
    assert stored["command_id"] == "repair-command"
    assert stored["attempt"] == 2
    assert stored["validation_details"] == [{"stage": "operation", "reason_code": "unknown_operation"}]
    assert stored["validation_detail_count"] == 1
    assert stored["validation_details_truncated"] is False
    assert events[-1].item.payload["diagnostics"] == [stored]
    history = diagnostics.from_history([assistant], session_id=session.id, version=2)
    assert history[0]["validation_details"] == stored["validation_details"]
    http = dump_response(
        DifyBuilderConversationPageResponse,
        {
            "data": [
                {
                    "seq": assistant.seq,
                    "kind": assistant.kind,
                    "payload": assistant.payload,
                    "at_version": assistant.at_version,
                }
            ],
            "has_more": False,
            "first_seq": 0,
            "last_seq": 0,
        },
    )
    assert http["data"][0]["payload"]["diagnostics"][0]["validation_details"] == stored["validation_details"]
    assert "PRIVATE" not in json.dumps(history)


@pytest.mark.parametrize(
    ("change", "reason", "path", "observed", "limit"),
    [
        ({"plan": None}, "type", ["plan"], None, None),
        ({"plan": []}, "empty", ["plan"], 0, 1),
        ({"plan": ["step"] * 31}, "step_count", ["plan"], 31, 30),
        ({"plan": [False]}, "type", ["plan", "*"], None, None),
        ({"plan": [" "]}, "blank", ["plan", "*"], 0, 1),
        ({"plan": ["x" * 2001]}, "step_length", ["plan", "*"], 2001, 2000),
        ({"title": None}, "type", ["title"], None, None),
        ({"title": " "}, "blank", ["title"], 0, 1),
        ({"title": "x" * 201}, "overview_length", ["title"], 201, 200),
        ({"input_summary": "x" * 2001}, "overview_length", ["input_summary"], 2001, 2000),
        ({"output_summary": "x" * 2001}, "overview_length", ["output_summary"], 2001, 2000),
        ({"plan": ["x" * 2000] * 12}, "total_length", [], 24003, 24000),
        ({}, "missing", ["plan"], None, None),
    ],
)
def test_plan_failure_facts_survive_actual_capture_without_values(
    diagnostic_model: DiagnosticFactory,
    change: dict[str, object],
    reason: str,
    path: list[str],
    observed: int | None,
    limit: int | None,
) -> None:
    payload: dict[str, object] = {"title": "t", "input_summary": "i", "output_summary": "o", "plan": ["PRIVATE"]}
    if change:
        payload.update(change)
    else:
        del payload["plan"]
    records = []
    with diagnostics.scope(records.append, "plan"):
        assert build.propose_plan_v1(diagnostic_model(json.dumps(payload)), {}, goal_text="PRIVATE") is None
    failures = [record for record in records if record["code"] == "response_schema_invalid"]
    expected: dict[str, object] = {"stage": "plan", "reason_code": reason, "path": path}
    if observed is not None:
        expected.update(observed_count=observed, limit_count=limit)
    assert [record["attempt"] for record in failures] == [1, 2]
    assert [record.get("validation_details") for record in failures] == [[expected], [expected]]
    assert "PRIVATE" not in json.dumps(records)


def test_plan_detail_projection_rejects_private_paths_and_invalid_counts() -> None:
    safe = diagnostics.project(
        {
            "code": "response_schema_invalid",
            "validation_details": [
                {
                    "stage": "plan",
                    "reason_code": "PRIVATE",
                    "path": ["PRIVATE", "input_summary", 5],
                    "observed_count": True,
                    "limit_count": -1,
                    "message": "PRIVATE",
                }
            ],
        }
    )
    assert safe.get("validation_details") == [
        {"stage": "plan", "reason_code": "unknown", "path": ["unknown", "input_summary", "*"]}
    ]
    assert "PRIVATE" not in json.dumps(safe)


@pytest.mark.parametrize("provider_failure", [False, True])
def test_planning_facts_survive_sql_cas_and_public_trace_export(
    repo: SqlDifyBuilderRepository,
    diagnostic_model: DiagnosticFactory,
    provider_failure: bool,
) -> None:
    from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse
    from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
    from core.dify_builder.models import Action, DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from core.plugin.impl.exc import PluginInvokeError
    from libs.helper import dump_response
    from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError
    from services.dify_builder.application.runner import Runner, StepResult
    from services.dify_builder.cognition_model_gateway import PolicyModelInstance
    from tests.unit_tests.core.dify_builder.test_runner import _actor
    from tests.unit_tests.core.plugin.impl.test_model_readiness import GATEWAY_MESSAGE

    model = diagnostic_model(
        "{}",
        failure=PluginInvokeError(
            description=json.dumps(
                {
                    "error_type": "PluginDaemonInnerError",
                    "message": GATEWAY_MESSAGE,
                }
            )
        )
        if provider_failure
        else None,
    )
    agent = LlmBuilderAgent("tenant")
    agent._model_instance = PolicyModelInstance(lambda: model)
    env, _ = _new_env()
    env.repo, env.agent = repo, agent
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])
    events = []
    env.emit_item = events.append

    def handler(_env: Env, _turn: Turn, current: Session, context: DifyBuilderContext) -> StepResult:
        if provider_failure:
            with pytest.raises(CognitionPolicyDeniedError):
                agent.propose_plan_v1({}, goal_text="PRIVATE")
        else:
            assert agent.propose_plan_v1({}, goal_text="PRIVATE") is None
        return StepResult(
            next=PcState.FIX_AWAIT_APPROVAL,
            context=context,
            items=[
                AssistantTurnItem(
                    turn_id="plan-trace",
                    stage_id=str(current.current_state),
                    execution=ExecutionProgress(status=ExecutionProgressStatus.COMPLETED),
                    reply_text="Review result",
                    reply_mode=AssistantReplyMode.COMPLETE,
                ).to_item(seq=0, at_version=2)
            ],
        )

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id,
        Turn(action=Action(kind="request_fix", base_version=1), actor=_actor()),
    )
    assistant = repo.list_conversation(session.id)[-1]
    stored = assistant.payload["diagnostics"]
    assert events[-1].item.payload["diagnostics"] == stored
    history = diagnostics.from_history([assistant], session_id=session.id, version=2)
    http = dump_response(
        DifyBuilderConversationPageResponse,
        {
            "data": [
                {
                    "seq": assistant.seq,
                    "kind": assistant.kind,
                    "payload": assistant.payload,
                    "at_version": assistant.at_version,
                }
            ],
            "has_more": False,
            "first_seq": assistant.seq,
            "last_seq": assistant.seq,
        },
    )
    exported = http["data"][0]["payload"]["diagnostics"]
    if provider_failure:
        assert history[0]["reason"] == exported[0]["reason"] == "service_unavailable"
        assert stored[0]["http_status"] == history[0]["http_status"] == exported[0]["http_status"] == 502
    else:
        expected = [{"stage": "plan", "reason_code": "missing", "path": ["plan"]}]
        assert history[0]["validation_details"] == exported[0]["validation_details"] == expected
    assert "PRIVATE" not in json.dumps(exported)
    assert "serverless" not in json.dumps(exported)
