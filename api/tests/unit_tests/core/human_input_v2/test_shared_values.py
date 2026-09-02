"""Tests for values shared by Human Input v2 bounded contexts."""

from typing import NewType, Protocol

import pytest

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    EmailProviderId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    PlatformEntryId,
    TenantId,
    WorkspaceScope,
)


class _StringNewType(Protocol):
    __supertype__: type[str]

    def __call__(self, value: str, /) -> str: ...


@pytest.mark.parametrize(
    "identifier_type",
    [
        AccountId,
        ContactId,
        EmailProviderId,
        IMBindingId,
        IMIdentityId,
        IMSyncResultId,
        IMSyncRunId,
        IntegrationId,
        PlatformEntryId,
        TenantId,
    ],
)
def test_typed_ids_are_direct_string_newtypes(identifier_type: _StringNewType) -> None:
    assert type(identifier_type) is NewType
    assert identifier_type.__supertype__ is str
    assert identifier_type("  identifier  ") == "  identifier  "


def test_typed_ids_are_distinct_static_types_with_string_runtime_values() -> None:
    assert ContactId is not AccountId
    assert ContactId("same") == ContactId("same")
    assert ContactId("same") == AccountId("same")


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
    tenant_id = TenantId("workspace-1")

    assert DeploymentScope().to_primitive() == {"kind": "deployment"}
    assert WorkspaceScope(id=tenant_id).to_primitive() == {
        "kind": "workspace",
        "id": "workspace-1",
    }
    with pytest.raises(AttributeError):
        WorkspaceScope(id=tenant_id).id = TenantId("workspace-2")  # type: ignore[misc]
