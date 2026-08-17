"""Canonical Contact identity independent of workspace-relative resolution.

Contacts own identity invariants and current profile facts. Membership,
allow-list state, database I/O, and transport serialization remain outside the
entity so its immutable lifecycle source cannot be confused with a query result.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import NaiveDatetime

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    NormalizedEmail,
    PlatformEntryId,
    TenantId,
    WorkspaceScope,
)

from .errors import ContactRejectionCode, reject


class ContactIdentitySource(StrEnum):
    """Immutable lifecycle source of a canonical Contact."""

    ORGANIZATION_ACCOUNT = "organization_account"
    WORKSPACE_MEMBER = "workspace_member"
    EXTERNAL = "external"


@dataclass(frozen=True, slots=True)
class OrganizationAccountOwner:
    """Deployment-wide EE owner reference backed by one Account."""

    account_id: AccountId


@dataclass(frozen=True, slots=True)
class WorkspaceMemberOwner:
    """Workspace owner reference backed by one current or historical Account."""

    tenant_id: TenantId
    account_id: AccountId


@dataclass(frozen=True, slots=True)
class ExternalContactOwner:
    """Workspace owner reference for an address managed by administrators."""

    tenant_id: TenantId


type ContactOwner = OrganizationAccountOwner | WorkspaceMemberOwner | ExternalContactOwner


@dataclass(frozen=True, slots=True)
class Contact:
    """Canonical identity whose source and owner remain immutable.

    Use the named factories for normal construction. ``create`` exists for
    persistence mapping and validates the same source/owner invariant.
    """

    id: ContactId
    identity_source: ContactIdentitySource
    owner: ContactOwner
    name: str
    normalized_name: str
    email: str | None
    normalized_email: NormalizedEmail | None
    avatar_file_id: str | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def __post_init__(self) -> None:
        expected_owner_type = {
            ContactIdentitySource.ORGANIZATION_ACCOUNT: OrganizationAccountOwner,
            ContactIdentitySource.WORKSPACE_MEMBER: WorkspaceMemberOwner,
            ContactIdentitySource.EXTERNAL: ExternalContactOwner,
        }[self.identity_source]
        if not isinstance(self.owner, expected_owner_type):
            raise reject(ContactRejectionCode.INVALID_OWNER)
        if not self.name.strip():
            raise reject(ContactRejectionCode.INVALID_NAME)
        if self.identity_source is ContactIdentitySource.EXTERNAL and self.normalized_email is None:
            raise reject(ContactRejectionCode.INVALID_EMAIL)
        if self.email is None and self.normalized_email is not None:
            raise reject(ContactRejectionCode.INVALID_EMAIL)
        if self.email is not None:
            try:
                normalized_email = NormalizedEmail(self.email)
            except ValueError as error:
                raise reject(ContactRejectionCode.INVALID_EMAIL) from error
            if self.normalized_email != normalized_email:
                raise reject(ContactRejectionCode.INVALID_EMAIL)
            object.__setattr__(self, "email", self.email.strip())
        normalized_name = self.name.strip().casefold()
        if self.normalized_name != normalized_name:
            object.__setattr__(self, "normalized_name", normalized_name)
        object.__setattr__(self, "name", self.name.strip())

    @classmethod
    def create(
        cls,
        *,
        contact_id: ContactId,
        identity_source: ContactIdentitySource,
        owner: ContactOwner,
        name: str,
        email: str | None,
        now: NaiveDatetime,
        avatar_file_id: str | None = None,
        created_at: NaiveDatetime | None = None,
    ) -> Contact:
        normalized_email: NormalizedEmail | None = None
        if email is not None:
            try:
                normalized_email = NormalizedEmail(email)
            except ValueError as error:
                raise reject(ContactRejectionCode.INVALID_EMAIL) from error
        return cls(
            id=contact_id,
            identity_source=identity_source,
            owner=owner,
            name=name,
            normalized_name=name.strip().casefold(),
            email=email,
            normalized_email=normalized_email,
            avatar_file_id=avatar_file_id,
            created_at=created_at or now,
            updated_at=now,
        )

    @classmethod
    def organization_account(
        cls,
        *,
        contact_id: ContactId,
        account_id: AccountId,
        name: str,
        email: str | None,
        now: NaiveDatetime,
    ) -> Contact:
        return cls.create(
            contact_id=contact_id,
            identity_source=ContactIdentitySource.ORGANIZATION_ACCOUNT,
            owner=OrganizationAccountOwner(account_id),
            name=name,
            email=email,
            now=now,
        )

    @classmethod
    def workspace_member(
        cls,
        *,
        contact_id: ContactId,
        tenant_id: TenantId,
        account_id: AccountId,
        name: str,
        email: str | None,
        now: NaiveDatetime,
    ) -> Contact:
        return cls.create(
            contact_id=contact_id,
            identity_source=ContactIdentitySource.WORKSPACE_MEMBER,
            owner=WorkspaceMemberOwner(tenant_id, account_id),
            name=name,
            email=email,
            now=now,
        )

    @classmethod
    def external(
        cls,
        *,
        contact_id: ContactId,
        tenant_id: TenantId,
        name: str,
        email: str,
        now: NaiveDatetime,
        avatar_file_id: str | None = None,
    ) -> Contact:
        return cls.create(
            contact_id=contact_id,
            identity_source=ContactIdentitySource.EXTERNAL,
            owner=ExternalContactOwner(tenant_id),
            name=name,
            email=email,
            now=now,
            avatar_file_id=avatar_file_id,
        )

    @property
    def account_id(self) -> AccountId | None:
        if isinstance(self.owner, OrganizationAccountOwner | WorkspaceMemberOwner):
            return self.owner.account_id
        return None

    @property
    def directory_scope(self) -> DirectoryScope:
        if isinstance(self.owner, OrganizationAccountOwner):
            return DeploymentScope()
        return WorkspaceScope(id=self.owner.tenant_id)


@dataclass(frozen=True, slots=True)
class ContactSnapshot:
    """Immutable Contact plus current Account availability for one operation."""

    contact: Contact
    account_available: bool


@dataclass(frozen=True, slots=True)
class PlatformWorkspaceEntry:
    """One workspace allow-list fact for an Organization Account Contact."""

    id: PlatformEntryId
    tenant_id: TenantId
    contact_id: ContactId
    added_by_account_id: AccountId
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
