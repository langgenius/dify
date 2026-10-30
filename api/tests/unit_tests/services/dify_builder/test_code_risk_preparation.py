"""Prepared Code disclosure crosses the persisted session and saved-input boundary."""

import json
from copy import deepcopy

import pytest
import pytest_mock
from sqlalchemy import Table, select, update

from core.dify_builder.models import Actor, ChecklistError, DifyBuilderContext, EntryMode, NodeOutput, Run
from core.dify_builder.state import PcState
from models.dify_builder import DifyBuilderConversationItem, DifyBuilderSessionCommit, DifyBuilderTestInput
from services.dify_builder import code_risk_assessment, dify_port
from services.dify_builder import service as service_module
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.code_risk_assessment import assess_code, code_facts
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.serde import context_from_dict, context_to_dict
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.services.dify_builder.test_code_risk_assessment import graph
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase, _run
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as _full_run_harness
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

harness = _full_run_harness


def fix_context(h: FullRunCase, monkeypatch: pytest.MonkeyPatch, source: str) -> DifyBuilderContext:
    """Use the actual Fix setup and persisted context, without dispatching a worker."""
    for model in (DifyBuilderConversationItem, DifyBuilderSessionCommit):
        table = model.__table__
        assert isinstance(table, Table)
        table.create(h.factory.kw["bind"], checkfirst=True)
    model_config: dict[str, object] = {"provider": "openai", "name": "chosen", "mode": "chat", "completion_params": {}}
    monkeypatch.setattr(service_module, "validate_model_config", lambda _tenant, _config: model_config)
    repo = SqlDifyBuilderRepository(h.factory)
    service = DifyBuilderService(repo=repo, session_lock=FakeSessionLock(), enqueue_fn=lambda *_: None)
    actor = Actor(account_id=h.ids["account"], tenant_id=h.ids["tenant"])
    session_id, _ = service._prepare_fix_session(
        h.ids["app"],
        actor,
        failed_run_id="original-native-failure" if source != "checklist" else None,
        checklist_errors=[ChecklistError(node_id="code", node_type="code", messages=["Invalid Code"])]
        if source == "checklist"
        else None,
        model_config=model_config,
    )
    h.ids["session"] = session_id
    with h.factory.begin() as sql:
        saved = sql.get(DifyBuilderTestInput, h.ids["input"])
        assert saved is not None
        saved.session_id = session_id
    _, fc = repo.get_session(session_id)
    assert fc.goal_text == ""
    assert fc.model_config == model_config
    if source != "checklist":
        original = repo.get_run(fc.failed_run_id)
        assert (original.dify_run_id, original.status, original.immutable) == (
            "original-native-failure",
            "failed",
            True,
        )
    if source == "legacy_run":
        fc.source = ""
    return fc


@pytest.mark.parametrize("source", ["run", "checklist", "legacy_run"])
@pytest.mark.parametrize("classification", ["pure", "side_effect"])
def test_fix_preparation_assesses_without_business_goal_and_keeps_native_confirmation(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, source: str, classification: str
) -> None:
    fc = fix_context(harness, monkeypatch, source)
    harness.draft.graph = json.dumps(graph("return value" if classification == "pure" else "send(value)"))
    harness.finished.per_node = [NodeOutput(node_id="start"), NodeOutput(node_id="code")]
    calls: list[dict[str, object]] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        calls.append(facts)
        return {"classification": classification, "risk_notice": "Source behavior assessed for repair validation"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    port = WorkflowServiceDifyPort()
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    fc.code_risk_assessments = port.prepare_code_risks(
        harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"value": 1}, context=fc
    )
    assert fc.code_risk_assessments["code"]["status"] == "assessed"
    assert len(calls) == 1
    assert calls[0]["goal"]
    assert fc.goal_text == ""
    assert fc.business_acceptance_contract == {}
    disclosure = port.disclose_effects(harness.ids["app"], actor, inputs={"value": 1}, code_risk_context=fc)
    assert disclosure.mocked_node_ids({}) == (frozenset({"code"}) if classification == "side_effect" else frozenset())
    save_context(harness, fc)
    result = _run(harness, disclosure.confirmation(["code"]) if classification == "side_effect" else {}, {"value": 1})
    assert result.execution_refusal is None
    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset()
    assert harness.generate.call_args.kwargs["args"] == {"inputs": {"value": 1}}
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.simulated_node_ids == ()
    fc.code_risk_assessments = {}
    save_context(harness, fc)
    recovered = _run(harness, {}, {"value": 1})
    assert recovered.dify_run_id == result.dify_run_id == "native-1"
    assert harness.generate.call_count == 1
    assert len(calls) == 1
    if source != "checklist":
        original = SqlDifyBuilderRepository(harness.factory).get_run(fc.failed_run_id)
        assert (original.dify_run_id, original.status, original.immutable) == (
            "original-native-failure",
            "failed",
            True,
        )


