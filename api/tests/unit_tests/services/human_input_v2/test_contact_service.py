"""Contact option queries include the current effective IM bindings."""

from datetime import datetime
from unittest.mock import create_autospec

from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import ContactId, IMBindingId, IMIdentityId, TenantId
from repositories.human_input_v2.contact import (
    Contact,
    ContactIMBindingRepository,
    ContactRepository,
    ContactType,
    IMBinding,
    Page,
)
from services.human_input_v2.contact_service import ContactManagementService


def test_contact_options_include_effective_bindings_for_listed_and_resolved_contacts() -> None:
    tenant_id = TenantId("workspace-1")
    contact = Contact(
        id=ContactId("contact-1"),
        type=ContactType.WORKSPACE,
        name="Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        created_at=datetime(2026, 11, 1),
    )
    binding = IMBinding(
        id=IMBindingId("binding-1"),
        scope=IMBindingScope.WORKSPACE,
        contact_id=contact.id,
        identity_id=IMIdentityId("identity-1"),
        provider=IMProvider.FEISHU,
    )
    contacts = create_autospec(ContactRepository, instance=True)
    contacts.list_contact.return_value = Page((contact,), page=2, limit=10)
    contacts.get_contacts_by_ids.return_value = (contact,)
    bindings = create_autospec(ContactIMBindingRepository, instance=True)
    bindings.get_im_bindings.return_value = (binding,)
    service = ContactManagementService(contacts, bindings, None)

    page = service.list_contact_options(tenant_id, page=2, limit=10, keyword="reviewer")
    resolved = service.get_contact_options(tenant_id, (contact.id,))

    assert (page.page, page.limit) == (2, 10)
    assert len(page.items) == 1
    assert page.items[0].contact == contact
    assert page.items[0].im_bindings == (binding,)
    assert resolved == page.items
