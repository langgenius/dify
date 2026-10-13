"""Pure publication policy and execution presentation; no native graph interpretation."""

from core.dify_builder.contract import TestResultCard
from core.dify_builder.models import PublicationDecision, Run
from services.dify_builder.execution_messages import FALLBACK, execution_refusal_message
from services.dify_builder.json_execution_presentation import json_execution_blocks_repair, json_failed_reason

REVIEW_NOTE = "Other paths and goal acceptance were not verified."
SUCCESS_REPLY = "Execution succeeded; output needs review."


def is_execution_policy_blocker(run: Run) -> bool:
    """Known policy denials and incomplete execution proof cannot enter repair."""
    if run.execution_refusal is not None:
        return True
    summary = run.verification.execution_evidence if run.verification else None
    if summary is None:
        return run.kind == "verify"
    return (
        bool(summary.blocked_node_ids)
        or not summary.sealed
        or json_execution_blocks_repair(summary, run.status)
        or summary.safety_outcome
        in {"unsupported_safe_execution", "execution_blocked", "execution_evidence_unknown", "simulation_completed"}
    )


def publication_decision(
    run: Run | None, *, session_id: str, current_revision: str, current_graph_revision: str
) -> PublicationDecision:
    if run is None or run.session_id != session_id or run.kind != "verify" or not run.immutable:
        return PublicationDecision(allowed=False, reason="no_verified_run")
    summary = run.verification.execution_evidence if run.verification else None
    if run.execution_refusal is not None or (summary and summary.blocked_node_ids):
        return PublicationDecision(allowed=False, reason="execution_policy_blocked")
    if summary is None or not summary.sealed or not summary.native_run_id or summary.native_run_id != run.dify_run_id:
        return PublicationDecision(allowed=False, reason="execution_provenance_unbound")
    if summary.safety_outcome in {"unsupported_safe_execution", "execution_blocked"}:
        return PublicationDecision(allowed=False, reason="execution_policy_blocked")
    if summary.safety_outcome == "execution_evidence_unknown":
        return PublicationDecision(allowed=False, reason="execution_evidence_unknown")
    if summary.safety_outcome == "simulation_completed":
        return PublicationDecision(allowed=False, reason="simulation_only")
    restricted_success = summary.safety_outcome == "restricted_execution_completed" and summary.mode == "restricted"
    # Confirmation is not publication approval: only the sealed exact-revision
    # confirmed success passes, and every check below still applies.
    confirmed_success = (
        summary.safety_outcome == "confirmed_tool_completed"
        and summary.mode == "confirmed_tool"
        and summary.policy_version == "builder-confirmed-gmail-read-v1"
        and summary.action_state == "completed"
        and summary.consent_id is not None
    )
    if not (restricted_success or confirmed_success):
        return PublicationDecision(allowed=False, reason="execution_failed")
    if run.status == "failed":
        return PublicationDecision(allowed=False, reason="execution_failed")
    if run.status != "succeeded":
        return PublicationDecision(allowed=False, reason="execution_unknown")
    evidence = run.verification
    if (
        evidence is None
        or not evidence.execution_revision
        or not evidence.executed_graph_revision
        or not current_revision
        or not current_graph_revision
    ):
        return PublicationDecision(allowed=False, reason="revision_unbound")
    if evidence.execution_revision != current_revision or evidence.executed_graph_revision != current_graph_revision:
        return PublicationDecision(allowed=False, reason="stale_revision")
    if any(f.state == "unresolved" for f in evidence.output_findings):
        return PublicationDecision(allowed=False, reason="required_output_unresolved")
    if evidence.no_output_dead_branch:
        return PublicationDecision(allowed=False, reason="dead_branch_without_output")
    return PublicationDecision(allowed=True, reason="eligible")


def has_output_blocker(run: Run) -> bool:
    evidence = run.verification
    return evidence is not None and (
        evidence.no_output_dead_branch or any(f.state == "unresolved" for f in evidence.output_findings)
    )


