from dataclasses import replace

import pytest

from core.dify_builder import models


def verified(**changes):
    run = models.Run(
        id="r",
        session_id="s",
        kind="verify",
        immutable=True,
        status="succeeded",
        verification=models.RunVerification(
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
        ({"verification": None}, "revision_unbound"),
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
