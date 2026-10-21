"""Prepared Code disclosure crosses the persisted session and saved-input boundary."""

import json
from copy import deepcopy

import pytest
import pytest_mock
from sqlalchemy import Table, select, update

from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Run
from core.dify_builder.state import PcState
from models.dify_builder import DifyBuilderSessionCommit
from services.dify_builder import code_risk_assessment, dify_port
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.code_risk_assessment import assess_code, code_facts
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.serde import context_to_dict
from tests.unit_tests.services.dify_builder.test_code_risk_assessment import graph
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase, _run
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as _full_run_harness

harness = _full_run_harness


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
