"""Policy refusals explain safe Template edits without leaking native content.

The catalog contract is exercised by actual Localizer output; the only double
is its external translation boundary. Refusal routing must never propose repair.
"""

import json
from dataclasses import asdict
from typing import Never

import pytest

from core.dify_builder.execution_policy import BuilderExecutionRefusal
from core.dify_builder.models import (
    Diagnosis,
    DifyBuilderContext,
    MutationIntent,
    Run,
    RunVerification,
    TestInput,
    Turn,
)
from core.dify_builder.state import PcState
from core.dify_builder.verification import is_execution_policy_blocker, publication_decision, result_card
from services.dify_builder.presentation import BuilderCopy
from tests.unit_tests.core.dify_builder.test_handlers_build import _actor, _new_env, _session
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


def refused_run(reason: str) -> Run:
    return Run(
        id="refused",
        session_id="s",
        kind="verify",
        immutable=True,
        status="failed",
        dify_run_id="",
        execution_refusal=BuilderExecutionRefusal(reason_code=reason),
        error="SECRET-EXCEPTION: {{ SECRET-TEMPLATE }} SECRET-INPUT",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs={"notification_markdown": "SECRET-OUTPUT"},
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
        ),
    )


@pytest.mark.parametrize(
    ("reason", "scope_terms"),
    [
        pytest.param("unsupported_node_implementation", ("node", "support"), id="implementation"),
        pytest.param("unsupported_template_syntax", ("template", "if", "trim"), id="syntax"),
        pytest.param("unsupported_template_configuration", ("template", "variable"), id="configuration"),
        pytest.param("unsupported_template_selector", ("template", "input"), id="selector"),
        pytest.param("template_execution_limit", ("template", "size"), id="limit"),
    ],
)
def test_known_template_refusal_has_actionable_scene_without_native_content(
    reason: str, scope_terms: tuple[str, ...]
) -> None:
    run = refused_run(reason)
    card = result_card(run)
    assert card.failure_reason is not None
    message = english_text(card.failure_reason).lower()
    assert all(term in message for term in scope_terms)
    assert any(action in message for action in ("edit", "reduce", "use", "change"))
    assert any(phrase in message for phrase in ("not run", "did not run", "not executed"))
    assert card.safety_outcome == "unsupported_safe_execution"
    assert card.dify_run_id == ""
    assert card.executed_node_ids == []
    assert card.terminal_outputs is None
    assert "SECRET-" not in json.dumps(asdict(card))

    assert isinstance(card.failure_reason, BuilderCopy)
    assert asdict(card.failure_reason)["type"] == "copy"
    assert asdict(card.failure_reason)["params"] == {}


def test_unknown_policy_reason_uses_fixed_sanitized_fallback() -> None:
    first = result_card(refused_run("unknown_secret_template_reason"))
    second = result_card(refused_run("another_unknown_reason"))
    assert first.failure_reason == second.failure_reason
    assert first.failure_reason
    assert "unknown_secret_template_reason" not in json.dumps(asdict(first))
    assert "SECRET-" not in json.dumps(asdict(first))
    assert first.terminal_outputs is None


def test_generic_missing_coverage_keeps_workflow_editable() -> None:
    card = result_card(refused_run("unsupported_node_implementation"))
    assert english_text(card.failure_reason) == (
        "Builder does not yet have safe-test support for a node in this workflow. "
        "The draft can still be edited; this test did not run. Automatic repair and publication are blocked."
    )
    assert "use supported nodes" not in english_text(card.failure_reason)


@pytest.mark.parametrize(
    ("reason", "expected_phrase"),
    [
        ("unsupported_json_tool_configuration", "qualified JSON Parse setup"),
        ("unsupported_json_credentials", "qualified JSON Parse setup"),
        ("unsupported_json_content_constant", "Start string input"),
        ("unsupported_json_filter", "JSONPath"),
        ("unsupported_json_selector", "Start string input"),
        ("invalid_json_parameters", "Ensure ASCII"),
        ("json_execution_limit", "safe testing limits"),
        ("installed_json_tool_unavailable", "Install the qualified JSON Process version"),
        ("unsupported_json_tool_installation", "Install the qualified JSON Process version"),
        ("json_tool_installation_changed", "installed JSON Process version changed"),
    ],
)
def test_json_coverage_refusal_uses_only_static_actionable_copy(reason: str, expected_phrase: str) -> None:
    card = result_card(refused_run(reason))
    assert card.failure_reason is not None
    assert expected_phrase in english_text(card.failure_reason)
    assert "did not run" in english_text(card.failure_reason)
    assert "Automatic repair and publication are blocked" in english_text(card.failure_reason)
    assert "SECRET-" not in json.dumps(asdict(card))
    assert card.terminal_outputs is None


def test_template_refusal_clears_staged_repairs_and_cannot_publish() -> None:
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    run = refused_run("unsupported_template_syntax")
    dify = FakeBuildDifyPort()
    dify.run_draft = lambda *_args, **_kwargs: run
    agent = StubAgent()

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        pytest.fail("policy refusal entered automatic diagnosis or repair")

    agent.diagnose = forbidden
    agent.propose_repair = forbidden
    env, repo = _new_env(dify=dify, agent=agent)
    session = _session(current_state=PcState.BUILD_TEST_AND_REPAIR)
    repo.save_test_input(TestInput(id="ti", session_id=session.id, source="user", inputs={"body": "SECRET-INPUT"}))
    context = DifyBuilderContext(
        test_input_ref="ti",
        diagnosis=Diagnosis(root_cause="old"),
        staged_repair=[
            MutationIntent(op="set_node_config", args={"node_id": "template", "path": "template", "value": "x"})
        ],
    )
    result = handle_test_and_repair(env, Turn(actor=_actor()), session, context)
    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context is not None
    assert result.context.diagnosis is None
    assert result.context.staged_repair == []
    assert dify.applied == []
    assert dify.published is False
    assert is_execution_policy_blocker(run)
    assert (
        publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").allowed
        is False
    )
    presentation = [item.payload for item in result.items if item.kind in {"test_result", "assistant_turn"}]
    assert "SECRET-" not in json.dumps(presentation)
