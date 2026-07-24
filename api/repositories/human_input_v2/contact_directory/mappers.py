"""Explicit mapping between Contact Directory values and persistence records."""

from datetime import UTC, datetime

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
    UtcTimestamp,
    WorkspaceId,
)
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputContactIdentitySource,
    HumanInputPlatformContactWorkspaceEntry,
)


def _timestamp(value: datetime) -> UtcTimestamp:
    """Interpret database-naive timestamps as UTC, matching Dify persistence."""

    return UtcTimestamp(value.replace(tzinfo=UTC) if value.tzinfo is None else value)


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
            owner = WorkspaceMemberOwner(WorkspaceId(record.tenant_id), AccountId(record.account_id))
        case ContactIdentitySource.EXTERNAL:
            if record.tenant_id is None:
                raise ValueError("external contact record is missing tenant_id")
            owner = ExternalContactOwner(WorkspaceId(record.tenant_id))

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
        case WorkspaceMemberOwner(workspace_id=workspace_id, account_id=owner_account_id):
            tenant_id = str(workspace_id)
            account_id = str(owner_account_id)
        case ExternalContactOwner(workspace_id=workspace_id):
            tenant_id = str(workspace_id)
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
    record.created_at = contact.created_at.value
    record.updated_at = contact.updated_at.value
    return record


def platform_entry_from_record(record: HumanInputPlatformContactWorkspaceEntry) -> PlatformWorkspaceEntry:
    """Map one Platform allow-list record into a domain fact."""

    return PlatformWorkspaceEntry(
        id=PlatformEntryId(record.id),
        workspace_id=WorkspaceId(record.tenant_id),
        contact_id=ContactId(record.contact_id),
        added_by_account_id=AccountId(record.added_by_account_id),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def platform_entry_to_record(entry: PlatformWorkspaceEntry) -> HumanInputPlatformContactWorkspaceEntry:
    """Map one Platform allow-list fact into a detached persistence record."""

    record = HumanInputPlatformContactWorkspaceEntry(
        tenant_id=str(entry.workspace_id),
        contact_id=str(entry.contact_id),
        added_by_account_id=str(entry.added_by_account_id),
    )
    record.id = str(entry.id)
    record.created_at = entry.created_at.value
    record.updated_at = entry.updated_at.value
    return record
