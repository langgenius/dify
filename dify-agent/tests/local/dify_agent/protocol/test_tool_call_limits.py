"""Authoritative tool dispatch annotations reject inconsistent dispositions."""

from pydantic import ValidationError
import pytest

from dify_agent.protocol.tool_call_limits import ToolCallLimitMetadata


@pytest.mark.parametrize(
    "changes",
    [
        {"used": 4},
        {"execution_status": "executed", "reason": "call_limit_reached"},
        {"execution_status": "not_executed", "reason": None},
        {"execution_status": "executed", "used": 0},
        {"execution_status": "not_executed", "reason": "call_limit_reached", "used": 1},
        {"execution_status": "not_executed", "reason": "duplicate_tool_call", "used": 0},
        {"limit": True},
        {"used": 1.0},
    ],
)
def test_protocol_rejects_metadata_whose_disposition_count_and_reason_disagree(changes: dict[str, object]) -> None:
    payload = {"tool_identity": "identity", "limit": 3, "used": 1, "execution_status": "executed"}
    with pytest.raises(ValidationError):
        ToolCallLimitMetadata.model_validate(payload | changes)


@pytest.mark.parametrize("used", [1, 3])
def test_unconfirmed_reservations_are_not_claimed_as_executed(used: int) -> None:
    metadata = ToolCallLimitMetadata(tool_identity="operation", limit=3, used=used, execution_status="unconfirmed")
    assert metadata.reason is None
    assert metadata.model_dump(mode="json")["execution_status"] == "unconfirmed"


@pytest.mark.parametrize("changes", [{"used": 0}, {"reason": "call_limit_reached"}, {"reason": "duplicate_tool_call"}])
def test_unconfirmed_metadata_requires_positive_usage_and_no_rejection_reason(changes: dict[str, object]) -> None:
    payload = {"tool_identity": "operation", "limit": 3, "used": 1, "execution_status": "unconfirmed"}
    with pytest.raises(ValidationError):
        ToolCallLimitMetadata.model_validate(payload | changes)


def test_terminal_snapshot_reads_lossless_decimal_limit_and_exports_an_integer() -> None:
    from dify_agent.protocol.tool_call_limits import ToolCallLimitSnapshot

    limit = 10**40 + 123
    snapshot = ToolCallLimitSnapshot.model_validate(
        {"tool_identity": "operation", "limit": str(limit), "used": 2, "call_ids": {"hash-a": 1, "hash-b": 2}}
    )
    assert snapshot.limit == limit and snapshot.call_ids == {"hash-a": 1, "hash-b": 2}
    assert snapshot.model_dump(mode="json")["limit"] == limit


@pytest.mark.parametrize(
    "changes",
    [
        {"limit": True},
        {"limit": "3.0"},
        {"limit": "03"},
        {"used": 4},
        {"used": 2},
        {"call_ids": {"hash-a": True}},
        {"call_ids": {"hash-a": 1.0}},
        {"call_ids": {"hash-a": 2}},
        {"used": 2, "call_ids": {"hash-a": 1, "hash-b": 1}},
    ],
)
def test_terminal_snapshot_rejects_inconsistent_or_coerced_reservation_ordinals(changes: dict[str, object]) -> None:
    from dify_agent.protocol.tool_call_limits import ToolCallLimitSnapshot

    payload = {"tool_identity": "operation", "limit": 3, "used": 1, "call_ids": {"hash-a": 1}}
    with pytest.raises(ValidationError):
        ToolCallLimitSnapshot.model_validate(payload | changes)
