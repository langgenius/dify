"""Table-driven tests for Contact Directory resolution and lifecycle policy."""

from datetime import datetime

import pytest

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectoryPolicy,
    ContactDirectorySnapshot,
    ContactRejectionCode,
    ContactResolution,
)
from core.human_input_v2.shared import AccountId, ContactId, TenantId

_NOW = datetime(2026, 7, 25)
_TENANT_ID = TenantId("workspace-1")


def _organization_contact() -> Contact:
    return Contact.organization_account(
        contact_id=ContactId("organization-contact"),
        account_id=AccountId("account-1"),
        name="Ada",
        email="ada@example.com",
        now=_NOW,
    )


def _workspace_member_contact() -> Contact:
    return Contact.workspace_member(
        contact_id=ContactId("member-contact"),
        tenant_id=_TENANT_ID,
        account_id=AccountId("account-2"),
        name="Grace",
        email="grace@example.com",
        now=_NOW,
    )


@pytest.mark.parametrize(
    ("contact_factory", "member_accounts", "platform_contacts", "unavailable_accounts", "expected"),
    [
        (_organization_contact, {AccountId("account-1")}, set(), set(), ContactResolution.WORKSPACE),
        (_organization_contact, set(), {ContactId("organization-contact")}, set(), ContactResolution.PLATFORM),
        (_organization_contact, set(), set(), set(), ContactResolution.ABSENT),
        (
            _organization_contact,
            {AccountId("account-1")},
            {ContactId("organization-contact")},
            {AccountId("account-1")},
            ContactResolution.ABSENT,
        ),
        (_workspace_member_contact, {AccountId("account-2")}, set(), set(), ContactResolution.WORKSPACE),
        (_workspace_member_contact, set(), set(), set(), ContactResolution.ABSENT),
    ],
)
def test_account_contact_resolution(
    contact_factory,
    member_accounts: set[AccountId],
    platform_contacts: set[ContactId],
    unavailable_accounts: set[AccountId],
    expected: ContactResolution,
) -> None:
    contact = contact_factory()
    snapshot = ContactDirectorySnapshot(
        tenant_id=_TENANT_ID,
        contacts=(contact,),
        member_account_ids=frozenset(member_accounts),
        platform_contact_ids=frozenset(platform_contacts),
        unavailable_account_ids=frozenset(unavailable_accounts),
    )

    assert ContactDirectoryPolicy.resolve_for_workspace(snapshot, contact.id) is expected
    assert contact == contact_factory()


def test_external_contact_resolves_only_in_its_owner_workspace() -> None:
    contact = Contact.external(
        contact_id=ContactId("external-contact"),
        tenant_id=_TENANT_ID,
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    owner_snapshot = ContactDirectorySnapshot(tenant_id=_TENANT_ID, contacts=(contact,))
    other_snapshot = ContactDirectorySnapshot(tenant_id=TenantId("workspace-2"), contacts=(contact,))

    assert ContactDirectoryPolicy.resolve_for_workspace(owner_snapshot, contact.id) is ContactResolution.EXTERNAL
    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.resolve_for_workspace(other_snapshot, contact.id)
    assert error.value.code is ContactRejectionCode.CROSS_ORGANIZATION


def test_missing_contact_resolves_absent() -> None:
    snapshot = ContactDirectorySnapshot(tenant_id=_TENANT_ID)

    assert ContactDirectoryPolicy.resolve_for_workspace(snapshot, ContactId("missing")) is ContactResolution.ABSENT


def test_external_admission_rejects_normalized_email_collision() -> None:
    snapshot = ContactDirectorySnapshot(tenant_id=_TENANT_ID, contacts=(_organization_contact(),))

    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.admit_external(
            snapshot,
            contact_id=ContactId("external-contact"),
            name="Duplicate",
            email=" ADA@EXAMPLE.COM ",
            now=_NOW,
        )
    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY


def test_deleted_external_email_can_be_recreated_with_a_new_contact_id() -> None:
    empty_after_deletion = ContactDirectorySnapshot(tenant_id=_TENANT_ID)

    recreated = ContactDirectoryPolicy.admit_external(
        empty_after_deletion,
        contact_id=ContactId("new-contact"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    assert recreated.id == ContactId("new-contact")


def test_hard_deletion_rejects_cross_organization_contact() -> None:
    contact = Contact.external(
        contact_id=ContactId("external-contact"),
        tenant_id=TenantId("workspace-2"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.ensure_external_deletable(contact, _TENANT_ID)
    assert error.value.code is ContactRejectionCode.CROSS_ORGANIZATION


def test_hard_deletion_accepts_contact_from_owner_workspace_without_mutation() -> None:
    contact = Contact.external(
        contact_id=ContactId("external-contact"),
        tenant_id=_TENANT_ID,
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    ContactDirectoryPolicy.ensure_external_deletable(contact, _TENANT_ID)

    assert contact.owner.tenant_id == _TENANT_ID


def test_workspace_member_resolution_rejects_cross_organization_use() -> None:
    contact = _workspace_member_contact()
    snapshot = ContactDirectorySnapshot(tenant_id=TenantId("workspace-2"), contacts=(contact,))

    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.resolve_for_workspace(snapshot, contact.id)
    assert error.value.code is ContactRejectionCode.CROSS_ORGANIZATION


def test_external_admission_rejects_invalid_email() -> None:
    snapshot = ContactDirectorySnapshot(tenant_id=_TENANT_ID)

    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.admit_external(
            snapshot,
            contact_id=ContactId("external-contact"),
            name="Reviewer",
            email="invalid",
            now=_NOW,
        )
    assert error.value.code is ContactRejectionCode.INVALID_EMAIL


def test_hard_deletion_rejects_account_backed_contact() -> None:
    with pytest.raises(ContactDirectoryError) as error:
        ContactDirectoryPolicy.ensure_external_deletable(_organization_contact(), _TENANT_ID)
    assert error.value.code is ContactRejectionCode.INVALID_OWNER