@pytest.mark.parametrize("source", ["run", "checklist"])
@pytest.mark.parametrize("failure", ["missing_model", "model_unavailable", "invalid_assessment", "unknown"])
def test_fix_risk_failure_keeps_code_simulated(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, source: str, failure: str
) -> None:
    fc = fix_context(harness, monkeypatch, source)
    harness.draft.graph = json.dumps(graph())
    harness.finished.per_node = [NodeOutput(node_id="start"), NodeOutput(node_id="code")]
    calls: list[object] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        calls.append(facts)
        if failure == "model_unavailable":
            raise ValueError("Provider unavailable")
        return {
            "classification": "invalid" if failure == "invalid_assessment" else "unknown",
            "risk_notice": "Uncertain",
        }

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    if failure == "missing_model":
        fc.model_config = {}
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    port = WorkflowServiceDifyPort()
    fc.code_risk_assessments = port.prepare_code_risks(
        harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"value": 1}, context=fc
    )
    risk = fc.code_risk_assessments["code"]
    assert risk["classification"] == "unknown"
    assert risk["status"] == ("assessed" if failure == "unknown" else "unavailable")
    assert len(calls) == (0 if failure == "missing_model" else 1)
    save_context(harness, fc)
    result = _run(harness, {}, {"value": 1})
    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"code"})
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.simulated_node_ids == ("code",)


@pytest.mark.parametrize(
    ("source", "has_run", "has_checklist"),
    [
        ("", False, False),
        ("run", False, False),
        ("checklist", False, False),
        ("unrelated", True, True),
        ("run", False, True),
        ("checklist", True, False),
        ("", False, True),
    ],
)
def test_empty_nonfix_context_cannot_acquire_code_assessment(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, source: str, has_run: bool, has_checklist: bool
) -> None:
    harness.draft.graph = json.dumps(graph())
    fc = DifyBuilderContext(
        source=source,
        model_config={"name": "chosen"},
        failed_run_id="old-failed-run" if has_run else "",
        checklist_errors=[ChecklistError(node_id="code")] if has_checklist else [],
    )

    def unexpected_reason(**_: object) -> None:
        pytest.fail("No task context may reach the model")

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", unexpected_reason)
    risks = WorkflowServiceDifyPort().prepare_code_risks(
        harness.ids["app"],
        Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"]),
        session_id=harness.ids["session"],
        inputs={"value": 1},
        context=fc,
    )
    assert (risks["code"]["status"], risks["code"]["classification"]) == ("unavailable", "unknown")


