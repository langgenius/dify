"""Safe diagnostics must survive the real cognition boundary without response data."""

import json
from types import SimpleNamespace

import pytest

from services.dify_builder import trace_diagnostics as diagnostics
from services.dify_builder.agent import build, llm
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from tests.unit_tests.core.dify_builder.test_runner import _new_env, _session
from tests.unit_tests.services.dify_builder.test_engine_on_sql_repo import engine, repo  # noqa: F401


def test_provider_failure_is_scoped_safe_and_recoverable(monkeypatch):
    class BrokenModel:
        def invoke_llm(self, **_kwargs):
            raise ConnectionRefusedError("secret-token https://host/?key=secret")

    monkeypatch.setattr(
        build, "planning_catalogue", lambda *_a, **_k: SimpleNamespace(tools=[], agents=[], agent_source_error=None)
    )
    agent = LlmBuilderAgent("tenant")
    agent._model_instance = BrokenModel()
    records = []
    agent.set_diagnostic_callback(records.append)
    assert agent.propose_plan_v1({}, goal_text="private prompt") is None
    provider = next(record for record in records if record["code"] == "provider_invocation_failed")
    assert provider["span_id"] == "propose-plan-v1"
    assert provider["exception_type"] == "ConnectionRefusedError"
    assert "secret" not in json.dumps(records)
    assert "private prompt" not in json.dumps(records)


def test_resolution_failure_and_callback_failure_do_not_crash(monkeypatch):
    agent = LlmBuilderAgent("tenant")
    monkeypatch.setattr(agent, "_model", lambda: (_ for _ in ()).throw(ValueError("secret")))
    records = []
    agent.set_diagnostic_callback(records.append)
    agent.analyze_goal("goal")
    assert any(r["code"] == "model_resolution_failed" for r in records)
    agent.set_diagnostic_callback(lambda _: (_ for _ in ()).throw(RuntimeError()))
    agent.analyze_goal("goal")


def test_json_and_schema_have_distinct_codes():
    records = []
    model = SimpleNamespace(
        invoke_llm=lambda **_: SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: "{}"))
    )
    with diagnostics.scope(records.append, "plan"):
        assert build.propose_plan_v1(model, {}) is None
    assert any(r["code"] == "response_schema_invalid" for r in records)
    records.clear()
    with diagnostics.scope(records.append, "json"):
        with pytest.raises(llm.LlmError):
            llm.invoke_json(
                SimpleNamespace(
                    invoke_llm=lambda **_: SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: "[]"))
                ),
                system="",
                user="",
            )
    assert any(r["code"] == "json_decode_failed" for r in records)


def test_env_bounds_resets_and_correlates_diagnostics():
    env, _ = _new_env()
    session = _session()
    env.begin_operation(session)
    for _ in range(100):
        env.record_diagnostic({"code": "provider_invocation_failed", "span_id": "plan", "message": "secret"})
    assert len(env.diagnostics) <= 33
    assert env.diagnostics[-1]["code"] == "diagnostics_truncated"
    assert env.diagnostics[0]["operation_id"] == env.operation_id
    assert env.diagnostics[0]["session_id"] == session.id
    assert "secret" not in json.dumps(env.diagnostics)
    env.begin_operation(session)
    assert env.diagnostics == []


def test_generation_projection_retains_attempt_not_arbitrary_strings():
    records = []
    with diagnostics.scope(records.append, "build-nodes"):
        diagnostics.generation(
            [{"attempt": 1, "message": "secret", "codes": ["UNRESOLVED_REFERENCE"], "errors": [{"detail": "secret"}]}]
        )
    assert records[0]["attempt"] == 1
    assert records[0]["code"] == "generation_validation_failed"
    assert "secret" not in json.dumps(records)


def test_wrapped_plugin_connection_refusal_is_classified_without_echo():
    records = []
    with diagnostics.scope(records.append, "plan"):
        diagnostics.report(
            "provider_invocation_failed", error=RuntimeError("connection refused http://internal?token=secret")
        )
    assert records[0]["reason"] == "connection_refused"
    assert "secret" not in json.dumps(records)


