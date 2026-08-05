"""Unit tests for OutputFailureOrchestrator decision logic.

Stage 4 §7.
"""

from __future__ import annotations

import pytest

from core.workflow.nodes.agent_v2.output_failure_orchestrator import (
    FailedOutput,
    OutputFailureDecision,
    OutputFailureKind,
    OutputFailureOrchestrator,
    retry_idempotency_key,
)
from models.agent_config_entities import (
    DeclaredOutputConfig,
    DeclaredOutputFailureStrategy,
    DeclaredOutputRetryConfig,
    DeclaredOutputType,
    OutputErrorStrategy,
)


def _output(
    name: str,
    *,
    on_failure: OutputErrorStrategy = OutputErrorStrategy.STOP,
    max_retries: int = 0,
    retry_enabled: bool = False,
    default_value=None,
) -> DeclaredOutputConfig:
    strategy = DeclaredOutputFailureStrategy(
        retry=DeclaredOutputRetryConfig(enabled=retry_enabled, max_retries=max_retries),
        on_failure=on_failure,
        default_value=default_value,
    )
    return DeclaredOutputConfig(name=name, type=DeclaredOutputType.STRING, failure_strategy=strategy)


def _failure(declared: DeclaredOutputConfig, kind: OutputFailureKind = OutputFailureKind.TYPE_CHECK) -> FailedOutput:
    return FailedOutput(declared=declared, failure_kind=kind, reason="boom")


# ──────────────────────────────────────────────────────────────────────────────
# Retry budget
# ──────────────────────────────────────────────────────────────────────────────


def test_retry_within_budget_returns_retry_and_increments_attempt():
    orch = OutputFailureOrchestrator()
    declared = _output("x", retry_enabled=True, max_retries=2)

    outcome = orch.decide(failures=[_failure(declared)], current_attempt=0)

    assert outcome.decision == OutputFailureDecision.RETRY
    assert outcome.next_attempt == 1


def test_retry_budget_uses_max_across_multiple_outputs():
    """If two outputs fail and their retry budgets differ, retry continues
    until the *larger* budget is spent (§7)."""
    orch = OutputFailureOrchestrator()
    out_a = _output("a", retry_enabled=True, max_retries=1)
    out_b = _output("b", retry_enabled=True, max_retries=3)

    # attempt=1: a's budget already spent, but b still has budget → still retry
    outcome = orch.decide(failures=[_failure(out_a), _failure(out_b)], current_attempt=1)
    assert outcome.decision == OutputFailureDecision.RETRY
    assert outcome.next_attempt == 2


def test_retry_disabled_skips_retry_even_with_max_retries_set():
    orch = OutputFailureOrchestrator()
    declared = _output("x", retry_enabled=False, max_retries=5)  # disabled wins

    outcome = orch.decide(failures=[_failure(declared)], current_attempt=0)

    assert outcome.decision != OutputFailureDecision.RETRY


def test_retry_budget_exhausted_falls_to_terminal():
    orch = OutputFailureOrchestrator()
    declared = _output(
        "x", retry_enabled=True, max_retries=1, on_failure=OutputErrorStrategy.DEFAULT_VALUE, default_value="fallback"
    )

    outcome = orch.decide(failures=[_failure(declared)], current_attempt=1)  # already at max

    assert outcome.decision == OutputFailureDecision.USE_DEFAULT
    assert outcome.per_output_actions == {"x": "fallback"}


# ──────────────────────────────────────────────────────────────────────────────
# Terminal decisions
# ──────────────────────────────────────────────────────────────────────────────


def test_stop_terminal_returns_fail_node():
    orch = OutputFailureOrchestrator()
    declared = _output("x", on_failure=OutputErrorStrategy.STOP)

    outcome = orch.decide(failures=[_failure(declared)], current_attempt=0)

    assert outcome.decision == OutputFailureDecision.FAIL_NODE
    assert outcome.per_output_actions == {}


def test_default_value_terminal_collects_per_output_defaults():
    orch = OutputFailureOrchestrator()
    out_a = _output("a", on_failure=OutputErrorStrategy.DEFAULT_VALUE, default_value="A")
    out_b = _output("b", on_failure=OutputErrorStrategy.DEFAULT_VALUE, default_value="B")

    outcome = orch.decide(failures=[_failure(out_a), _failure(out_b)], current_attempt=0)

    assert outcome.decision == OutputFailureDecision.USE_DEFAULT
    assert outcome.per_output_actions == {"a": "A", "b": "B"}