@pytest.mark.parametrize(
    "raw_context",
    [
        {"source": [], "failed_run_id": "old-run"},
        {"source": {}, "failed_run_id": "old-run"},
        {"source": "run", "failed_run_id": {"id": "old-run"}},
        {"source": "run", "failed_run_id": ["old-run"]},
        {"source": "run", "failed_run_id": True},
        {"source": "run", "failed_run_id": "   "},
    ],
)
def test_malformed_persisted_fix_context_remains_unavailable(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, raw_context: dict[str, object]
) -> None:
    fc = context_from_dict({**raw_context, "model_config": {"name": "chosen"}})
    harness.draft.graph = json.dumps(graph())
    calls: list[object] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        calls.append(facts)
        return {"classification": "pure", "risk_notice": "Only parses input"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    risks = WorkflowServiceDifyPort().prepare_code_risks(
        harness.ids["app"],
        Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"]),
        session_id=harness.ids["session"],
        inputs={"value": 1},
        context=fc,
    )
    assert (risks["code"]["status"], risks["code"]["classification"]) == ("unavailable", "unknown")
    assert calls == []


@pytest.mark.parametrize("source", ["run", "checklist"])
@pytest.mark.parametrize("change", ["graph", "input", "task"])
def test_fix_risk_snapshot_cannot_authorize_changed_execution(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, source: str, change: str
) -> None:
    fc = fix_context(harness, monkeypatch, source)
    harness.draft.graph = json.dumps(graph())
    monkeypatch.setattr(
        code_risk_assessment,
        "builder_code_reasoner",
        lambda **_: lambda _: {"classification": "pure", "risk_notice": "Only parses the supplied value"},
    )
    fc.code_risk_assessments = WorkflowServiceDifyPort().prepare_code_risks(
        harness.ids["app"],
        Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"]),
        session_id=harness.ids["session"],
        inputs={"value": 1},
        context=fc,
    )
    assert fc.code_risk_assessments["code"]["status"] == "assessed"
    if change == "graph":
        harness.draft.graph = json.dumps(graph("send(value)"))
    elif change == "task":
        fc.goal_text = "Delete remote resources"
    save_context(harness, fc)
    result = _run(harness, {}, {"value": True} if change == "input" else {"value": 1})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "code_risk_assessment_stale"
    harness.generate.assert_not_called()


def context(h: FullRunCase, classification: str = "pure") -> DifyBuilderContext:
    source = {
        "pure": "return value",
        "read": "requests.get('https://service.example/items')",
        "side_effect": "requests.post('https://service.example/items', data=value)",
        "destructive": "requests.delete('https://service.example/items')",
    }[classification]
    h.draft.graph = json.dumps(graph(source))
    facts = code_facts(
        graph(source),
        inputs={"topic": "x"},
        goal_text="Parse the supplied value",
        model_config={"name": "chosen"},
        scope_binding=dify_port._code_scope_binding(h.draft),
    )["code"]
    risk = assess_code(facts, reason=lambda _: {"classification": classification, "risk_notice": "Bound source risk"})
    fc = DifyBuilderContext(goal_text="Parse the supplied value", model_config={"name": "chosen"})
    fc.code_risk_assessments = {"code": risk.model_dump()}
    return fc


def save_context(h: FullRunCase, fc: DifyBuilderContext) -> None:
    table = DifyBuilderSessionCommit.__table__
    assert isinstance(table, Table)
    table.create(h.factory.kw["bind"], checkfirst=True)
    with h.factory.begin() as db:
        row = db.scalar(
            select(DifyBuilderSessionCommit).where(
                DifyBuilderSessionCommit.session_id == h.ids["session"], DifyBuilderSessionCommit.version == 1
            )
        )
        if row:
            row.context = context_to_dict(fc)
        else:
            db.add(
                DifyBuilderSessionCommit(
                    session_id=h.ids["session"],
                    version=1,
                    state="build.test_and_repair",
                    context=context_to_dict(fc),
                    actor="",
                )
            )


@pytest.mark.parametrize(
    ("classification", "mocked"), [("pure", False), ("read", False), ("side_effect", True), ("destructive", True)]
)
def test_worker_uses_persisted_assessment_for_native_mock_choice(
    harness: FullRunCase, classification: str, mocked: bool
) -> None:
    fc = context(harness, classification)
    save_context(harness, fc)
    _run(harness, {})
    assert ("code" in harness.generate.call_args.kwargs["builder_mocked_node_ids"]) is mocked


def test_worker_refuses_missing_or_changed_snapshot_before_dispatch(harness: FullRunCase) -> None:
    fc = context(harness)
    save_context(harness, DifyBuilderContext())
    result = _run(harness, {})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "code_risk_assessment_stale"
    harness.generate.assert_not_called()
    save_context(harness, fc)
    harness.draft.graph = json.dumps(graph("send(value)"))
    result = _run(harness, {})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "code_risk_assessment_stale"
    harness.generate.assert_not_called()


def test_preparation_reuses_one_snapshot_and_does_not_hold_database_during_reasoning(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    fc = context(harness)
    fc.code_risk_assessments = {}
    calls: list[dict[str, object]] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        calls.append(deepcopy(facts))
        # Opening/committing another writer is possible: model I/O has no DB writer.
        with harness.factory.begin():
            pass
        return {"classification": "pure", "risk_notice": "Only parses supplied input"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    port = WorkflowServiceDifyPort()
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    first = port.prepare_code_risks(
        harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"topic": "x"}, context=fc
    )
    fc.code_risk_assessments = first
    assert (
        port.prepare_code_risks(
            harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"topic": "x"}, context=fc
        )
        == first
    )
    assert len(calls) == 1

    # A later conversation-language switch must not reuse the previous prose.
    fc.reply_language = "zh-Hans"
    translated = port.prepare_code_risks(
        harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"topic": "x"}, context=fc
    )
    assert len(calls) == 2
    assert calls[-1]["reply_language"] == "zh-Hans"
    assert translated["code"]["facts_digest"] != first["code"]["facts_digest"]


