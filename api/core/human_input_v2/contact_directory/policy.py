"""Pure Contact Directory resolution and lifecycle policies.

The immutable snapshot supplies all operation-scoped facts. Policies never load
membership, Account, allow-list, or Contact records themselves.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import NaiveDatetime

from core.human_input_v2.shared import AccountId, ContactId, NormalizedEmail, TenantId

from .entities import Contact, ExternalContactOwner, OrganizationAccountOwner, WorkspaceMemberOwner
from .errors import ContactRejectionCode, reject


class ContactResolution(StrEnum):
    """Workspace-relative availability of one canonical Contact."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"
    ABSENT = "absent"


@dataclass(frozen=True, slots=True)
class ContactDirectorySnapshot:
    """Coherent, request-scoped Contact facts for one workspace.

    The snapshot is deliberately not a cache. Authorization callers that need
    current facts must load a new snapshot in their own operation.
    """

    tenant_id: TenantId
    contacts: tuple[Contact, ...] = ()
    member_account_ids: frozenset[AccountId] = frozenset()
    platform_contact_ids: frozenset[ContactId] = frozenset()
    unavailable_account_ids: frozenset[AccountId] = frozenset()

    def find(self, contact_id: ContactId) -> Contact | None:
        return next((contact for contact in self.contacts if contact.id == contact_id), None)


class ContactDirectoryPolicy:
    """Stateless policy for workspace resolution and External lifecycle rules."""

    @staticmethod
    def resolve_for_workspace(snapshot: ContactDirectorySnapshot, contact_id: ContactId) -> ContactResolution:
        contact = snapshot.find(contact_id)
        if contact is None:
            return ContactResolution.ABSENT

        owner = contact.owner
        if isinstance(owner, ExternalContactOwner):
            if owner.tenant_id != snapshot.tenant_id:
                raise reject(ContactRejectionCode.CROSS_ORGANIZATION)
            return ContactResolution.EXTERNAL
        if isinstance(owner, WorkspaceMemberOwner) and owner.tenant_id != snapshot.tenant_id:
            raise reject(ContactRejectionCode.CROSS_ORGANIZATION)

        account_id = contact.account_id
        if account_id is None or account_id in snapshot.unavailable_account_ids:
            return ContactResolution.ABSENT
        if account_id in snapshot.member_account_ids:
            return ContactResolution.WORKSPACE
        if isinstance(owner, OrganizationAccountOwner) and contact.id in snapshot.platform_contact_ids:
            return ContactResolution.PLATFORM
        return ContactResolution.ABSENT

    @staticmethod
    def admit_external(
        snapshot: ContactDirectorySnapshot,
        *,
        contact_id: ContactId,
        name: str,
        email: str,
        now: NaiveDatetime,
        avatar_file_id: str | None = None,
    ) -> Contact:
        try:
            normalized_email = NormalizedEmail(email)
        except ValueError as error:
            raise reject(ContactRejectionCode.INVALID_EMAIL) from error
        if any(contact.normalized_email == normalized_email for contact in snapshot.contacts):
            raise reject(ContactRejectionCode.CONFLICTING_IDENTITY)
        return Contact.external(
            contact_id=contact_id,
            tenant_id=snapshot.tenant_id,
            name=name,
            email=email,
            now=now,
            avatar_file_id=avatar_file_id,
        )

    @staticmethod
    def ensure_external_deletable(contact: Contact, tenant_id: TenantId) -> None:
        if not isinstance(contact.owner, ExternalContactOwner):
            raise reject(ContactRejectionCode.INVALID_OWNER)
        if contact.owner.tenant_id != tenant_id:
            raise reject(ContactRejectionCode.CROSS_ORGANIZATION)
