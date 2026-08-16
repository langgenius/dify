"""Explicit mapping between Contact Directory values and persistence records."""

from datetime import datetime

from pydantic import NaiveDatetime

from core.human_input_v2.contact_directory import (
    Contact,
    ContactIdentitySource,
    ContactOwner,
    ExternalContactOwner,
    OrganizationAccountOwner,
    PlatformWorkspaceEntry,
    WorkspaceMemberOwner,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    NormalizedEmail,
    PlatformEntryId,
    TenantId,
)
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputContactIdentitySource,
    HumanInputPlatformContactWorkspaceEntry,
)


def _timestamp(value: datetime) -> NaiveDatetime:
    """Interpret database-naive timestamps as UTC, matching Dify persistence."""

    return ensure_naive_utc(value)


def contact_from_record(record: HumanInputContact) -> Contact:
    """Map one persistence record into an infrastructure-free Contact."""

    identity_source = ContactIdentitySource(record.identity_source.value)
    owner: ContactOwner
    match identity_source:
        case ContactIdentitySource.ORGANIZATION_ACCOUNT:
            if record.account_id is None:
                raise ValueError("organization account record is missing account_id")
            owner = OrganizationAccountOwner(AccountId(record.account_id))
        case ContactIdentitySource.WORKSPACE_MEMBER:
            if record.tenant_id is None or record.account_id is None:
                raise ValueError("workspace member record is missing owner fields")
            owner = WorkspaceMemberOwner(TenantId(record.tenant_id), AccountId(record.account_id))
        case ContactIdentitySource.EXTERNAL:
            if record.tenant_id is None:
                raise ValueError("external contact record is missing tenant_id")
            owner = ExternalContactOwner(TenantId(record.tenant_id))

    return Contact(
        id=ContactId(record.id),
        identity_source=identity_source,
        owner=owner,
        name=record.name,
        normalized_name=record.normalized_name,
        email=record.email,
        normalized_email=NormalizedEmail(record.normalized_email) if record.normalized_email is not None else None,
        avatar_file_id=record.avatar_file_id,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def contact_to_record(contact: Contact) -> HumanInputContact:
    """Map one Contact into a detached persistence record."""

    tenant_id: str | None
    account_id: str | None
    match contact.owner:
        case OrganizationAccountOwner(account_id=owner_account_id):
            tenant_id = None
            account_id = str(owner_account_id)
        case WorkspaceMemberOwner(tenant_id=tenant_id, account_id=owner_account_id):
            tenant_id = str(tenant_id)
            account_id = str(owner_account_id)
        case ExternalContactOwner(tenant_id=tenant_id):
            tenant_id = str(tenant_id)
            account_id = None

    record = HumanInputContact(
        name=contact.name,
        normalized_name=contact.normalized_name,
        identity_source=HumanInputContactIdentitySource(contact.identity_source.value),
        tenant_id=tenant_id,
        account_id=account_id,
        email=contact.email,
        normalized_email=str(contact.normalized_email) if contact.normalized_email is not None else None,
        avatar_file_id=contact.avatar_file_id,
    )
    record.id = str(contact.id)
    record.created_at = contact.created_at
    record.updated_at = contact.updated_at
    return record


def platform_entry_from_record(record: HumanInputPlatformContactWorkspaceEntry) -> PlatformWorkspaceEntry:
    """Map one Platform allow-list record into a domain fact."""

    return PlatformWorkspaceEntry(
        id=PlatformEntryId(record.id),
        tenant_id=TenantId(record.tenant_id),
        contact_id=ContactId(record.contact_id),
        added_by_account_id=AccountId(record.added_by_account_id),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def platform_entry_to_record(entry: PlatformWorkspaceEntry) -> HumanInputPlatformContactWorkspaceEntry:
    """Map one Platform allow-list fact into a detached persistence record."""

    record = HumanInputPlatformContactWorkspaceEntry(
        tenant_id=str(entry.tenant_id),
        contact_id=str(entry.contact_id),
        added_by_account_id=str(entry.added_by_account_id),
    )
    record.id = str(entry.id)
    record.created_at = entry.created_at
    record.updated_at = entry.updated_at
    return record