def test_changed_code_input_redisplays_before_accepting_checkbox_and_reuses_shown_snapshot(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import datetime

    from core.dify_builder.models import Session
    from services.dify_builder.application.handlers_fix import record_effect_confirmation, testdata_form
    from services.dify_builder.application.runner import Env
    from services.dify_builder.effect_disclosure import confirm_field_key
    from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository

    fc = context(harness, "side_effect")
    fc.code_risk_assessments = {}
    calls: list[dict[str, object]] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        calls.append(facts)
        return {"classification": "side_effect", "risk_notice": "Posts the payload to the source destination"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    session = Session(
        id=harness.ids["session"],
        app_id=harness.ids["app"],
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_AWAIT_TESTDATA,
    )
    env = Env(
        dify=WorkflowServiceDifyPort(), agent=PlaceholderAgent(), repo=InMemoryRepository(), now=lambda: datetime.min
    )
    form, _ = testdata_form(env, session, fc, actor, {}, {"value": True}, "Review")
    assert confirm_field_key("code") in [field.key for field in form.fields]
    testdata_form(env, session, fc, actor, {}, {"value": True}, "Review")
    assert len(calls) == 1
    _, stale = record_effect_confirmation(env, session, fc, actor, {"value": "true", confirm_field_key("code"): True})
    assert stale
    assert fc.effect_confirmation == {}
    testdata_form(env, session, fc, actor, {}, {"value": "true"}, "Review changed input")
    assert len(calls) == 2
    _, stale = record_effect_confirmation(env, session, fc, actor, {"value": "true", confirm_field_key("code"): True})
    assert not stale
    assert set(fc.effect_confirmation) == {"code"}


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_stale_worker_risk_returns_existing_input_interaction_without_repair(
    mocker: pytest_mock.MockerFixture, flow_index: int
) -> None:

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context
    from tests.unit_tests.core.dify_builder.test_effect_confirmation_gate import FLOWS, RUN_HANDLERS, _fixture

    flow = FLOWS[flow_index]
    module, port, repo, env, session, turn = _fixture(flow, disclosed=False)
    fc = saved_test_context(repo, session.id)
    port.run_draft = lambda *_, **__: dify_port._unsupported_run(
        BuilderExecutionPolicyError("code_risk_assessment_stale")
    )
    mocker.patch.object(
        env.agent, "diagnose", side_effect=AssertionError("Stale disclosure is not a failed Code execution")
    )
    result = RUN_HANDLERS[module](env, turn, session, fc)
    assert result.next == flow[5]
    assert any(item.kind == "form" for item in result.items)
    assert result.context is not None
    assert not result.context.test_input_ref


@pytest.mark.parametrize("change", ["source", "typed_input", "task"])
def test_worker_race_after_reservation_cannot_dispatch_stale_code(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    from models.dify_builder import DifyBuilderTestInput

    fc = context(harness)
    save_context(harness, fc)
    original = WorkflowServiceDifyPort._reserve_full_run

    def reserve(
        port: WorkflowServiceDifyPort,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
        mocked: frozenset[str],
    ) -> tuple[Run, bool]:
        result = original(port, session_id, test_input_id, before_revision, before_graph_revision, mocked)
        if change == "source":
            harness.draft.graph = json.dumps(graph("requests.post(value)"))
        elif change == "typed_input":
            with harness.factory.begin() as db:
                saved_input = db.get(DifyBuilderTestInput, harness.ids["input"])
                assert saved_input is not None
                saved_input.inputs = {"topic": True}
        else:
            fc.goal_text = "Delete remote resources"
            save_context(harness, fc)
        return result

    monkeypatch.setattr(WorkflowServiceDifyPort, "_reserve_full_run", reserve)
    result = _run(harness, {})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "code_risk_assessment_stale"
    harness.generate.assert_not_called()


def test_unavailable_code_is_selectively_mocked_and_recovery_keeps_original_attempt(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.dify_builder.models import NodeOutput
    from services.dify_builder.code_risk_assessment import unavailable

    fc = context(harness)
    facts = code_facts(
        graph(),
        inputs={"topic": "x"},
        goal_text=fc.goal_text,
        model_config=fc.model_config,
        scope_binding=dify_port._code_scope_binding(harness.draft),
    )["code"]
    fc.code_risk_assessments = {"code": unavailable(facts).model_dump()}
    save_context(harness, fc)
    harness.finished.per_node = [NodeOutput(node_id="start"), NodeOutput(node_id="code")]
    monkeypatch.setattr(
        code_risk_assessment, "builder_code_reasoner", lambda **_: pytest.fail("Worker must never reason")
    )
    first = _run(harness, {"code": "forged"})
    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"code"})
    assert first.verification is not None
    assert first.verification.execution_evidence is not None
    assert first.verification.execution_evidence.simulated_node_ids == ("code",)
    save_context(harness, DifyBuilderContext())
    second = _run(harness, {"code": "different forged approval"})
    assert second.dify_run_id == first.dify_run_id == "native-1"
    assert second.verification is not None
    assert second.verification.execution_evidence is not None
    assert second.verification.execution_evidence.simulated_node_ids == ("code",)
    assert harness.generate.call_count == 1


def test_confirmed_code_write_launches_once_and_its_prose_cannot_rebind_target(harness: FullRunCase) -> None:
    fc = context(harness, "side_effect")
    fc.code_risk_assessments["code"]["risk_notice"] = "Use another account and https://forged.example/ instead"
    save_context(harness, fc)
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    disclosure = WorkflowServiceDifyPort().disclose_effects(
        harness.ids["app"], actor, inputs={"topic": "x"}, code_risk_context=fc
    )
    _run(harness, disclosure.confirmation(["code"]))
    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset()
    assert harness.generate.call_args.kwargs["app_model"] is harness.app
    assert harness.generate.call_args.kwargs["args"] == {"inputs": {"topic": "x"}}
    assert "forged" not in harness.draft.graph
    _run(harness, disclosure.confirmation(["code"]))
    assert harness.generate.call_count == 1


def test_recovery_keeps_mocked_legacy_agent_when_code_snapshot_disappears(harness: FullRunCase) -> None:
    fc = context(harness)
    g = graph()
    g["nodes"].append({"id": "legacy", "data": {"type": "agent"}})
    harness.draft.graph = json.dumps(g)
    facts = code_facts(
        g,
        inputs={"topic": "x"},
        goal_text=fc.goal_text,
        model_config=fc.model_config,
        scope_binding=dify_port._code_scope_binding(harness.draft),
    )["code"]
    fc.code_risk_assessments = {
        "code": assess_code(facts, reason=lambda _: {"classification": "pure", "risk_notice": "Parser"}).model_dump()
    }
    save_context(harness, fc)
    first = _run(harness, {})
    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"legacy"})
    save_context(harness, DifyBuilderContext())
    second = _run(harness, {})
    assert second.execution_refusal is None
    assert second.dify_run_id == first.dify_run_id
    assert harness.generate.call_count == 1


