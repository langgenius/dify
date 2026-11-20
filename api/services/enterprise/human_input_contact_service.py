"""Enterprise-only Human Input Contact application capabilities."""

from __future__ import annotations

from collections.abc import Sequence

from core.human_input_v2.shared import AccountId, ContactId, DeploymentScope, TenantId
from repositories.human_input_v2.contact import (
    Contact,
    ContactRepository,
    ContactType,
    ExternalContact,
    OrganizationContact,
)
from services.human_input_v2.contact_service import ContactManagementService, ContactWithIMBindings


class EnterpriseContactManagementService:
    """Own EE candidate and Platform mutations outside core Contact flows."""

    def __init__(
        self,
        contacts: ContactRepository,
        contact_queries: ContactManagementService,
    ) -> None:
        self._contacts = contacts
        self._contact_queries = contact_queries

    def list_organization_candidates(
        self,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Sequence[OrganizationContact]:
        """Require an authorized EE use case; read its Organization Directory for Platform candidates."""
        return self._contacts.list_organization_contacts(DeploymentScope(), page, limit, keyword)

    def count_organization_candidates(self, keyword: str) -> int:
        """Require the candidate list's keyword; count the same Organization Directory entries."""
        return self._contacts.count_organization_contacts(DeploymentScope(), keyword)

    def add_platform_contacts(
        self,
        tenant_id: TenantId,
        candidate_ids: Sequence[ContactId],
        added_by_account_id: AccountId,
    ) -> tuple[ContactWithIMBindings, ...]:
        distinct_ids = tuple(dict.fromkeys(candidate_ids))
        for candidate_id in distinct_ids:
            self._contacts.create_platform_entry(tenant_id, candidate_id, added_by_account_id)
        return self._contact_queries.get_contacts(tenant_id, distinct_ids)

    def remove_contacts(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> tuple[ContactId, ...]:
        distinct_ids = tuple(dict.fromkeys(contact_ids))
        contacts = self._contacts.get_contacts_by_ids(tenant_id, distinct_ids)
        contacts_by_id = {contact.id: contact for contact in contacts}
        if len(contacts_by_id) != len(distinct_ids):
            raise ValueError("one or more Contacts are unavailable")
        for contact_id in distinct_ids:
            contact = contacts_by_id[contact_id]
            if contact.type is ContactType.WORKSPACE:
                raise ValueError("workspace Contacts must be removed through membership management")
            if contact.type is ContactType.PLATFORM:
                self._contacts.delete_platform_entry(tenant_id, contact.id)
            else:
                self._contacts.delete_external_contact(tenant_id, _external_contact(contact))
        return distinct_ids


def _external_contact(contact: Contact) -> ExternalContact:
    if contact.email is None:
        raise RuntimeError("External Contact is missing its required Email")
    return ExternalContact(
        contact.id,
        contact.name,
        contact.email,
        contact.avatar_file_id,
        contact.created_at,
    )


__all__ = ["EnterpriseContactManagementService"]
