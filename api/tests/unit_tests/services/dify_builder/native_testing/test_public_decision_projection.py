"""Saved decisions survive refresh without creating fresh execution authority."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from runtime_contracts.builder.native.approval_contracts import NativeApprovalTerms
from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure


@pytest.mark.parametrize(
    ("decision", "expired", "expected"),
    [("approved", False, "confirmed"), ("approved", True, "expired"), ("denied", False, "denied")],
)
def test_saved_decision_projects_independently_of_current_grant_validity(decision, expired, expected):
    from services.dify_builder.native_testing.public_projection import project_pending_decision

    now = datetime.now(UTC)
    item = PendingActionDisclosure(
        pending_operation_id="p",
        wait_reason="approval",
        version=1,
        scope_digest="a" * 64,
        account_label="Account",
        action="send",
        target=None,
        parameters_summary=None,
        risk_notice="Sends a message",
        required_configuration=(),
        native_form_ref=None,
        approval_limits=NativeApprovalTerms(
            max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=(now + timedelta(minutes=1)).isoformat()
        ),
    )
    grant = SimpleNamespace(
        decision=decision,
        expires_at=now + timedelta(seconds=-1 if expired else 60),
        spent_calls=0,
        max_calls=1,
        spent_dispatches=0,
        max_dispatches=1,
    )
    projected = project_pending_decision(item, grant=grant, now=now)
    assert projected.decision == ("confirm" if decision == "approved" else "deny")
    assert projected.decision_status == expected
    assert "grant_id" not in projected.model_dump()


def test_configuration_projection_reports_unsupported_continuation_without_approval():
    from services.dify_builder.native_testing.public_projection import project_pending_decision

    item = PendingActionDisclosure(
        pending_operation_id="p",
        wait_reason="configuration",
        version=1,
        scope_digest=None,
        account_label=None,
        action="configuration",
        target=None,
        parameters_summary=None,
        risk_notice=None,
        required_configuration=("opaque-reference",),
        native_form_ref=None,
        approval_limits=None,
    )
    result = project_pending_decision(item, grant=None, now=datetime.now(UTC))
    assert result.continuation_blocked_reason == "native_resolution_unavailable"
    assert result.decision is None
    assert result.scope_digest is None


def test_public_revision_counts_only_saved_decision_records():
    from services.dify_builder.native_testing.public_projection import decision_public_revision

    assert (
        decision_public_revision(
            [
                {"native_command_key": "start"},
                {"native_command_key": "resume"},
                {"public_decision_saved": True},
                {"public_decision_saved": "true"},
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    ("expiry_offset", "expected"),
    [(-1, "expired"), (0, "expired"), (1, "awaiting_decision")],
)
def test_undecided_proposal_projects_expiry_at_a_fixed_clock(expiry_offset, expected):
    from services.dify_builder.native_testing.public_projection import project_pending_decision

    now = datetime(2026, 10, 20, 12, tzinfo=UTC)
    item = PendingActionDisclosure(
        pending_operation_id="pending",
        wait_reason="approval",
        version=1,
        scope_digest="a" * 64,
        account_label="Account",
        action="send",
        target=None,
        parameters_summary=None,
        risk_notice="Sends a message",
        required_configuration=(),
        native_form_ref=None,
        approval_limits=NativeApprovalTerms(
            max_calls=1,
            max_dispatches=1,
            max_cost_units=1,
            expires_at=(now + timedelta(seconds=expiry_offset)).isoformat(),
        ),
    )

    projected = project_pending_decision(item, grant=None, now=now)

    assert projected.decision is None
    assert projected.decision_status == expected
