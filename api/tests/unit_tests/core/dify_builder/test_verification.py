from dataclasses import replace
from typing import Literal, Unpack

import pytest
from typing_extensions import TypedDict

from core.dify_builder import models
from core.dify_builder.models import Run
from services.dify_builder.application.execution_policy import ExecutionEvidenceSummary
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


class RunChanges(TypedDict, total=False, closed=True):
    session_id: str
    kind: str
    immutable: bool
    status: str
    verification: models.RunVerification | None


def verified(**changes: Unpack[RunChanges]) -> Run:
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
def test_verification_policy_denies(change: RunChanges, reason: str) -> None:
    from services.dify_builder.application.verification import publication_decision

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
def test_verification_evidence_denies(field: str, value: str | bool, reason: str) -> None:
    from services.dify_builder.application.verification import publication_decision

    run = verified()
    setattr(run.verification, field, value)
    assert (
        publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").reason
        == reason
    )


@pytest.mark.parametrize(("state", "allowed"), [("present", True), ("unknown", True), ("unresolved", False)])
def test_verification_present_null_and_unknown_are_reviewable(
    state: Literal["present", "unknown", "unresolved"], allowed: bool
) -> None:
    from services.dify_builder.application.verification import publication_decision, result_card

    run = verified()
    assert run.verification is not None
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
    assert "not verified" in english_text(card.review_note)


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
    from services.dify_builder.application.verification import publication_decision

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

    from services.dify_builder.application.verification import result_card

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


def json_run(
    *,
    outcome: Literal["restricted_execution_completed", "execution_evidence_unknown", "native_failed"] = (
        "restricted_execution_completed"
    ),
    status: str = "succeeded",
    text: str = "result",
) -> models.Run:
    """Unit presentation fixture; it does not attest to a native Tool invocation."""
    run = verified()
    assert run.verification is not None
    run.verification.execution_evidence = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-json-parse-v1",
        mode="restricted",
        sealed=outcome != "execution_evidence_unknown",
        safety_outcome=outcome,
        sandbox_profile="disabled",
        native_run_id="native" if outcome != "execution_evidence_unknown" else None,
    )
    run.status = status
    run.verification.terminal_outputs = {"result": text}
    return run


@pytest.mark.parametrize("text", ["Error: invalid JSON", "not valid { JSON"])
def test_json_native_success_text_remains_data_requiring_review(text: str) -> None:
    from services.dify_builder.application.verification import publication_decision, result_card

    run = json_run(text=text)
    card = result_card(run)
    assert card.policy_version == "builder-json-parse-v1"
    assert card.execution_mode == "restricted"
    assert card.safety_outcome == "restricted_execution_completed"
    assert card.outcome == "execution_succeeded_needs_review"
    assert card.failure_reason is None
    assert card.terminal_outputs == {"result": text}
    assert publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").allowed


def test_json_completion_preserves_required_output_and_revision_gates() -> None:
    from services.dify_builder.application.verification import publication_decision, result_card

    run = json_run()
    assert run.verification is not None
    run.verification.output_findings = [
        models.OutputFinding(
            node_id="end", output_name="result", selector=["tool", "text"], state="unresolved", reason="key_presence"
        )
    ]
    card = result_card(run)
    assert card.policy_version == "builder-json-parse-v1"
    assert card.outcome == "required_output_unresolved"
    assert publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").reason == (
        "required_output_unresolved"
    )
    run.verification.output_findings = []
    assert publication_decision(run, session_id="s", current_revision="old", current_graph_revision="graph").reason == (
        "stale_revision"
    )


@pytest.mark.parametrize(
    ("outcome", "status", "expected"),
    [
        ("execution_evidence_unknown", "succeeded", "execution_provenance_unbound"),
        ("native_failed", "failed", "execution_failed"),
    ],
)
def test_json_noncompletion_blocks_publication(
    outcome: Literal["restricted_execution_completed", "execution_evidence_unknown", "native_failed"],
    status: str,
    expected: str,
) -> None:
    from services.dify_builder.application.verification import (
        is_execution_policy_blocker,
        publication_decision,
        result_card,
    )

    run = json_run(outcome=outcome, status=status)
    assert is_execution_policy_blocker(run)
    run.error = "SECRET-PROVIDER-ERROR"
    assert publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph").reason == (
        expected
    )
    card = result_card(run)
    assert card.policy_version == "builder-json-parse-v1"
    assert card.outcome == ("execution_failed" if status == "failed" else "execution_unknown")
    assert english_text(card.failure_reason) is not None
    assert "SECRET-PROVIDER-ERROR" not in english_text(card.failure_reason)
    if status == "failed":
        assert card.terminal_outputs is None


def test_observed_preparation_failure_has_specific_copy_without_entering_repair():
    from services.dify_builder.application.verification import is_execution_policy_blocker, result_card

    run = verified(status="failed", dify_run_id="", error="private daemon response token=secret")
    run.verification.execution_evidence = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="preparation_failed",
        sandbox_profile="native",
        failure_phase="preparation",
        failure_reason="connection_refused",
    )
    assert is_execution_policy_blocker(run)
    card = result_card(run)
    assert card.outcome == "execution_failed"
    assert card.failure_reason.id == "test.preparationFailed"
    assert card.failure_reason.params == {"reason": "connection_refused"}
    assert card.failure_phase == "preparation"
    assert card.failure_code == "connection_refused"
    assert "secret" not in english_text(card.failure_reason)


def test_unknown_execution_asks_for_reconciliation_instead_of_rerun():
    from services.dify_builder.application.verification import result_card

    run = verified(status="running", dify_run_id="")
    run.verification.execution_evidence = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=False,
        safety_outcome="execution_evidence_unknown",
        sandbox_profile="native",
    )
    text = english_text(result_card(run).failure_reason)
    assert "existing Run" in text
    assert "run again" not in text.lower()
