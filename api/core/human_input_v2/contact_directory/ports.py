"""Aggregate-oriented persistence ports for Contact Directory operations.

Implementations own transactions, owner predicates, locking, mapping, and
rollback. Callers receive domain values and never persistence records.
"""

from typing import Protocol

from core.human_input_v2.shared import AccountId, ContactId, DirectoryScope, TenantId

from .entities import Contact
from .policy import ContactDirectorySnapshot


class ContactDirectoryRepository(Protocol):
    """Persistence contract centered on coherent directory invariants."""

    def load_snapshot(self, tenant_id: TenantId) -> ContactDirectorySnapshot:
        """Load one immutable workspace-scoped directory view."""
        ...

    def save_organization_contact(
        self,
        contact: Contact,
        *,
        organization_scope: DirectoryScope,
    ) -> Contact:
        """Create or update one deployment-owned Organization Contact with a serialized Email claim."""
        ...

    def save_workspace_member_contact(
        self,
        contact: Contact,
        *,
        organization_scope: DirectoryScope,
    ) -> Contact:
        """Create or update one Contact backed by current workspace membership."""
        ...

    def admit_external(self, tenant_id: TenantId, *, name: str, email: str) -> Contact:
        """Atomically admit one External Contact against tenant and configured Organization identities."""
        ...

    def set_platform_availability(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
        *,
        added_by_account_id: AccountId,
        enabled: bool,
    ) -> None:
        """Atomically add or remove one EE Platform allow-list fact."""
        ...

    def hard_delete_external(self, tenant_id: TenantId, contact_id: ContactId) -> None:
        """Delete an External Contact and its IM bindings without retaining an identity tombstone."""
        ...