def test_cas_emission_and_reload_preserve_additive_safe_diagnostics(repo, monkeypatch):  # noqa: F811
    from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
    from core.dify_builder.models import Action, DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.runner import Runner, StepResult
    from tests.unit_tests.core.dify_builder.test_runner import _actor

    env, _ = _new_env()
    env.repo = repo
    agent = LlmBuilderAgent("tenant")
    agent._model_instance = SimpleNamespace(
        invoke_llm=lambda **_: (_ for _ in ()).throw(RuntimeError("connection refused http://internal?token=secret"))
    )
    env.agent = agent
    monkeypatch.setattr(
        build, "planning_catalogue", lambda *_a, **_k: SimpleNamespace(tools=[], agents=[], agent_source_error=None)
    )
    events = []
    env.emit_item = events.append
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])

    def handler(env, _turn, session, context):
        assert env.agent.propose_plan_v1({}, goal_text="private goal") is None
        item = AssistantTurnItem(
            turn_id="trace-turn",
            stage_id=str(session.current_state),
            execution=ExecutionProgress(status="completed"),
            reply_text="Review result",
            reply_mode="complete",
        ).to_item(seq=0, at_version=2)
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=context, items=[item])

    Runner(env, {PcState.FIX_DIAGNOSE: handler}).advance(
        session.id, Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    )
    assistant = repo.list_conversation(session.id)[-1]
    assert assistant.payload["diagnostics"][0]["reason"] == "connection_refused"
    assert assistant.payload["diagnostics"][0]["at_version"] == assistant.at_version
    assert events[-1].item.payload["diagnostics"] == assistant.payload["diagnostics"]


def test_catalogue_failure_differs_from_successful_empty():
    from services.dify_builder.agent.resources import _safe

    records = []
    with diagnostics.scope(records.append, "discover-resources"):
        assert _safe(lambda: [], "models", {}) == []
        assert records == []
        assert _safe(lambda: (_ for _ in ()).throw(RuntimeError("secret")), "models", {}) == []
    assert records[0]["code"] == "inventory_unavailable"


def test_context_scope_does_not_leak_between_nested_calls():
    outer, inner = [], []
    with diagnostics.scope(outer.append, "outer"):
        with diagnostics.scope(inner.append, "inner"):
            diagnostics.report("empty_response")
        diagnostics.report("empty_response")
    diagnostics.report("empty_response")
    assert [r["span_id"] for r in outer] == ["outer"]
    assert [r["span_id"] for r in inner] == ["inner"]


def test_resolved_model_identifiers_are_bounded_without_extra_config():
    agent = LlmBuilderAgent("tenant", {"provider": "langgenius/openai/openai", "name": "gpt-4", "api_key": "secret"})
    agent._model_instance = SimpleNamespace(
        provider="langgenius/openai/openai",
        model_name="gpt-4",
        invoke_llm=lambda **_: (_ for _ in ()).throw(ConnectionRefusedError()),
    )
    records = []
    agent.set_diagnostic_callback(records.append)
    agent.analyze_goal("goal")
    assert records[0]["provider"] == "langgenius/openai/openai"
    assert records[0]["model"] == "gpt-4"
    assert "secret" not in json.dumps(records)


def test_previous_operation_callback_cannot_contaminate_new_operation():
    env, _ = _new_env()
    agent = LlmBuilderAgent("tenant")
    env.agent = agent
    session = _session()
    env.begin_operation(session)
    old_callback = agent._diagnostic_callback
    env.begin_operation(session)
    old_callback({"code": "empty_response"})
    assert env.diagnostics == []


def test_edit_fix_and_mock_response_shapes_are_observed():
    from services.dify_builder.agent import edit, fix, mock_inputs

    model = SimpleNamespace(
        invoke_llm=lambda **_: SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: "{}"))
    )
    records = []
    with diagnostics.scope(records.append, "edit"):
        assert edit._invoke_intents(model, "", "", None) is None
    with diagnostics.scope(records.append, "fix"):
        assert fix._parse_repair({})[0] is None
    with diagnostics.scope(records.append, "mock"):
        assert mock_inputs.generate(model, {"variables": [{"variable": "name", "type": "text-input"}]}, {})
    assert {r["span_id"] for r in records if r["code"] == "response_schema_invalid"} == {"edit", "fix", "mock"}


def test_graph_generation_retry_evidence_survives_success(monkeypatch):
    from services.dify_builder.application.ports import BuildNodesResult

    agent = LlmBuilderAgent("tenant")
    records = []
    agent.set_diagnostic_callback(records.append)
    monkeypatch.setattr(
        build,
        "build_nodes",
        lambda *_args, **_kwargs: BuildNodesResult(
            intents=[], diagnostics=[{"attempt": 1, "codes": ["UNRESOLVED_REFERENCE", "secret"], "message": "secret"}]
        ),
    )
    assert agent.build_nodes(["step"]).error == ""
    assert records[0]["validation_codes"] == ["UNRESOLVED_REFERENCE"]
    assert records[0]["attempt"] == 1
    assert "secret" not in json.dumps(records)