def test_fail_branch_terminal_returns_take_fail_branch():
    orch = OutputFailureOrchestrator()
    declared = _output("x", on_failure=OutputErrorStrategy.FAIL_BRANCH)

    outcome = orch.decide(failures=[_failure(declared)], current_attempt=0)

    assert outcome.decision == OutputFailureDecision.TAKE_FAIL_BRANCH


# ──────────────────────────────────────────────────────────────────────────────
# Multi-output precedence: FAIL_BRANCH > FAIL_NODE > USE_DEFAULT
# ──────────────────────────────────────────────────────────────────────────────


def test_fail_branch_wins_over_stop_and_default_value():
    orch = OutputFailureOrchestrator()
    out_a = _output("a", on_failure=OutputErrorStrategy.DEFAULT_VALUE, default_value="x")
    out_b = _output("b", on_failure=OutputErrorStrategy.STOP)
    out_c = _output("c", on_failure=OutputErrorStrategy.FAIL_BRANCH)

    outcome = orch.decide(
        failures=[_failure(out_a), _failure(out_b), _failure(out_c)],
        current_attempt=0,
    )

    assert outcome.decision == OutputFailureDecision.TAKE_FAIL_BRANCH
    # USE_DEFAULT was overridden → no per-output actions surfaced.
    assert outcome.per_output_actions == {}


def test_stop_wins_over_default_value_when_no_fail_branch():
    orch = OutputFailureOrchestrator()
    out_a = _output("a", on_failure=OutputErrorStrategy.DEFAULT_VALUE, default_value="x")
    out_b = _output("b", on_failure=OutputErrorStrategy.STOP)

    outcome = orch.decide(failures=[_failure(out_a), _failure(out_b)], current_attempt=0)

    assert outcome.decision == OutputFailureDecision.FAIL_NODE


# ──────────────────────────────────────────────────────────────────────────────
# Output check vs type check failure kinds
# ──────────────────────────────────────────────────────────────────────────────


def test_failure_kinds_dedupes_and_preserves_order():
    orch = OutputFailureOrchestrator()
    decl = _output("x")
    failures = [
        FailedOutput(declared=decl, failure_kind=OutputFailureKind.TYPE_CHECK, reason="r1"),
        FailedOutput(declared=decl, failure_kind=OutputFailureKind.OUTPUT_CHECK, reason="r2"),
        FailedOutput(declared=decl, failure_kind=OutputFailureKind.TYPE_CHECK, reason="r3"),
    ]

    outcome = orch.decide(failures=failures, current_attempt=0)

    assert outcome.failure_kinds == (OutputFailureKind.TYPE_CHECK, OutputFailureKind.OUTPUT_CHECK)


# ──────────────────────────────────────────────────────────────────────────────
# Reason summarization
# ──────────────────────────────────────────────────────────────────────────────


def test_primary_reason_includes_every_failure():
    orch = OutputFailureOrchestrator()
    out_a = _output("a")
    out_b = _output("b")

    outcome = orch.decide(
        failures=[
            FailedOutput(declared=out_a, failure_kind=OutputFailureKind.TYPE_CHECK, reason="expected str"),
            FailedOutput(declared=out_b, failure_kind=OutputFailureKind.OUTPUT_CHECK, reason="missing section 3"),
        ],
        current_attempt=0,
    )

    assert "a[type_check]: expected str" in outcome.primary_reason
    assert "b[output_check]: missing section 3" in outcome.primary_reason


def test_no_failures_raises():
    orch = OutputFailureOrchestrator()
    with pytest.raises(ValueError, match="at least one failure"):
        orch.decide(failures=[], current_attempt=0)


# ──────────────────────────────────────────────────────────────────────────────
# Idempotency key helper (decision D-4)
# ──────────────────────────────────────────────────────────────────────────────


def test_idempotency_key_first_attempt_matches_pre_stage_4_shape():
    key = retry_idempotency_key(workflow_run_id="run-1", node_execution_id="node-exec-1", attempt=0)
    assert key == "run-1:node-exec-1"


def test_idempotency_key_appends_retry_attempt_for_retries():
    assert (
        retry_idempotency_key(workflow_run_id="run-1", node_execution_id="node-exec-1", attempt=2)
        == "run-1:node-exec-1:retry-2"
    )


def test_idempotency_key_handles_missing_workflow_run_id():
    assert retry_idempotency_key(workflow_run_id=None, node_execution_id="node-exec-9", attempt=0) == "node-exec-9"
    assert (
        retry_idempotency_key(workflow_run_id=None, node_execution_id="node-exec-9", attempt=1) == "node-exec-9:retry-1"
    )
