"""Contact management with named workspace and Organization operations.

Repositories use the caller's Session. Organization binding mutations require
a locked current Channel and complete inside the caller-owned transaction.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import NaiveDatetime

from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode
from core.human_input_v2.shared import ContactId, DirectoryScope, IMBindingId, IMIdentityId, TenantId
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.contact import (
    Contact,
    ContactIMBindingRepository,
    ContactQuery,
    ContactRepository,
    ContactType,
    ExternalContact,
    IMBinding,
    OrganizationContact,
    Page,
)
from repositories.human_input_v2.im_binding_repository import (
    IMBindingAssignment,
    IMBindingConflictError,
    IMBindingIdentityNotFoundError,
    IMBindingRepository,
)
from repositories.human_input_v2.im_identity_repository import IMIdentity, IMIdentityRepository


@dataclass(frozen=True, slots=True)
class ContactWithIMBindings[T: Contact | OrganizationContact = Contact]:
    contact: T
    im_bindings: tuple[IMBinding, ...]


@dataclass(frozen=True, slots=True)
class IMBindingDetail:
    binding: IMBinding
    identity: IMIdentity


@dataclass(frozen=True, slots=True)
class ContactDetails[T: Contact | OrganizationContact = Contact]:
    contact: ContactWithIMBindings[T]
    im_binding_details: tuple[IMBindingDetail, ...]


class ContactManagementService:
    """Query Workspace and Organization Directories using shared binding projections.

    Workspace visibility is evaluated separately from Organization admission:
    External Contacts belong only to their owning Workspace Directory. Organization
    queries share one Contact repository. Any configured Channel must belong to
    the same resolved Organization. Commands use the caller's transaction.
    """

    def __init__(
        self,
        contact_repository: ContactRepository,
        binding_repository: ContactIMBindingRepository,
        identity_repository: IMIdentityRepository | None,
        *,
        organization_bindings: IMBindingRepository | None = None,
    ) -> None:
        """Bind repositories to one Session and resolved Channel.

        Both directories use the same Contact repository in every edition.
        A None identity or Organization binding port means no Channel is configured.
        Directory reads remain available; deployment composition rejects an absent
        Channel before binding commands.
        """
        self._contacts = contact_repository
        self._bindings = binding_repository
        self._identities = identity_repository
        self._organization_bindings = organization_bindings

    def list_contacts(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        query: ContactQuery,
    ) -> tuple[Page[Contact], tuple[ContactWithIMBindings, ...]]:
        """Require a workspace and validated filters; return its Workspace Directory with effective bindings."""
        contact_page = self._contacts.list_contact(tenant_id, page, limit, query)
        return contact_page, self._with_bindings(tenant_id, contact_page.items)

    def count_contacts(self, tenant_id: TenantId, query: ContactQuery) -> int:
        """Require the list's workspace and filters; count the same Workspace Directory entries."""
        return self._contacts.count_contact(tenant_id, query)

    def get_contact(self, tenant_id: TenantId, contact_id: ContactId) -> ContactWithIMBindings | None:
        """Require a workspace; return its current Workspace Directory entry and effective bindings or None."""
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

    def get_contact_details(self, tenant_id: TenantId, contact_id: ContactId) -> ContactDetails | None:
        contact = self.get_contact(tenant_id, contact_id)
        if contact is None:
            return None
        return self._with_binding_details(contact)

    def list_organization_contacts(
        self,
        organization_scope: DirectoryScope,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Page[ContactWithIMBindings[OrganizationContact]]:
        """Require validated pagination; read available Account Contacts and only Organization defaults."""
        contacts = tuple(self._contacts.list_organization_contacts(organization_scope, page, limit, keyword))
        return Page(self._with_organization_bindings(contacts), page, limit)

    def count_organization_contacts(self, organization_scope: DirectoryScope, keyword: str) -> int:
        """Require the list's keyword; count the same available Organization Contacts."""
        return self._contacts.count_organization_contacts(organization_scope, keyword)

    def _get_organization_contact(
        self,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
    ) -> ContactWithIMBindings[OrganizationContact] | None:
        """Require a resolved Organization; read its Contact/default without visibility projection or repair."""
        contact = self._contacts.get_organization_contact(organization_scope, contact_id)
        return self._with_organization_bindings((contact,))[0] if contact is not None else None

    def get_organization_contact_details(
        self,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
    ) -> ContactDetails[OrganizationContact] | None:
        """Require an Account-backed ID; resolve current default identity details through the shared projection."""
        contact = self._get_organization_contact(organization_scope, contact_id)
        return self._with_binding_details(contact) if contact is not None else None

    def set_organization_im_binding(
        self,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
        identity_id: IMIdentityId,
    ) -> ContactWithIMBindings[OrganizationContact]:
        """Require a locked Channel; replace defaults atomically and preserve identical IDs and overrides."""
        bindings = self._organization_binding_repository()
        contact = self._require_organization_contact(organization_scope, contact_id)
        try:
            bindings.replace(IMBindingAssignment(contact_id, identity_id, naive_utc_now()), bound_by_account_id=None)
        except IMBindingIdentityNotFoundError:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.IDENTITY_NOT_FOUND, "IM Identity was not found"
            ) from None
        except IMBindingConflictError:
            raise IMBindingCommandError(IMBindingCommandErrorCode.BINDING_CONFLICT, "IM Binding conflicts") from None
        return self._with_organization_bindings((contact,))[0]

    def delete_organization_im_binding(self, organization_scope: DirectoryScope, contact_id: ContactId) -> IMBindingId:
        """Require a locked Channel; remove the current available Contact's default and return its actual ID."""
        bindings = self._organization_binding_repository()
        self._require_organization_contact(organization_scope, contact_id)
        current = self._bindings.get_organization_im_bindings((contact_id,))
        if not current:
            raise IMBindingCommandError(IMBindingCommandErrorCode.BINDING_NOT_FOUND, "IM Binding was not found")
        binding = current[0]
        bindings.delete(binding.id, expected_identity_id=binding.identity_id)
        return binding.id

    def _require_organization_contact(
        self,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
    ) -> OrganizationContact:
        """Require a caller transaction; lock current Account availability or reject the command."""
        contact = self._contacts.get_organization_contact(organization_scope, contact_id, for_update=True)
        if contact is None:
            raise IMBindingCommandError(IMBindingCommandErrorCode.CONTACT_NOT_FOUND, "Contact was not found")
        return contact

    def _organization_binding_repository(self) -> IMBindingRepository:
        """Require a configured, locked Channel; return its default-binding write capability."""
        if self._organization_bindings is None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED, "IM Channel is not configured"
            )
        return self._organization_bindings

    def _with_binding_details[T: Contact | OrganizationContact](
        self,
        contact: ContactWithIMBindings[T],
    ) -> ContactDetails[T]:
        """Require a scoped Contact projection; resolve its identities without changing the binding scope."""
        if not contact.im_bindings:
            return ContactDetails(contact, ())
        if self._identities is None:
            raise TypeError("An identity repository is required to resolve IM bindings")
        identities = self._identities.get_many(tuple(binding.identity_id for binding in contact.im_bindings))
        identities_by_id = {identity.id: identity for identity in identities}
        details: list[IMBindingDetail] = []
        for binding in contact.im_bindings:
            identity = identities_by_id.get(binding.identity_id)
            if identity is None:
                raise TypeError(f"IM binding {binding.id} references a missing identity {binding.identity_id}")
            details.append(IMBindingDetail(binding, identity))
        return ContactDetails(contact, tuple(details))

    def list_contact_options(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Page[ContactWithIMBindings]:
        contact_page = self._contacts.list_contact(
            tenant_id,
            page,
            limit,
            ContactQuery(keyword=keyword),
        )
        return Page(self._with_bindings(tenant_id, contact_page.items), contact_page.page, contact_page.limit)

    def get_contact_options(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[ContactWithIMBindings, ...]:
        return self._with_bindings(tenant_id, self._contacts.get_contacts_by_ids(tenant_id, contact_ids))

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
        return self._attach_bindings(contacts, bindings)

    def _with_organization_bindings(
        self,
        contacts: Sequence[OrganizationContact],
    ) -> tuple[ContactWithIMBindings[OrganizationContact], ...]:
        bindings = self._bindings.get_organization_im_bindings([contact.id for contact in contacts])
        return self._attach_bindings(contacts, bindings)

    @staticmethod
    def _attach_bindings[T: Contact | OrganizationContact](
        contacts: Sequence[T],
        bindings: Sequence[IMBinding],
    ) -> tuple[ContactWithIMBindings[T], ...]:
        """Require already-scoped values; attach their bindings without querying or changing scope."""
        bindings_by_contact: dict[ContactId, list[IMBinding]] = {}
        for binding in bindings:
            bindings_by_contact.setdefault(binding.contact_id, []).append(binding)
        return tuple(
            ContactWithIMBindings(contact, tuple(bindings_by_contact.get(contact.id, ()))) for contact in contacts
        )


__all__ = ["ContactManagementService", "ContactWithIMBindings"]
