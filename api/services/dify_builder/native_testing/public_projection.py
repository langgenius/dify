"""Safe presentation of durable grant facts; this projection never authorizes a call."""

from datetime import datetime

from models.dify_builder_native_tests import NativeEffectGrant
from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure


def project_pending_decision(
    item: PendingActionDisclosure, *, grant: NativeEffectGrant | None, now: datetime
) -> PendingActionDisclosure:
    if item.wait_reason != "approval":
        return item.model_copy(update={"continuation_blocked_reason": "native_resolution_unavailable"})
    if grant is None:
        expired = item.approval_limits is not None and datetime.fromisoformat(item.approval_limits.expires_at) <= now
        return item.model_copy(
            update={"decision": None, "decision_status": "expired" if expired else "awaiting_decision"}
        )
    decision = "confirm" if grant.decision == "approved" else "deny"
    status = "confirmed" if decision == "confirm" else "denied"
    if decision == "confirm":
        if grant.expires_at <= now:
            status = "expired"
        elif grant.spent_calls >= grant.max_calls or grant.spent_dispatches >= grant.max_dispatches:
            status = "exhausted"
    return item.model_copy(update={"decision": decision, "decision_status": status})


def decision_public_revision(observations: list[dict]) -> int:
    """Only decisions marked by the serialized public decision owner count."""
    return sum(record.get("public_decision_saved") is True for record in observations)
