"""Immutable Contact values and persistence ports."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, TenantId


class ContactType(StrEnum):
    """Workspace-scoped classification of a currently available Contact."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"


@dataclass(frozen=True, slots=True)
class Contact:
    """Immutable current Contact projection for one tenant."""

    id: ContactId
    type: ContactType
    name: str
    email: str | None
    avatar_file_id: str | None
    created_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class ExternalContact:
    """Workspace-owned External Contact data accepted by lifecycle writes."""

    id: ContactId
    name: str
    email: str
    avatar_file_id: str | None
    created_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class Page[T]:
    """Immutable page returned by Contact repository queries."""

    items: tuple[T, ...]
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class ContactQuery:
    """Optional keyword and current-type filters shared by list and count."""

    keyword: str = ""
    contact_type: ContactType | None = None


_DEFAULT_CONTACT_QUERY = ContactQuery()


class ContactRepository(Protocol):
    """Tenant-scoped current Contact queries and lifecycle writes."""

    def count_contact(self, tenant_id: TenantId, query: ContactQuery = _DEFAULT_CONTACT_QUERY) -> int: ...

    def list_contact(
        self,
        tenant_id: TenantId,
        page: int,
        limit: int,
        query: ContactQuery = _DEFAULT_CONTACT_QUERY,
    ) -> Page[Contact]: ...

    def get_contacts_by_id(self, tenant_id: TenantId, contact_id: ContactId) -> Contact | None: ...

    def get_contacts_by_ids(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[Contact]: ...

    def available(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Mapping[ContactId, bool]: ...

    def save_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> Contact: ...

    def delete_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> None: ...

    def provision_account_backed_contact(self, account_id: AccountId) -> ContactId: ...

    def query_contacts_by_email(
        self,
        tenant_id: TenantId,
        emails: Sequence[str],
    ) -> Sequence[Contact]: ...


CandidateId = ContactId


@dataclass(frozen=True, slots=True)
class OrganizationCandidate:
    id: ContactId
    name: str
    email: str | None
    avatar_file_id: str | None
    created_at: NaiveDatetime


class EnterpriseContactRepository(Protocol):
    """EE-only candidate queries and Platform visibility mutations."""

    def list_organization_candidates(
        self,
        page: int,
        limit: int,
        keyword: str = "",
    ) -> Sequence[OrganizationCandidate]: ...

    def count_organization_candidates(self, keyword: str = "") -> int: ...

    def create_platform_entry(
        self,
        tenant_id: TenantId,
        candidate_id: ContactId,
        added_by_account_id: AccountId,
    ) -> None: ...

    def delete_platform_entry(self, tenant_id: TenantId, contact_id: ContactId) -> None: ...


@dataclass(frozen=True, slots=True)
class IMBinding:
    """Contact-facing read value for one current IM binding."""

    id: IMBindingId
    scope: IMBindingScope
    contact_id: ContactId
    identity_id: IMIdentityId
    provider: IMProvider


class ContactIMBindingRepository(Protocol):
    """Tenant-scoped read-only port for Contact IM bindings."""

    def get_im_bindings(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[IMBinding]: ...


class ContactErrorCode(StrEnum):
    INVALID_OWNER = "invalid_owner"
    CONFLICT = "contact_conflict"
    NOT_FOUND = "contact_not_found"
    ACCOUNT_NOT_FOUND = "account_not_found"


class ContactError(RuntimeError):
    """Stable expected failure raised by Contact lifecycle operations."""

    def __init__(self, code: ContactErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


__all__ = [
    "CandidateId",
    "Contact",
    "ContactError",
    "ContactErrorCode",
    "ContactIMBindingRepository",
    "ContactQuery",
    "ContactRepository",
    "ContactType",
    "EnterpriseContactRepository",
    "ExternalContact",
    "IMBinding",
    "OrganizationCandidate",
    "Page",
]
