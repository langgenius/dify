"""Contact management and Platform operations share one Contact repository."""

from datetime import datetime
from unittest.mock import create_autospec

import pytest

from core.human_input_v2.shared import AccountId, ContactId, DeploymentScope, DirectoryScope, TenantId, WorkspaceScope
from repositories.human_input_v2.contact import (
    Contact,
    ContactIMBindingRepository,
    ContactQuery,
    ContactRepository,
    ContactType,
    OrganizationContact,
    Page,
)
from services.enterprise.human_input_contact_service import EnterpriseContactManagementService
from services.human_input_v2.contact_service import ContactManagementService

_NOW = datetime(2026, 8, 30, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000201")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000301")


def _workspace_contact() -> Contact:
    return Contact(_CONTACT_ID, ContactType.PLATFORM, "Reviewer", "reviewer@example.com", None, _NOW)


def _organization_contact() -> OrganizationContact:
    return OrganizationContact(
        _CONTACT_ID,
        "Reviewer",
        "reviewer@example.com",
        None,
        _NOW,
        datetime(2020, 1, 1),
    )


@pytest.mark.parametrize("organization_scope", [WorkspaceScope(_TENANT_ID), DeploymentScope()])
def test_one_service_queries_both_directories_without_additional_contact_capabilities(
    organization_scope: DirectoryScope,
) -> None:
    repository = create_autospec(ContactRepository, instance=True)
    workspace = _workspace_contact()
    organization = _organization_contact()
    repository.list_contact.return_value = Page((workspace,), 1, 10)
    repository.get_contacts_by_id.return_value = workspace
    repository.get_contacts_by_ids.return_value = (workspace,)
    repository.list_organization_contacts.return_value = (organization,)
    repository.count_organization_contacts.return_value = 1
    repository.get_organization_contact.return_value = organization
    bindings = create_autospec(ContactIMBindingRepository, instance=True)
    bindings.get_im_bindings.return_value = ()
    bindings.get_organization_im_bindings.return_value = ()
    service = ContactManagementService(repository, bindings, None)

    page, listed = service.list_contacts(_TENANT_ID, page=1, limit=10, query=ContactQuery())
    selected = service.get_contact(_TENANT_ID, _CONTACT_ID)
    options = service.get_contact_options(_TENANT_ID, (_CONTACT_ID,))
    organization_page = service.list_organization_contacts(organization_scope, page=1, limit=10, keyword="reviewer")
    details = service.get_organization_contact_details(organization_scope, _CONTACT_ID)

    assert page.items == (workspace,)
    assert selected is not None
    assert selected.contact == workspace
    assert listed == options == (selected,)
    assert not selected.im_bindings
    assert tuple(item.contact for item in organization_page.items) == (organization,)
    assert service.count_organization_contacts(organization_scope, "reviewer") == 1
    assert details is not None
    assert details.contact.contact.id == selected.contact.id
    assert details.contact.contact.joined_at == datetime(2020, 1, 1)
    assert not details.contact.im_bindings
    assert not details.im_binding_details


def test_platform_candidate_selection_preserves_the_shared_contact_id() -> None:
    repository = create_autospec(ContactRepository, instance=True)
    organization = _organization_contact()
    repository.list_organization_contacts.return_value = (organization,)
    repository.count_organization_contacts.return_value = 1
    repository.get_contacts_by_ids.return_value = (_workspace_contact(),)
    bindings = create_autospec(ContactIMBindingRepository, instance=True)
    bindings.get_im_bindings.return_value = ()
    queries = ContactManagementService(repository, bindings, None)
    service = EnterpriseContactManagementService(repository, queries)

    listed = service.list_organization_candidates(page=1, limit=10, keyword="reviewer")
    count = service.count_organization_candidates("reviewer")
    added = service.add_platform_contacts(_TENANT_ID, (listed[0].id,), _ACCOUNT_ID)
    removed = service.remove_contacts(_TENANT_ID, (listed[0].id,))

    assert listed == (organization,)
    assert count == 1
    assert tuple(item.contact.id for item in added) == (_CONTACT_ID,)
    assert removed == (_CONTACT_ID,)
    repository.create_platform_entry.assert_called_once_with(_TENANT_ID, _CONTACT_ID, _ACCOUNT_ID)
    repository.delete_platform_entry.assert_called_once_with(_TENANT_ID, _CONTACT_ID)
