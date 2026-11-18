"""Authoritative tool dispatch annotations reject inconsistent dispositions."""

import hashlib

from pydantic import JsonValue, ValidationError
import pytest

from dify_agent.protocol.tool_call_limits import (
    AGENT_TOOL_ACTIVITY_META_KEY,
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_EXECUTION_FAILED_METADATA_KEY,
    TOOL_VALIDATION_FAILED_METADATA_KEY,
    AgentToolActivity,
    ToolCallLimitMetadata,
    ToolCallLimitSnapshot,
    agent_tool_activity_from_metadata,
    runtime_tool_failed,
    unconfirmed_reservation,
    validated_call_limit,
)


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


def test_agent_tool_activity_sidecar_roundtrips_without_exposing_other_provider_metadata() -> None:
    quota = ToolCallLimitMetadata(tool_identity="operation", limit=3, used=1, execution_status="executed")
    activity = AgentToolActivity(
        id="run:call",
        run_id="run",
        tool_call_id="call",
        tool_name="search",
        status="failed",
        error="upstream failed",
        call_limit=quota,
    )
    stored = {AGENT_TOOL_ACTIVITY_META_KEY: activity.model_dump(mode="json"), "api_key": "private-provider-config"}
    decoded = agent_tool_activity_from_metadata(stored)
    assert decoded == activity
    assert decoded is not None
    assert decoded.call_limit == quota
    assert "api_key" not in decoded.model_dump(mode="json")
    assert AgentToolActivity.model_validate_json(activity.model_dump_json()) == activity


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "different-run:call"},
        {"status": "not_executed"},
        {"credentials": {"secret": "must-not-expose"}},
        {"status": "unconfirmed"},
    ],
)
def test_agent_activity_rejects_identity_conflicts_unproven_rejection_and_extra_fields(
    changes: dict[str, object],
) -> None:
    payload = {"id": "run:call", "run_id": "run", "tool_call_id": "call", "tool_name": "search", "status": "succeeded"}
    with pytest.raises(ValidationError):
        AgentToolActivity.model_validate(payload | changes)


@pytest.mark.parametrize("status", ["started", "running", "succeeded"])
def test_agent_activity_cannot_present_an_unconfirmed_reservation_as_running_or_successful(status: str) -> None:
    with pytest.raises(ValidationError, match="unconfirmed"):
        AgentToolActivity.model_validate(
            {
                "id": "run:call",
                "run_id": "run",
                "tool_call_id": "call",
                "tool_name": "search",
                "status": status,
                "call_limit": {"tool_identity": "operation", "limit": 3, "used": 1, "execution_status": "unconfirmed"},
            }
        )


@pytest.mark.parametrize(
    "metadata", [None, [], "tool succeeded", {}, {AGENT_TOOL_ACTIVITY_META_KEY: {}}, {"status": "succeeded"}]
)
def test_old_or_malformed_thought_metadata_does_not_assert_tool_execution(metadata: object) -> None:
    assert agent_tool_activity_from_metadata(metadata) is None


@pytest.mark.parametrize(
    "metadata", [None, [], "3/3 tool executed", {}, {TOOL_CALL_LIMIT_METADATA_KEY: {"limit": 3, "used": 4}}]
)
def test_only_well_formed_structured_quota_metadata_is_read(metadata: JsonValue) -> None:
    assert validated_call_limit(metadata) is None


def test_validated_call_limit_preserves_runtime_decision_without_using_observation_text() -> None:
    quota = ToolCallLimitMetadata(
        tool_identity="operation", limit=3, used=3, execution_status="not_executed", reason="call_limit_reached"
    )
    metadata = {TOOL_CALL_LIMIT_METADATA_KEY: quota.model_dump(mode="json"), "content": "untrusted success claim"}
    assert validated_call_limit(metadata) == quota


@pytest.mark.parametrize(
    "metadata,has_quota,expected",
    [
        (None, False, False),
        ({TOOL_VALIDATION_FAILED_METADATA_KEY: True}, False, True),
        ({TOOL_EXECUTION_FAILED_METADATA_KEY: True}, False, False),
        ({TOOL_EXECUTION_FAILED_METADATA_KEY: True}, True, True),
        ({TOOL_EXECUTION_FAILED_METADATA_KEY: "true"}, True, False),
        ({TOOL_EXECUTION_FAILED_METADATA_KEY: 1}, True, False),
        ({TOOL_VALIDATION_FAILED_METADATA_KEY: 1}, False, False),
        ({TOOL_VALIDATION_FAILED_METADATA_KEY: "true"}, False, False),
    ],
)
def test_runtime_failure_markers_are_strict_boolean_and_execution_failures_require_quota(
    metadata: JsonValue, has_quota: bool, expected: bool
) -> None:
    assert runtime_tool_failed(metadata, has_quota=has_quota) is expected


def test_unconfirmed_summary_uses_each_calls_reservation_ordinal_and_never_guesses_ambiguous_matches() -> None:
    call_ids = {
        hashlib.sha256(value.encode()).hexdigest(): index for index, value in enumerate(("first", "target", "last"), 1)
    }
    snapshot = ToolCallLimitSnapshot(tool_identity="operation", limit=3, used=3, call_ids=call_ids)
    before = snapshot.model_dump(mode="json")
    result = unconfirmed_reservation("target", {"operation": snapshot})
    assert result == ToolCallLimitMetadata(tool_identity="operation", limit=3, used=2, execution_status="unconfirmed")
    assert snapshot.model_dump(mode="json") == before
    assert unconfirmed_reservation("absent", {"operation": snapshot}) is None
    assert unconfirmed_reservation("target", {}) is None
    another = ToolCallLimitSnapshot(tool_identity="other", limit=3, used=3, call_ids=call_ids)
    assert unconfirmed_reservation("target", {"operation": snapshot, "other": another}) is None
