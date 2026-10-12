from dataclasses import replace
from typing import Literal

import pytest

from core.dify_builder import models
from core.dify_builder.execution_policy import ExecutionEvidenceSummary


def verified(**changes):
    run = models.Run(
        id="r",
        dify_run_id="native",
        session_id="s",
        kind="verify",
        immutable=True,
        status="succeeded",
        verification=models.RunVerification(
            execution_evidence=ExecutionEvidenceSummary(
                request_id="request",
                mode="restricted",
                sealed=True,
                safety_outcome="restricted_execution_completed",
                sandbox_profile="disabled",
                fixture_digest="a" * 64,
                native_run_id="native",
            ),
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs={"result": None},
            output_findings=[],
            executed_node_ids=["end"],
            no_output_dead_branch=False,
        ),
    )
    return replace(run, **changes)


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"session_id": "foreign"}, "no_verified_run"),
        ({"kind": "original-failed"}, "no_verified_run"),
        ({"immutable": False}, "no_verified_run"),
        ({"status": "failed"}, "execution_failed"),
        ({"status": "running"}, "execution_unknown"),
        ({"verification": None}, "execution_provenance_unbound"),
    ],
)
def test_verification_policy_denies(change, reason):
    from core.dify_builder.verification import publication_decision

    assert (
        publication_decision(
            verified(**change), session_id="s", current_revision="rev", current_graph_revision="graph"
        ).reason
        == reason
    )


@pytest.mark.parametrize(
    ("field", "value", "reason"),
    [
        ("execution_revision", "", "revision_unbound"),
        ("execution_revision", "old", "stale_revision"),
        ("executed_graph_revision", "old", "stale_revision"),
        ("no_output_dead_branch", True, "dead_branch_without_output"),
    ],
)
def test_verification_evidence_denies(field, value, reason):
    from core.dify_builder.verification import publication_decision

    run = verified()
    setattr(run.verification, field, value)
    assert (
        publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").reason
        == reason
    )


@pytest.mark.parametrize(("state", "allowed"), [("present", True), ("unknown", True), ("unresolved", False)])
def test_verification_present_null_and_unknown_are_reviewable(state, allowed):
    from core.dify_builder.verification import publication_decision, result_card

    run = verified()
    run.verification.output_findings = [
        models.OutputFinding(
            node_id="end", output_name="result", selector=["tool", "text"], state=state, reason="key_presence"
        )
    ]
    assert (
        publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").allowed
        is allowed
    )
    card = result_card(run)
    assert card.terminal_outputs == {"result": None}
    assert card.executed_node_ids == ["end"]
    assert card.outcome == ("execution_succeeded_needs_review" if allowed else "required_output_unresolved")
    assert "not verified" in card.review_note


ConfirmedOutcome = Literal["confirmed_tool_completed", "execution_evidence_unknown", "native_failed"]
ActionState = Literal["completed", "failed", "unknown"]


def confirmed_run(
    outcome: ConfirmedOutcome = "confirmed_tool_completed",
    *,
    action: ActionState = "completed",
    status: str = "succeeded",
    execution_revision: str | None = None,
) -> models.Run:
    summary = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-gmail-read-v1",
        mode="confirmed_tool",
        sealed=True,
        safety_outcome=outcome,
        sandbox_profile="disabled",
        native_run_id="native",
        consent_id="consent-1",
        action_state=action,
        action_reason_code="message_returned" if action == "completed" else "stream_incomplete",
    )
    run = verified()
    run.status = status
    run.error = "provider said: PROVIDER-ERROR-SENTINEL"
    assert run.verification is not None
    run.verification.execution_evidence = summary
    run.verification.terminal_outputs = {"result": "BODY-SENTINEL"}
    if execution_revision is not None:
        run.verification.execution_revision = execution_revision
    return run


def test_confirmed_success_is_publishable_only_when_sealed_and_revision_exact() -> None:
    from core.dify_builder.verification import publication_decision

    def decide(run: models.Run) -> models.PublicationDecision:
        return publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph")

    assert decide(confirmed_run()).allowed is True
    assert decide(confirmed_run(execution_revision="other")).reason == "stale_revision"
    assert decide(confirmed_run("execution_evidence_unknown", action="unknown")).reason == "execution_evidence_unknown"
    assert decide(confirmed_run("native_failed", action="failed", status="failed")).allowed is False


@pytest.mark.parametrize(
    ("outcome", "action", "status", "card_outcome"),
    [
        ("confirmed_tool_completed", "completed", "succeeded", "execution_succeeded_needs_review"),
        ("execution_evidence_unknown", "unknown", "succeeded", "execution_unknown"),
        ("native_failed", "failed", "failed", "execution_failed"),
    ],
)
def test_confirmed_card_has_ids_status_and_reasons_but_no_native_content(
    outcome: ConfirmedOutcome, action: ActionState, status: str, card_outcome: str
) -> None:
    import json
    from dataclasses import asdict

    from core.dify_builder.verification import result_card

    card = result_card(confirmed_run(outcome, action=action, status=status))
    text = json.dumps(asdict(card))
    assert "BODY-SENTINEL" not in text
    assert "PROVIDER-ERROR-SENTINEL" not in text
    assert card.terminal_outputs is None
    assert (card.execution_mode, card.safety_outcome, card.outcome) == ("confirmed_tool", outcome, card_outcome)
    assert (card.policy_version, card.consent_id, card.action_state) == (
        "builder-confirmed-gmail-read-v1",
        "consent-1",
        action,
    )
