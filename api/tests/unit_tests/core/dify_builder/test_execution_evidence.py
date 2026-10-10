"""Typed evidence governs result and publication without rewriting native status."""

import pytest

from core.dify_builder import verification
from core.dify_builder.execution_policy import ExecutionEvidenceSummary
from core.dify_builder.models import Run, RunVerification


def sample(outcome, blocked=()):
    run = Run(
        status="succeeded",
        session_id="s",
        kind="verify",
        immutable=True,
        dify_run_id="native",
        verification=RunVerification(
            execution_revision="r",
            executed_graph_revision="g",
            terminal_outputs={},
            executed_node_ids=["start", "end"],
            output_findings=[],
            no_output_dead_branch=False,
        ),
    )
    if outcome:
        assert run.verification is not None
        run.verification.execution_evidence = ExecutionEvidenceSummary(
            request_id="q",
            mode="restricted",
            sealed=True,
            safety_outcome=outcome,
            blocked_node_ids=blocked,
            sandbox_profile="disabled",
            fixture_digest="a" * 64,
            native_run_id="native",
        )
    return run


@pytest.mark.parametrize(
    ("outcome", "reason"),
    [
        (None, "execution_provenance_unbound"),
        ("execution_evidence_unknown", "execution_evidence_unknown"),
        ("simulation_completed", "simulation_only"),
        ("execution_blocked", "execution_policy_blocked"),
        ("restricted_execution_completed", "eligible"),
    ],
)
def test_publication_requires_bound_sealed_restricted_evidence(outcome, reason):
    decision = verification.publication_decision(
        sample(outcome), session_id="s", current_revision="r", current_graph_revision="g"
    )
    assert decision.reason == reason
    assert decision.allowed == (reason == "eligible")


@pytest.mark.parametrize("outcome", ["native_failed", "execution_evidence_unknown", "execution_blocked"])
def test_denial_ids_block_even_when_native_failed_or_proof_incomplete(outcome):
    run = sample(outcome, ("http",))
    assert verification.is_execution_policy_blocker(run)
    card = verification.result_card(run)
    assert card.safety_outcome == outcome
    assert card.blocked_node_ids == ["http"]
    assert run.status == "succeeded"


@pytest.mark.parametrize("flow", ["build", "edit", "fix"])
@pytest.mark.parametrize(
    "outcome", ["execution_blocked", "native_failed", "execution_evidence_unknown", "simulation_completed"]
)
def test_handlers_keep_denials_out_of_review_and_repair(flow, outcome):
    import importlib
    from unittest.mock import Mock

    from core.dify_builder.models import Turn
    from core.dify_builder.state import PcState
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context

    helpers = importlib.import_module(f"tests.unit_tests.core.dify_builder.test_handlers_{flow}")
    handlers = importlib.import_module(f"core.dify_builder.handlers_{flow}")
    env, repo = helpers._new_env()
    state = {
        "build": PcState.BUILD_TEST_AND_REPAIR,
        "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
        "fix": PcState.FIX_VERIFY,
    }[flow]
    session = helpers._session(current_state=state)
    context = saved_test_context(repo, session.id)
    raw = sample(outcome, () if outcome == "simulation_completed" else ("http",))
    if outcome == "native_failed":
        raw.status = "failed"
    env.dify.run_draft = lambda *_a, **_kw: raw
    env.agent.diagnose = Mock(side_effect=AssertionError("policy is not a business bug"))
    env.agent.propose_repair = Mock(side_effect=AssertionError("policy is not a business bug"))
    handler = getattr(
        handlers,
        {"build": "handle_test_and_repair", "edit": "handle_test_affected_paths", "fix": "handle_verify"}[flow],
    )
    result = handler(env, Turn(actor=helpers._actor()), session, context)
    assert result.next not in {PcState.BUILD_REVIEW, PcState.EDIT_REVIEW}
    assert not result.context.staged_repair
    assert result.run.verification is not None
    assert result.run.verification.execution_evidence is not None
    assert raw.verification is not None
    assert raw.verification.execution_evidence is not None
    assert result.run.verification.execution_evidence == raw.verification.execution_evidence
    env.agent.diagnose.assert_not_called()
    env.agent.propose_repair.assert_not_called()


def test_fix_diagnose_does_not_diagnose_persisted_policy_denial():
    from unittest.mock import Mock

    from core.dify_builder.handlers_fix import handle_diagnose
    from core.dify_builder.models import DifyBuilderContext, Turn
    from core.dify_builder.state import PcState
    from tests.unit_tests.core.dify_builder.test_handlers_fix import _actor, _new_env, _session

    env, repo = _new_env()
    session = _session()
    run = sample("native_failed", ("http",))
    run.id = "denied"
    run.status = "failed"
    repo.save_run(session.id, run)
    env.agent.diagnose = Mock(side_effect=AssertionError("must not diagnose policy"))
    result = handle_diagnose(env, Turn(actor=_actor()), session, DifyBuilderContext(failed_run_id="denied"))
    assert result.next == PcState.FIX_AWAIT_DECISION
    env.agent.diagnose.assert_not_called()


@pytest.mark.parametrize("flow", ["build", "edit", "fix"])
def test_generic_verification_exception_never_enters_diagnosis(flow):
    import importlib
    from unittest.mock import Mock

    from core.dify_builder.models import Turn
    from core.dify_builder.state import PcState
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context

    helpers = importlib.import_module(f"tests.unit_tests.core.dify_builder.test_handlers_{flow}")
    handlers = importlib.import_module(f"core.dify_builder.handlers_{flow}")
    env, repo = helpers._new_env()
    session = helpers._session(
        current_state={
            "build": PcState.BUILD_TEST_AND_REPAIR,
            "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
            "fix": PcState.FIX_VERIFY,
        }[flow]
    )
    env.dify.run_draft = Mock(side_effect=RuntimeError("setup failed"))
    env.agent.diagnose = Mock(side_effect=AssertionError("missing proof"))
    env.agent.propose_repair = Mock(side_effect=AssertionError("missing proof"))
    handler = getattr(
        handlers,
        {"build": "handle_test_and_repair", "edit": "handle_test_affected_paths", "fix": "handle_verify"}[flow],
    )
    result = handler(env, Turn(actor=helpers._actor()), session, saved_test_context(repo, session.id))
    assert verification.is_execution_policy_blocker(result.run)
    env.agent.diagnose.assert_not_called()
    env.agent.propose_repair.assert_not_called()


def test_historical_original_failure_remains_diagnosable():
    run = sample(None)
    run.kind = "original-failed"
    run.status = "failed"
    assert not verification.is_execution_policy_blocker(run)