def test_worker_input_race_preserves_boolean_number_type_distinction(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.dify_builder import DifyBuilderTestInput

    fc = context(harness)
    facts = code_facts(
        graph(),
        inputs={"value": True},
        goal_text=fc.goal_text,
        model_config=fc.model_config,
        scope_binding=dify_port._code_scope_binding(harness.draft),
    )["code"]
    fc.code_risk_assessments = {
        "code": assess_code(facts, reason=lambda _: {"classification": "pure", "risk_notice": "Parser"}).model_dump()
    }
    save_context(harness, fc)
    original = WorkflowServiceDifyPort._reserve_full_run

    def reserve(
        port: WorkflowServiceDifyPort,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
        mocked: frozenset[str],
    ) -> tuple[Run, bool]:
        result = original(port, session_id, test_input_id, before_revision, before_graph_revision, mocked)
        with harness.factory.begin() as db:
            db.execute(
                update(DifyBuilderTestInput)
                .where(DifyBuilderTestInput.id == harness.ids["input"])
                .values(inputs={"value": 1})
            )
        return result

    monkeypatch.setattr(WorkflowServiceDifyPort, "_reserve_full_run", reserve)
    result = _run(harness, {}, inputs={"value": True})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "code_risk_assessment_stale"
    harness.generate.assert_not_called()


def test_workflow_feature_scope_change_invalidates_shown_code_explanation(harness: FullRunCase) -> None:
    fc = context(harness)
    harness.draft.features = json.dumps({"file_upload": {"enabled": True}})
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    disclosure = WorkflowServiceDifyPort().disclose_effects(
        harness.ids["app"], actor, inputs={"topic": "x"}, code_risk_context=fc
    )
    code = next(item for item in disclosure.items if item.node_id == "code")
    assert code.assessment_digest == ""
    assert disclosure.mocked_node_ids({}) == frozenset({"code"})
