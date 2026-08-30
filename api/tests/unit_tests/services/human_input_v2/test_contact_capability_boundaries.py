"""Behavioral contracts for core and Enterprise Contact capability ownership."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import get_type_hints

from core.human_input_v2.shared import AccountId, ContactId, TenantId
from repositories.human_input_v2.contact import (
    CandidateId,
    Contact,
    ContactIMBindingRepository,
    ContactQuery,
    ContactRepository,
    ContactType,
    EnterpriseContactRepository,
    ExternalContact,
    IMBinding,
    OrganizationCandidate,
    Page,
)
from services.enterprise.human_input_contact_service import EnterpriseContactManagementService
from services.human_input_v2.contact_service import ContactManagementService

_NOW = datetime(2026, 8, 30, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000201")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000301")
_DEFAULT_CONTACT_QUERY = ContactQuery()


class _TenantContactPort:
    def __init__(self, contacts: Sequence[Contact]) -> None:
        self._contacts = tuple(contacts)
        self.tenant_calls: list[TenantId] = []

    def count_contact(self, tenant_id: TenantId, query: ContactQuery = _DEFAULT_CONTACT_QUERY) -> int:
        self.tenant_calls.append(tenant_id)
        return len(self._matching_contacts(query))

    def list_contact(
        self,
        tenant_id: TenantId,
        page: int,
        limit: int,
        query: ContactQuery = _DEFAULT_CONTACT_QUERY,
    ) -> Page[Contact]:
        self.tenant_calls.append(tenant_id)
        contacts = self._matching_contacts(query)
        offset = (page - 1) * limit
        return Page(contacts[offset : offset + limit], page, limit)

    def get_contacts_by_id(self, tenant_id: TenantId, contact_id: ContactId) -> Contact | None:
        self.tenant_calls.append(tenant_id)
        return next((contact for contact in self._contacts if contact.id == contact_id), None)

    def get_contacts_by_ids(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Sequence[Contact]:
        self.tenant_calls.append(tenant_id)
        requested_ids = set(contact_ids)
        return tuple(contact for contact in self._contacts if contact.id in requested_ids)

    def available(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Mapping[ContactId, bool]:
        self.tenant_calls.append(tenant_id)
        available_ids = {contact.id for contact in self._contacts}
        return {contact_id: contact_id in available_ids for contact_id in dict.fromkeys(contact_ids)}

    def save_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> Contact:
        self.tenant_calls.append(tenant_id)
        return Contact(
            id=external_contact.id,
            type=ContactType.EXTERNAL,
            name=external_contact.name,
            email=external_contact.email,
            avatar_file_id=external_contact.avatar_file_id,
            created_at=external_contact.created_at,
        )

    def delete_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> None:
        del external_contact
        self.tenant_calls.append(tenant_id)

    def provision_account_backed_contact(self, account_id: AccountId) -> ContactId:
        del account_id
        return _CONTACT_ID

    def query_contacts_by_email(self, tenant_id: TenantId, emails: Sequence[str]) -> Sequence[Contact]:
        self.tenant_calls.append(tenant_id)
        requested_emails = {email.casefold() for email in emails}
        return tuple(
            contact
            for contact in self._contacts
            if contact.email is not None and contact.email.casefold() in requested_emails
        )

    def _matching_contacts(self, query: ContactQuery) -> tuple[Contact, ...]:
        keyword = query.keyword.strip().casefold()
        return tuple(
            contact
            for contact in self._contacts
            if (query.contact_type is None or contact.type is query.contact_type)
            and (not keyword or keyword in contact.name.casefold() or keyword in (contact.email or "").casefold())
        )


class _BindingReadPort:
    def __init__(self) -> None:
        self.calls: list[tuple[TenantId, tuple[ContactId, ...]]] = []

    def get_im_bindings(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Sequence[IMBinding]:
        self.calls.append((tenant_id, tuple(contact_ids)))
        return ()


class _EnterpriseContactPort:
    def __init__(self, candidate: OrganizationCandidate) -> None:
        self.candidate = candidate
        self.created: list[tuple[TenantId, CandidateId, AccountId]] = []
        self.deleted: list[tuple[TenantId, ContactId]] = []

    def list_organization_candidates(
        self,
        page: int,
        limit: int,
        keyword: str = "",
    ) -> Sequence[OrganizationCandidate]:
        if page != 1 or limit < 1 or keyword.casefold() not in self.candidate.name.casefold():
            return ()
        return (self.candidate,)

    def count_organization_candidates(self, keyword: str = "") -> int:
        return int(keyword.casefold() in self.candidate.name.casefold())

    def create_platform_entry(
        self,
        tenant_id: TenantId,
        candidate_id: CandidateId,
        added_by_account_id: AccountId,
    ) -> None:
        self.created.append((tenant_id, candidate_id, added_by_account_id))

    def delete_platform_entry(self, tenant_id: TenantId, contact_id: ContactId) -> None:
        self.deleted.append((tenant_id, contact_id))


def _platform_contact() -> Contact:
    return Contact(
        id=_CONTACT_ID,
        type=ContactType.PLATFORM,
        name="Platform Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        created_at=_NOW,
    )


def test_public_service_constructors_expose_the_core_and_enterprise_ports_separately() -> None:
    core_hints = get_type_hints(ContactManagementService.__init__)
    enterprise_hints = get_type_hints(EnterpriseContactManagementService.__init__)

    assert core_hints["contact_repository"] is ContactRepository
    assert core_hints["binding_repository"] is ContactIMBindingRepository
    assert EnterpriseContactRepository not in core_hints.values()
    assert enterprise_hints["contacts"] is ContactRepository
    assert enterprise_hints["enterprise_contacts"] is EnterpriseContactRepository


def test_tenant_scoped_core_service_needs_only_contact_and_binding_read_ports() -> None:
    contact = _platform_contact()
    contact_port = _TenantContactPort((contact,))
    binding_port = _BindingReadPort()
    service = ContactManagementService(contact_port, binding_port)

    contact_page, contacts_with_bindings = service.list_contacts(
        _TENANT_ID,
        page=1,
        limit=10,
        query=ContactQuery(keyword="reviewer"),
    )
    selected = service.get_contact(_TENANT_ID, contact.id)
    options = service.get_contact_options(_TENANT_ID, (contact.id,))

    assert contact_page.items == (contact,)
    assert tuple(item.contact for item in contacts_with_bindings) == (contact,)
    assert selected is not None
    assert selected.contact == contact
    assert tuple(options) == (contact,)
    assert contact_port.tenant_calls == [_TENANT_ID, _TENANT_ID, _TENANT_ID]
    assert binding_port.calls == [(_TENANT_ID, (contact.id,)), (_TENANT_ID, (contact.id,))]


def test_candidate_id_round_trips_unchanged_through_the_enterprise_service_port() -> None:
    candidate_id = CandidateId(_CONTACT_ID)
    candidate = OrganizationCandidate(
        id=candidate_id,
        name="Platform Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        created_at=_NOW,
    )
    tenant_port = _TenantContactPort((_platform_contact(),))
    enterprise_port = _EnterpriseContactPort(candidate)
    query_service = ContactManagementService(tenant_port, _BindingReadPort())
    service = EnterpriseContactManagementService(tenant_port, enterprise_port, query_service)

    listed = service.list_organization_candidates(page=1, limit=10, keyword="reviewer")
    count = service.count_organization_candidates("reviewer")
    added = service.add_platform_contacts(_TENANT_ID, (listed[0].id,), _ACCOUNT_ID)
    removed = service.remove_contacts(_TENANT_ID, (listed[0].id,))

    assert count == len(listed) == 1
    assert listed[0].id is candidate_id
    assert enterprise_port.created == [(_TENANT_ID, candidate_id, _ACCOUNT_ID)]
    assert enterprise_port.created[0][1] is candidate_id
    assert tuple(item.contact.id for item in added) == (candidate_id,)
    assert enterprise_port.deleted == [(_TENANT_ID, candidate_id)]
    assert removed == (candidate_id,)
