"""Tests for values shared by Human Input v2 bounded contexts."""

import json
from datetime import UTC, datetime, timedelta, timezone

import pytest

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    NormalizedEmail,
    UtcTimestamp,
    WorkspaceId,
    WorkspaceScope,
)


@pytest.mark.parametrize("identifier_type", [AccountId, ContactId, WorkspaceId])
@pytest.mark.parametrize("invalid_value", ["", "   ", "\n"])
def test_typed_ids_reject_blank_values(identifier_type, invalid_value: str) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        identifier_type(invalid_value)


def test_typed_ids_are_equal_only_within_the_same_id_type() -> None:
    assert ContactId("same") == ContactId("same")
    assert ContactId("same") != AccountId("same")
    assert ContactId("same").to_primitive() == "same"


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        (" USER@Example.COM ", "user@example.com"),
        ("StraSSE@EXAMPLE.COM", "strasse@example.com"),
    ],
)
def test_normalized_email_canonicalizes_equality(raw: str, normalized: str) -> None:
    assert NormalizedEmail(raw) == NormalizedEmail(normalized)
    assert NormalizedEmail(raw).to_primitive() == normalized


@pytest.mark.parametrize("invalid_email", ["", "plain-text", "@example.com", "user@", "a b@example.com"])
def test_normalized_email_rejects_invalid_values(invalid_email: str) -> None:
    with pytest.raises(ValueError, match="valid email"):
        NormalizedEmail(invalid_email)


def test_owner_scopes_are_explicit_and_immutable() -> None:
    workspace_id = WorkspaceId("workspace-1")

    assert DeploymentScope().to_primitive() == {"kind": "deployment"}
    assert WorkspaceScope(workspace_id).to_primitive() == {
        "kind": "workspace",
        "workspace_id": "workspace-1",
    }
    with pytest.raises(AttributeError):
        WorkspaceScope(workspace_id).workspace_id = WorkspaceId("workspace-2")  # type: ignore[misc]


def test_utc_timestamp_normalizes_and_serializes_at_the_boundary() -> None:
    source = datetime(2026, 7, 25, 10, 30, tzinfo=timezone(timedelta(hours=8)))
    timestamp = UtcTimestamp(source)

    assert timestamp.value == datetime(2026, 7, 25, 2, 30, tzinfo=UTC)
    assert timestamp.to_primitive() == "2026-07-25T02:30:00Z"
    with pytest.raises(TypeError):
        json.dumps(timestamp)


def test_utc_timestamp_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        UtcTimestamp(datetime(2026, 7, 25, 2, 30))
