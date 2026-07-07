"""Per-output failure decision logic for Workflow Agent Node v2.

Stage 4 §7. Pure orchestration: given a set of per-output failures plus their
configured ``DeclaredOutputFailureStrategy``, decide whether the workflow node
should retry the Agent backend run, take a fail branch, fall back to default
values, or fail outright.

The orchestrator is intentionally state-free. The caller (``agent_node._run``)
owns the retry attempt counter and is responsible for actually issuing the
re-run; this module only computes the decision.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from models.agent_config_entities import (
    DeclaredOutputConfig,
    DeclaredOutputFailureStrategy,
    OutputErrorStrategy,
)


class OutputFailureKind(StrEnum):
    """Why the per-output post-processing failed."""

    TYPE_CHECK = "type_check"
    OUTPUT_CHECK = "output_check"


class OutputFailureDecision(StrEnum):
    """What the runtime should do after collecting per-output failures."""

    # Re-invoke Agent backend (entire node re-runs). Used while retry budget
    # remains for at least one failed output.
    RETRY = "retry"
    # Replace each failed output's value with its declared default_value and
    # surface the run as successful.
    USE_DEFAULT = "use_default"
    # Mark the workflow node as failed; halt downstream propagation.
    FAIL_NODE = "fail_node"
    # Surface the node as exception → route through fail branch outbound edge.
    TAKE_FAIL_BRANCH = "take_fail_branch"


@dataclass(frozen=True, slots=True)
class FailedOutput:
    """One failed output that the orchestrator needs to reason about."""

    declared: DeclaredOutputConfig
    failure_kind: OutputFailureKind
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class OutputFailureOutcome:
    """Outcome of orchestrating one batch of failures.

    ``per_output_actions`` is non-empty only when ``decision == USE_DEFAULT``;
    it maps the failed output's ``name`` to the value that should be merged
    into the node's outputs in place of the failed value.
    """

    decision: OutputFailureDecision
    per_output_actions: Mapping[str, Any]
    next_attempt: int
    primary_reason: str
    failure_kinds: tuple[OutputFailureKind, ...]


# Stage 4 §7 — precedence used to merge differing per-output strategies into a
# single node-level decision when multiple outputs fail at once.
# Smaller integer = lower priority. FAIL_BRANCH wins overall.
_STRATEGY_TERMINAL_RANK: dict[OutputErrorStrategy, int] = {
    OutputErrorStrategy.DEFAULT_VALUE: 0,
    OutputErrorStrategy.STOP: 1,
    OutputErrorStrategy.FAIL_BRANCH: 2,
}


class OutputFailureOrchestrator:
    """Pure decision engine for per-output failure handling."""

    def decide(
        self,
        *,
        failures: list[FailedOutput],
        current_attempt: int,
    ) -> OutputFailureOutcome:
        """Compute the next action given a non-empty list of failures.

        ``current_attempt`` is zero-indexed: ``0`` means the failures come
        from the first backend run, ``1`` from the first retry, etc. The
        returned ``next_attempt`` is the value the caller should use for the
        next iteration when ``decision == RETRY``.
        """
        if not failures:
            raise ValueError("OutputFailureOrchestrator.decide() requires at least one failure")

        # Stage 4 §7: any output whose retry budget is not yet exhausted forces
        # a whole-node retry. The effective max-retries is the *maximum* across
        # all currently-failed outputs so retry continues until every output's
        # budget is spent (or it goes ready).
        retry_budget = max(
            (f.declared.failure_strategy.retry.max_retries if f.declared.failure_strategy.retry.enabled else 0)
            for f in failures
        )
        if current_attempt < retry_budget:
            return OutputFailureOutcome(
                decision=OutputFailureDecision.RETRY,
                per_output_actions={},
                next_attempt=current_attempt + 1,
                primary_reason=self._summarize(failures),
                failure_kinds=self._failure_kinds(failures),
            )

        # Retry budget exhausted: collapse each per-output terminal action into
        # a single node-level decision via the precedence table.
        merged = self._merge_terminal_decisions(failures)
        per_output_actions: dict[str, Any] = {}
        if merged == OutputFailureDecision.USE_DEFAULT:
            for failure in failures:
                strategy = failure.declared.failure_strategy
                if strategy.on_failure == OutputErrorStrategy.DEFAULT_VALUE:
                    per_output_actions[failure.declared.name] = strategy.default_value

        return OutputFailureOutcome(
            decision=merged,
            per_output_actions=per_output_actions,
            next_attempt=current_attempt,
            primary_reason=self._summarize(failures),
            failure_kinds=self._failure_kinds(failures),
        )

    @staticmethod
    def _merge_terminal_decisions(failures: list[FailedOutput]) -> OutputFailureDecision:
        # Pick the highest-precedence strategy across all failures.
        winning: OutputErrorStrategy = OutputErrorStrategy.DEFAULT_VALUE
        winning_rank = -1
        for failure in failures:
            strategy = failure.declared.failure_strategy.on_failure
            rank = _STRATEGY_TERMINAL_RANK[strategy]
            if rank > winning_rank:
                winning = strategy
                winning_rank = rank
        return _TERMINAL_STRATEGY_TO_DECISION[winning]

    @staticmethod
    def _summarize(failures: list[FailedOutput]) -> str:
        parts: list[str] = []
        for failure in failures:
            reason = failure.reason or "no reason recorded"
            parts.append(f"{failure.declared.name}[{failure.failure_kind.value}]: {reason}")
        return "; ".join(parts)

    @staticmethod
    def _failure_kinds(failures: list[FailedOutput]) -> tuple[OutputFailureKind, ...]:
        seen: list[OutputFailureKind] = []
        for failure in failures:
            if failure.failure_kind not in seen:
                seen.append(failure.failure_kind)
        return tuple(seen)


_TERMINAL_STRATEGY_TO_DECISION: dict[OutputErrorStrategy, OutputFailureDecision] = {
    OutputErrorStrategy.STOP: OutputFailureDecision.FAIL_NODE,
    OutputErrorStrategy.DEFAULT_VALUE: OutputFailureDecision.USE_DEFAULT,
    OutputErrorStrategy.FAIL_BRANCH: OutputFailureDecision.TAKE_FAIL_BRANCH,
}


def retry_idempotency_key(
    *,
    workflow_run_id: str | None,
    node_execution_id: str,
    attempt: int,
) -> str:
    """Compute the Agent backend ``idempotency_key`` for a given attempt.

    Stage 4 §7 / decision D-4: each retry must use a distinct key so the
    backend's protocol-level dedup doesn't return the previous run's id.
    First attempt (attempt=0) matches the pre-stage-4 key shape so logs stay
    backward compatible.
    """
    base = f"{workflow_run_id}:{node_execution_id}" if workflow_run_id else node_execution_id
    if attempt <= 0:
        return base
    return f"{base}:retry-{attempt}"


def build_failure_strategy_for(declared: DeclaredOutputConfig) -> DeclaredOutputFailureStrategy:
    """Convenience accessor that always returns a populated strategy.

    Existing callers that read ``output.failure_strategy`` already get a
    populated default thanks to the BaseModel default_factory, but this helper
    documents the contract and gives the orchestrator's tests a single hook.
    """
    return declared.failure_strategy
