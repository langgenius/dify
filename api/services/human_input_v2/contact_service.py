"""Application orchestration for workspace Contact management surfaces."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import NaiveDatetime

from core.human_input_v2.shared import ContactId, TenantId
from repositories.human_input_v2.contact import (
    Contact,
    ContactIMBindingRepository,
    ContactQuery,
    ContactRepository,
    ContactType,
    ExternalContact,
    IMBinding,
    Page,
)


@dataclass(frozen=True, slots=True)
class ContactWithIMBindings:
    contact: Contact
    im_bindings: tuple[IMBinding, ...]


class ContactManagementService:
    """Compose Contact and optional binding values without persistence details."""

    def __init__(
        self,
        contact_repository: ContactRepository,
        binding_repository: ContactIMBindingRepository,
    ) -> None:
        self._contacts = contact_repository
        self._bindings = binding_repository

    def list_contacts(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        query: ContactQuery,
    ) -> tuple[Page[Contact], tuple[ContactWithIMBindings, ...]]:
        contact_page = self._contacts.list_contact(tenant_id, page, limit, query)
        return contact_page, self._with_bindings(tenant_id, contact_page.items)

    def count_contacts(self, tenant_id: TenantId, query: ContactQuery) -> int:
        return self._contacts.count_contact(tenant_id, query)

    def get_contact(self, tenant_id: TenantId, contact_id: ContactId) -> ContactWithIMBindings | None:
        contact = self._contacts.get_contacts_by_id(tenant_id, contact_id)
        if contact is None:
            return None
        return self._with_bindings(tenant_id, (contact,))[0]

    def get_contacts(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[ContactWithIMBindings, ...]:
        return self._with_bindings(tenant_id, self._contacts.get_contacts_by_ids(tenant_id, contact_ids))

    def list_contact_options(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Page[Contact]:
        return self._contacts.list_contact(
            tenant_id,
            page,
            limit,
            ContactQuery(keyword=keyword),
        )

    def get_contact_options(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[Contact]:
        return self._contacts.get_contacts_by_ids(tenant_id, contact_ids)

    def create_external_contact(
        self,
        tenant_id: TenantId,
        *,
        contact_id: ContactId,
        name: str,
        email: str,
        avatar_file_id: str | None,
        now: NaiveDatetime,
    ) -> ContactWithIMBindings:
        contact = self._contacts.save_external_contact(
            tenant_id,
            ExternalContact(contact_id, name, email, avatar_file_id, now),
        )
        return ContactWithIMBindings(contact, ())

    def update_external_contact(
        self,
        tenant_id: TenantId,
        external_contact: ExternalContact,
    ) -> ContactWithIMBindings:
        contact = self._contacts.save_external_contact(tenant_id, external_contact)
        return ContactWithIMBindings(contact, ())

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
                raise ValueError("Platform Contacts require the Enterprise Contact capability")
            if contact.email is None:
                raise RuntimeError("External Contact is missing its required Email")
            self._contacts.delete_external_contact(
                tenant_id,
                ExternalContact(
                    contact.id,
                    contact.name,
                    contact.email,
                    contact.avatar_file_id,
                    contact.created_at,
                ),
            )
        return distinct_ids

    def _with_bindings(
        self,
        tenant_id: TenantId,
        contacts: Sequence[Contact],
    ) -> tuple[ContactWithIMBindings, ...]:
        bindings = self._bindings.get_im_bindings(tenant_id, [contact.id for contact in contacts])
        bindings_by_contact: dict[ContactId, list[IMBinding]] = {}
        for binding in bindings:
            bindings_by_contact.setdefault(binding.contact_id, []).append(binding)
        return tuple(
            ContactWithIMBindings(contact, tuple(bindings_by_contact.get(contact.id, ()))) for contact in contacts
        )


__all__ = ["ContactManagementService", "ContactWithIMBindings"]
