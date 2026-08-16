"""Bidirectional mapper tests for the Contact Directory persistence boundary."""

from datetime import datetime, timedelta, timezone

import pytest

from core.human_input_v2.contact_directory import (
    Contact,
    ContactIdentitySource,
    OrganizationAccountOwner,
    PlatformWorkspaceEntry,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    PlatformEntryId,
    TenantId,
)
from models.human_input_v2 import HumanInputContactIdentitySource
from repositories.human_input_v2.contact_directory.mappers import (
    contact_from_record,
    contact_to_record,
    platform_entry_from_record,
    platform_entry_to_record,
)

_NOW = datetime(2026, 7, 25, 2, 30)


def test_organization_contact_round_trip_preserves_values_and_identity_source() -> None:
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Ada",
        email="ADA@example.com",
        now=_NOW,
    )

    record = contact_to_record(contact)
    restored = contact_from_record(record)

    assert record.id == "contact-1"
    assert record.tenant_id is None
    assert record.account_id == "account-1"
    assert record.identity_source is HumanInputContactIdentitySource.ORGANIZATION_ACCOUNT
    assert record.normalized_email == "ada@example.com"
    assert restored == contact
    assert restored.identity_source is ContactIdentitySource.ORGANIZATION_ACCOUNT
    assert restored.owner == OrganizationAccountOwner(AccountId("account-1"))


def test_external_contact_round_trip_preserves_workspace_owner_and_avatar() -> None:
    contact = Contact.external(
        contact_id=ContactId("contact-1"),
        tenant_id=TenantId("workspace-1"),
        name="Reviewer",
        email="reviewer@example.com",
        avatar_file_id="avatar-1",
        now=_NOW,
    )

    restored = contact_from_record(contact_to_record(contact))

    assert restored == contact


def test_record_mapper_treats_naive_database_timestamps_as_utc() -> None:
    record = contact_to_record(
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Ada",
            email=None,
            now=_NOW,
        )
    )
    record.created_at = datetime(2026, 7, 25, 2, 30)
    record.updated_at = datetime(2026, 7, 25, 2, 31)

    restored = contact_from_record(record)

    assert restored.created_at == datetime(2026, 7, 25, 2, 30)
    assert restored.updated_at == datetime(2026, 7, 25, 2, 31)


def test_record_mapper_converts_aware_database_timestamps_to_naive_utc() -> None:
    record = contact_to_record(
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Ada",
            email=None,
            now=_NOW,
        )
    )
    source_timezone = timezone(timedelta(hours=8))
    record.created_at = datetime(2026, 7, 25, 10, 30, tzinfo=source_timezone)
    record.updated_at = datetime(2026, 7, 25, 10, 31, tzinfo=source_timezone)

    restored = contact_from_record(record)

    assert restored.created_at == datetime(2026, 7, 25, 2, 30)
    assert restored.updated_at == datetime(2026, 7, 25, 2, 31)


def test_platform_entry_round_trip_preserves_owner_references() -> None:
    entry = PlatformWorkspaceEntry(
        id=PlatformEntryId("entry-1"),
        tenant_id=TenantId("workspace-1"),
        contact_id=ContactId("contact-1"),
        added_by_account_id=AccountId("admin-1"),
        created_at=_NOW,
        updated_at=_NOW,
    )

    restored = platform_entry_from_record(platform_entry_to_record(entry))

    assert restored == entry


@pytest.mark.parametrize(
    ("source", "tenant_id", "account_id", "message"),
    [
        (HumanInputContactIdentitySource.ORGANIZATION_ACCOUNT, None, None, "missing account_id"),
        (HumanInputContactIdentitySource.WORKSPACE_MEMBER, None, "account-1", "missing owner fields"),
        (HumanInputContactIdentitySource.EXTERNAL, None, None, "missing tenant_id"),
    ],
)
def test_mapper_rejects_corrupt_owner_records(
    source: HumanInputContactIdentitySource,
    tenant_id: str | None,
    account_id: str | None,
    message: str,
) -> None:
    record = contact_to_record(
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Ada",
            email=None,
            now=_NOW,
        )
    )
    record.identity_source = source
    record.tenant_id = tenant_id
    record.account_id = account_id

    with pytest.raises(ValueError, match=message):
        contact_from_record(record)