CONFIRMED_COMPLETED_NOTE = "The confirmed read completed; its content stays in the authorized workflow run."
CONFIRMED_FAILED_REASON = "The confirmed tool test failed. Prepare and confirm a new test to try again."
CONFIRMED_UNKNOWN_REASON = (
    "The confirmed tool test outcome is unknown; it is not retried automatically. "
    "Prepare and confirm a new test to try again."
)


def _confirmed_result_card(run: Run) -> TestResultCard:
    """IDs, statuses, counts, reason codes and the Run link only; never native content or error text."""
    evidence = run.verification
    summary = evidence.execution_evidence if evidence else None
    assert summary is not None
    completed = summary.safety_outcome == "confirmed_tool_completed" and run.status == "succeeded"
    card = TestResultCard(
        status="succeeded" if completed else "failed",
        dify_run_id=run.dify_run_id,
        review_note=CONFIRMED_COMPLETED_NOTE,
        terminal_outputs=None,
        executed_node_ids=list(evidence.executed_node_ids) if evidence else [],
        execution_mode=summary.mode,
        safety_outcome=summary.safety_outcome,
        policy_version=summary.policy_version,
        consent_id=summary.consent_id,
        action_state=summary.action_state,
        action_reason_code=summary.action_reason_code,
    )
    if completed and has_output_blocker(run):
        card.status = "failed"
        card.outcome = "required_output_unresolved"
        card.failure_reason = (
            "A required output reference was unresolved or the executed branch produced no terminal output."
        )
    elif completed:
        card.outcome = "execution_succeeded_needs_review"
    elif summary.safety_outcome == "native_failed":
        card.outcome = "execution_failed"
        card.failure_reason = CONFIRMED_FAILED_REASON
    else:
        card.outcome = "execution_unknown"
        card.failure_reason = CONFIRMED_UNKNOWN_REASON
    return card


def result_card(run: Run) -> TestResultCard:
    evidence = run.verification
    summary = evidence.execution_evidence if evidence else None
    if summary is not None and summary.mode == "confirmed_tool":
        return _confirmed_result_card(run)
    card = TestResultCard(
        status="succeeded" if run.status == "succeeded" else "failed",
        dify_run_id=run.dify_run_id,
        review_note=REVIEW_NOTE,
        terminal_outputs=evidence.terminal_outputs if evidence else None,
        executed_node_ids=evidence.executed_node_ids if evidence else [],
    )
    summary = evidence.execution_evidence if evidence else None
    if summary:
        card.execution_mode = summary.mode
        card.safety_outcome = summary.safety_outcome
        card.policy_version = summary.policy_version
        card.simulated_node_ids = list(summary.simulated_node_ids)
        card.blocked_node_ids = list(summary.blocked_node_ids)
    elif run.execution_refusal:
        card.safety_outcome = run.execution_refusal.safety_outcome
    else:
        card.safety_outcome = "execution_evidence_unknown"
    if is_execution_policy_blocker(run):
        failed_reason = json_failed_reason(summary, run.status)
        card.outcome = "execution_failed" if failed_reason else "execution_unknown"
        card.failure_reason = (
            execution_refusal_message(run.execution_refusal.reason_code)
            if run.execution_refusal
            else failed_reason or FALLBACK
        )
        if failed_reason:
            card.terminal_outputs = None
        if run.execution_refusal is not None:
            card.terminal_outputs = None
            if not run.dify_run_id:
                card.executed_node_ids = []
        return card
    if run.status == "succeeded" and has_output_blocker(run):
        card.status = "failed"
        card.outcome = "required_output_unresolved"
        card.failure_reason = (
            "A required output reference was unresolved or the executed branch produced no terminal output."
        )
    elif run.status == "succeeded":
        card.outcome = "execution_succeeded_needs_review"
        if evidence is None or not evidence.execution_revision:
            card.review_note = REVIEW_NOTE + " Draft verification is stale or unavailable; run again before publishing."
    elif run.status == "failed":
        card.outcome = "execution_failed"
        card.failure_reason = run.error or next((n.error for n in run.per_node if n.error), "Execution failed.")
    else:
        card.outcome = "execution_unknown"
        card.failure_reason = run.error or "Execution outcome is unknown; run again before publishing."
    return card
