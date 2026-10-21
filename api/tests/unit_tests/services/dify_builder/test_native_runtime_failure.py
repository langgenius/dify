from dataclasses import replace

import pytest
import pytest_mock
from pydantic import ValidationError

from core.dify_builder.models import NodeOutput, Run, RunVerification
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.verification import result_card


def summary() -> ExecutionEvidenceSummary:
    return ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="native_failed",
        sandbox_profile="native",
        native_run_id="native",
        failure_phase="execution",
        failure_reason="service_unavailable",
        failure_resource=("model", "langgenius/anthropic/anthropic", "claude-opus-4-8"),
        failure_node_ids=("llm",),
    )


def test_runtime_service_failure_card_retains_native_run_and_specific_node() -> None:
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    run = Run(
        status="failed",
        dify_run_id="native",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["start", "llm"],
            no_output_dead_branch=False,
            execution_evidence=summary(),
        ),
    )
    card = result_card(run)
    assert card.outcome == "execution_failed"
    assert card.failure_phase == "execution"
    assert card.failure_node_ids == ["llm"]
    assert card.dify_run_id == "native"
    assert "Plugin service" in english_text(card.failure_reason)
    assert "claude-opus-4-8" in english_text(card.failure_reason)


@pytest.mark.parametrize("variant", ["unsealed", "unknown", "no_native"])
def test_runtime_failure_cannot_claim_unknown_or_missing_native_evidence(variant: str) -> None:
    value = {
        "sealed": variant != "unsealed",
        "safety_outcome": "execution_evidence_unknown" if variant == "unknown" else "native_failed",
        "native_run_id": None if variant == "no_native" else "native",
    }
    with pytest.raises(ValidationError):
        ExecutionEvidenceSummary.model_validate(
            {
                "request_id": "request",
                "policy_version": "builder-confirmed-run-v1",
                "mode": "confirmed_run",
                "sandbox_profile": "native",
                "failure_phase": "execution",
                "failure_reason": "service_unavailable",
                "failure_node_ids": ["llm"],
                **value,
            }
        )


def test_runtime_attribution_uses_failed_native_resource_not_code_error_text() -> None:
    from services.dify_builder.native_runtime_failure import plugin_service_failure

    graph = {
        "nodes": [
            {
                "id": "llm",
                "data": {
                    "type": "llm",
                    "model": {"provider": "langgenius/anthropic/anthropic", "name": "claude-opus-4-8"},
                },
            }
        ]
    }
    run = Run(
        status="failed",
        dify_run_id="native",
        per_node=[NodeOutput(node_id="llm", status="failed", error="Request to Plugin Daemon Service failed-500")],
    )
    assert plugin_service_failure(run, graph) == (
        ("model", "langgenius/anthropic/anthropic", "claude-opus-4-8"),
        ("llm",),
    )
    assert plugin_service_failure(replace(run, status="running"), graph) is None
    assert plugin_service_failure(run, {"nodes": [{"id": "llm", "data": {"type": "code"}}]}) is None


@pytest.mark.parametrize("flow", ["build", "edit", "fix"])
def test_known_plugin_outage_does_not_ask_llm_to_rewrite_graph(flow: str, mocker: pytest_mock.MockerFixture) -> None:
    import importlib

    from core.dify_builder.models import Turn
    from core.dify_builder.state import PcState
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context

    helpers = importlib.import_module(f"tests.unit_tests.core.dify_builder.test_handlers_{flow}")
    env, repo = helpers._new_env()
    state = {
        "build": PcState.BUILD_TEST_AND_REPAIR,
        "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
        "fix": PcState.FIX_VERIFY,
    }[flow]
    session = helpers._session(current_state=state)
    context = saved_test_context(repo, session.id)
    raw = Run(
        status="failed",
        dify_run_id="native",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["llm"],
            no_output_dead_branch=False,
            execution_evidence=summary(),
        ),
    )
    mocker.patch.object(env.dify, "run_draft", return_value=raw)
    mocker.patch.object(env.agent, "diagnose", side_effect=AssertionError("infrastructure is not a graph bug"))
    mocker.patch.object(env.agent, "propose_repair", side_effect=AssertionError("infrastructure is not a graph bug"))
    handler = {
        "build": handlers_build.handle_test_and_repair,
        "edit": handlers_edit.handle_test_affected_paths,
        "fix": handlers_fix.handle_verify,
    }[flow]
    result = handler(env, Turn(actor=helpers._actor()), session, context)
    assert result.context is not None
    assert not result.context.staged_repair
    assert result.run is not None
    assert result.run.dify_run_id == "native"
    assert result.next not in {PcState.BUILD_REVIEW, PcState.EDIT_REVIEW}
    env.agent.diagnose.assert_not_called()
    env.agent.propose_repair.assert_not_called()
