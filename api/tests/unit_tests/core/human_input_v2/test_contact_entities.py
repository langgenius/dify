"""Domain tests for canonical Contact identity and ownership."""

from dataclasses import FrozenInstanceError, replace
from datetime import datetime

import pytest

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactIdentitySource,
    ContactRejectionCode,
    ExternalContactOwner,
    OrganizationAccountOwner,
    WorkspaceMemberOwner,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)

_NOW = datetime(2026, 7, 25)


def test_organization_account_contact_has_deployment_owner() -> None:
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Ada",
        email="ADA@example.com",
        now=_NOW,
    )

    assert contact.identity_source is ContactIdentitySource.ORGANIZATION_ACCOUNT
    assert contact.owner == OrganizationAccountOwner(AccountId("account-1"))
    assert contact.normalized_email is not None
    assert contact.normalized_email.value == "ada@example.com"


def test_workspace_member_contact_has_workspace_and_account_owner() -> None:
    contact = Contact.workspace_member(
        contact_id=ContactId("contact-1"),
        tenant_id=TenantId("workspace-1"),
        account_id=AccountId("account-1"),
        name="Ada",
        email=None,
        now=_NOW,
    )

    assert contact.identity_source is ContactIdentitySource.WORKSPACE_MEMBER
    assert contact.owner == WorkspaceMemberOwner(TenantId("workspace-1"), AccountId("account-1"))


def test_external_contact_requires_workspace_and_email() -> None:
    contact = Contact.external(
        contact_id=ContactId("contact-1"),
        tenant_id=TenantId("workspace-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    assert contact.identity_source is ContactIdentitySource.EXTERNAL
    assert contact.owner == ExternalContactOwner(TenantId("workspace-1"))


@pytest.mark.parametrize(
    ("identity_source", "owner"),
    [
        (ContactIdentitySource.ORGANIZATION_ACCOUNT, ExternalContactOwner(TenantId("workspace-1"))),
        (ContactIdentitySource.WORKSPACE_MEMBER, OrganizationAccountOwner(AccountId("account-1"))),
        (
            ContactIdentitySource.EXTERNAL,
            WorkspaceMemberOwner(TenantId("workspace-1"), AccountId("account-1")),
        ),
    ],
)
def test_invalid_identity_source_owner_combination_is_rejected(identity_source, owner) -> None:
    with pytest.raises(ContactDirectoryError) as error:
        Contact.create(
            contact_id=ContactId("contact-1"),
            identity_source=identity_source,
            owner=owner,
            name="Ada",
            email="ada@example.com",
            now=_NOW,
        )

    assert error.value.code is ContactRejectionCode.INVALID_OWNER


def test_external_contact_without_email_is_rejected() -> None:
    with pytest.raises(ContactDirectoryError) as error:
        Contact.create(
            contact_id=ContactId("contact-1"),
            identity_source=ContactIdentitySource.EXTERNAL,
            owner=ExternalContactOwner(TenantId("workspace-1")),
            name="Reviewer",
            email=None,
            now=_NOW,
        )

    assert error.value.code is ContactRejectionCode.INVALID_EMAIL


def test_identity_source_is_immutable_across_profile_changes() -> None:
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Ada",
        email="ada@example.com",
        now=_NOW,
    )

    with pytest.raises(FrozenInstanceError):
        contact.identity_source = ContactIdentitySource.EXTERNAL  # type: ignore[misc]
    with pytest.raises(ContactDirectoryError) as error:
        replace(contact, identity_source=ContactIdentitySource.EXTERNAL)
    assert error.value.code is ContactRejectionCode.INVALID_OWNER


def test_contact_directory_scope_is_derived_from_immutable_owner() -> None:
    organization = Contact.organization_account(
        contact_id=ContactId("organization"),
        account_id=AccountId("account-1"),
        name="Ada",
        email=None,
        now=_NOW,
    )
    external = Contact.external(
        contact_id=ContactId("external"),
        tenant_id=TenantId("workspace-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    assert organization.directory_scope == DeploymentScope()
    assert external.directory_scope == WorkspaceScope(id=TenantId("workspace-1"))


def test_contact_rejects_blank_name_and_inconsistent_email_values() -> None:
    with pytest.raises(ContactDirectoryError) as blank_name:
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="  ",
            email=None,
            now=_NOW,
        )
    assert blank_name.value.code is ContactRejectionCode.INVALID_NAME

    with pytest.raises(ContactDirectoryError) as invalid_email:
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Ada",
            email="invalid",
            now=_NOW,
        )
    assert invalid_email.value.code is ContactRejectionCode.INVALID_EMAIL

    with pytest.raises(ContactDirectoryError) as inconsistent_email:
        Contact(
            id=ContactId("contact-1"),
            identity_source=ContactIdentitySource.ORGANIZATION_ACCOUNT,
            owner=OrganizationAccountOwner(AccountId("account-1")),
            name=" Ada ",
            normalized_name="wrong",
            email="ada@example.com",
            normalized_email=NormalizedEmail("different@example.com"),
            avatar_file_id=None,
            created_at=_NOW,
            updated_at=_NOW,
        )
    assert inconsistent_email.value.code is ContactRejectionCode.INVALID_EMAIL


def test_contact_rejects_normalized_email_without_deliverable_email() -> None:
    with pytest.raises(ContactDirectoryError) as error:
        Contact(
            id=ContactId("contact-1"),
            identity_source=ContactIdentitySource.ORGANIZATION_ACCOUNT,
            owner=OrganizationAccountOwner(AccountId("account-1")),
            name="Ada",
            normalized_name="ada",
            email=None,
            normalized_email=NormalizedEmail("ada@example.com"),
            avatar_file_id=None,
            created_at=_NOW,
            updated_at=_NOW,
        )

    assert error.value.code is ContactRejectionCode.INVALID_EMAIL


def test_contact_canonicalizes_persisted_name_values() -> None:
    contact = Contact(
        id=ContactId("contact-1"),
        identity_source=ContactIdentitySource.ORGANIZATION_ACCOUNT,
        owner=OrganizationAccountOwner(AccountId("account-1")),
        name=" Ada ",
        normalized_name="stale-name",
        email=None,
        normalized_email=None,
        avatar_file_id=None,
        created_at=_NOW,
        updated_at=_NOW,
    )

    assert contact.name == "Ada"
    assert contact.normalized_name == "ada"