def test_stream_iterator_failure_retains_scope():
    def stream():
        raise TimeoutError("secret")
        yield

    records = []
    with diagnostics.scope(records.append, "respond-to-message"):
        with pytest.raises(TimeoutError):
            list(llm.invoke_text_stream(SimpleNamespace(invoke_llm=lambda **_: stream()), system="", user=""))
    assert records[0]["reason"] == "timeout"
    assert records[0]["span_id"] == "respond-to-message"
    assert "secret" not in json.dumps(records)


def test_http_history_serializer_retains_safe_diagnostics():
    from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse
    from libs.helper import dump_response

    record = diagnostics.project({"code": "empty_response"})
    payload = {
        "turn_id": "turn",
        "stage_id": "build.plan",
        "execution": {"status": "completed"},
        "reply_text": "Review result",
        "reply_mode": "complete",
        "diagnostics": [record],
    }
    result = dump_response(
        DifyBuilderConversationPageResponse,
        {
            "data": [{"seq": 1, "kind": "assistant_turn", "payload": payload, "at_version": 2}],
            "has_more": False,
            "first_seq": 1,
            "last_seq": 1,
        },
    )
    assert result["data"][0]["payload"]["diagnostics"] == [record]


def test_http_session_snapshot_retains_safe_diagnostics():
    from dataclasses import asdict

    from controllers.console.dify_builder_fields import DifyBuilderSessionViewResponse
    from core.dify_builder.contract import RunStatus, SessionView
    from libs.helper import dump_response
    from services.dify_builder.wiring import _public_session_view

    record = diagnostics.project({"code": "empty_response"})
    view = SessionView(
        session_id="s",
        app_id="a",
        version=1,
        state="build.plan",
        canvas_read_only=False,
        run_status=RunStatus.WAITING_INPUT,
        interrupted=False,
        conversation_last_seq=1,
    )
    view.diagnostics = [record]
    result = dump_response(
        DifyBuilderSessionViewResponse, _public_session_view(asdict(view), include_last_command_id=True)
    )
    assert result["diagnostics"] == [record]


def test_language_detection_failure_is_scoped_and_keeps_existing_fallback():
    from services.dify_builder.agent.localize import LanguageDetector

    records = []
    model = SimpleNamespace(invoke_llm=lambda **_: (_ for _ in ()).throw(ConnectionRefusedError("secret")))
    with diagnostics.scope(records.append, "detect-language"):
        assert LanguageDetector(lambda: model).detect_language("请生成工作流") == "zh-Hans"
    assert any(r["code"] == "provider_invocation_failed" for r in records)
    assert any(r["code"] == "deterministic_fallback" for r in records)


def test_snapshot_history_preserves_identity_and_previous_failure_after_success():
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


def test_existing_sse_dto_keeps_diagnostic_payload():
    from controllers.console.dify_builder_fields import DifyBuilderConversationItemAppendedEventData
    from libs.helper import dump_response

    record = diagnostics.project({"code": "provider_invocation_failed"})
    result = dump_response(
        DifyBuilderConversationItemAppendedEventData,
        {
            "session_id": "session",
            "command_id": "command",
            "item": {
                "seq": 1,
                "kind": "assistant_turn",
                "at_version": 2,
                "payload": {
                    "turn_id": "turn",
                    "reply_mode": "complete",
                    "stage_id": "build.plan",
                    "execution": {"status": "completed"},
                    "diagnostics": [record],
                },
            },
        },
    )
    assert result["item"]["payload"]["diagnostics"] == [record]


def test_native_preparation_diagnostic_is_persisted_with_handler_reply():
    from core.dify_builder.models import Action, ConversationItem, DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.runner import Runner, StepResult
    from tests.unit_tests.core.dify_builder.test_runner import _actor

    env, memory_repo = _new_env()
    session = _session()
    memory_repo.create_session(session, DifyBuilderContext(), [])

    def handler(_env, _turn, _session, context):
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


def test_resource_binding_refusal_retains_safe_code_and_target_without_private_message():
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
