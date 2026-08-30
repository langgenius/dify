"""Enterprise-only Human Input Contact application capabilities."""

from __future__ import annotations

from collections.abc import Sequence

from core.human_input_v2.contact import (
    Contact,
    ContactRepository,
    ContactType,
    EnterpriseContactRepository,
    ExternalContact,
    OrganizationCandidate,
)
from core.human_input_v2.shared import AccountId, ContactId, TenantId
from services.human_input_v2.contact_service import ContactManagementService, ContactWithIMBindings

_CANDIDATE_PAGE_LIMIT = 500


class EnterpriseContactManagementService:
    """Own EE candidate and Platform mutations outside core Contact flows."""

    def __init__(
        self,
        contacts: ContactRepository,
        enterprise_contacts: EnterpriseContactRepository,
        contact_queries: ContactManagementService,
    ) -> None:
        self._contacts = contacts
        self._enterprise_contacts = enterprise_contacts
        self._contact_queries = contact_queries

    def list_organization_candidates(
        self,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Sequence[OrganizationCandidate]:
        return self._enterprise_contacts.list_organization_candidates(page, limit, keyword)

    def count_organization_candidates(self, keyword: str) -> int:
        return self._enterprise_contacts.count_organization_candidates(keyword)

    def add_platform_contacts(
        self,
        tenant_id: TenantId,
        candidate_ids: Sequence[ContactId],
        added_by_account_id: AccountId,
    ) -> tuple[ContactWithIMBindings, ...]:
        distinct_ids = tuple(dict.fromkeys(candidate_ids))
        for candidate_id in distinct_ids:
            self._enterprise_contacts.create_platform_entry(tenant_id, candidate_id, added_by_account_id)
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
                self._enterprise_contacts.delete_platform_entry(tenant_id, contact.id)
                continue
            self._contacts.delete_external_contact(tenant_id, _external_contact(contact))
        return distinct_ids


class EnterpriseOrganizationContactReader:
    """Adapt EE Organization candidates for deployment-scoped reconciliation."""

    def __init__(self, contacts: EnterpriseContactRepository) -> None:
        self._contacts = contacts
        self._cached_contacts: tuple[Contact, ...] | None = None

    def list_contacts(self, page: int, limit: int) -> Sequence[Contact]:
        contacts = self._load_contacts()
        offset = (page - 1) * limit
        return contacts[offset : offset + limit]

    def get_contact(self, contact_id: ContactId) -> Contact | None:
        return next((contact for contact in self._load_contacts() if contact.id == contact_id), None)

    def _load_contacts(self) -> tuple[Contact, ...]:
        if self._cached_contacts is not None:
            return self._cached_contacts
        candidates: list[OrganizationCandidate] = []
        page = 1
        while True:
            candidate_page = self._contacts.list_organization_candidates(page, _CANDIDATE_PAGE_LIMIT)
            candidates.extend(candidate_page)
            if len(candidate_page) < _CANDIDATE_PAGE_LIMIT:
                break
            page += 1
        self._cached_contacts = tuple(
            Contact(
                id=candidate.id,
                type=ContactType.WORKSPACE,
                name=candidate.name,
                email=candidate.email,
                avatar_file_id=candidate.avatar_file_id,
                created_at=candidate.created_at,
            )
            for candidate in candidates
        )
        return self._cached_contacts


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


__all__ = ["EnterpriseContactManagementService", "EnterpriseOrganizationContactReader"]
