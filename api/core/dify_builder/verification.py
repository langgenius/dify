"""Pure publication policy and execution presentation; no native graph interpretation."""

from core.dify_builder.contract import TestResultCard
from core.dify_builder.models import PublicationDecision, Run

REVIEW_NOTE = "Other paths and goal acceptance were not verified."
SUCCESS_REPLY = "Execution succeeded; output needs review."


def publication_decision(
    run: Run | None, *, session_id: str, current_revision: str, current_graph_revision: str
) -> PublicationDecision:
    if run is None or run.session_id != session_id or run.kind != "verify" or not run.immutable:
        return PublicationDecision(allowed=False, reason="no_verified_run")
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


def result_card(run: Run) -> TestResultCard:
    evidence = run.verification
    card = TestResultCard(
        status="succeeded" if run.status == "succeeded" else "failed",
        dify_run_id=run.dify_run_id,
        review_note=REVIEW_NOTE,
        terminal_outputs=evidence.terminal_outputs if evidence else None,
        executed_node_ids=evidence.executed_node_ids if evidence else [],
    )
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
