"""Domain contracts for current Human Input v2 Contact values."""

from dataclasses import FrozenInstanceError, fields
from datetime import datetime

import pytest

from core.human_input_v2.contact import (
    CandidateId,
    Contact,
    ContactQuery,
    ContactType,
    ExternalContact,
    OrganizationCandidate,
    Page,
)
from core.human_input_v2.shared import ContactId

_NOW = datetime(2026, 8, 30, 8)
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000001")


def test_contact_type_has_only_current_contact_classifications() -> None:
    assert [(contact_type.name, contact_type.value) for contact_type in ContactType] == [
        ("WORKSPACE", "workspace"),
        ("PLATFORM", "platform"),
        ("EXTERNAL", "external"),
    ]


def test_candidate_id_is_the_contact_id_type_and_keeps_the_candidate_identity() -> None:
    candidate_id = CandidateId(_CONTACT_ID)
    candidate = OrganizationCandidate(
        id=candidate_id,
        name="Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        created_at=_NOW,
    )

    assert CandidateId is ContactId
    assert candidate.id is candidate_id
    assert ContactId(candidate.id) == _CONTACT_ID


def test_contact_values_are_frozen_slotted_values_with_stable_shapes() -> None:
    contact = Contact(
        id=_CONTACT_ID,
        type=ContactType.WORKSPACE,
        name=" Reviewer ",
        email=" Reviewer@Example.com ",
        avatar_file_id="avatar-1",
        created_at=_NOW,
    )
    external = ExternalContact(
        id=_CONTACT_ID,
        name=" External Reviewer ",
        email=" External@Example.com ",
        avatar_file_id=None,
        created_at=_NOW,
    )
    query = ContactQuery(keyword="reviewer", contact_type=ContactType.EXTERNAL)
    page = Page(items=(contact,), page=2, limit=10)

    assert tuple(field.name for field in fields(Contact)) == (
        "id",
        "type",
        "name",
        "email",
        "avatar_file_id",
        "created_at",
    )
    assert tuple(field.name for field in fields(ExternalContact)) == (
        "id",
        "name",
        "email",
        "avatar_file_id",
        "created_at",
    )
    assert tuple(field.name for field in fields(ContactQuery)) == ("keyword", "contact_type")
    assert tuple(field.name for field in fields(Page)) == ("items", "page", "limit")
    assert contact.name == "Reviewer"
    assert contact.email == "Reviewer@Example.com"
    assert external.name == "External Reviewer"
    assert external.email == "External@Example.com"
    assert query == ContactQuery(keyword="reviewer", contact_type=ContactType.EXTERNAL)
    assert page == Page(items=(contact,), page=2, limit=10)
    assert isinstance(page.items, tuple)
    assert not hasattr(contact, "__dict__")
    assert not hasattr(external, "__dict__")
    assert not hasattr(query, "__dict__")
    assert not hasattr(page, "__dict__")

    with pytest.raises(FrozenInstanceError):
        contact.name = "Changed"
    with pytest.raises(FrozenInstanceError):
        external.email = "changed@example.com"
    with pytest.raises(FrozenInstanceError):
        query.keyword = "changed"
    with pytest.raises(FrozenInstanceError):
        page.page = 3


@pytest.mark.parametrize(
    ("page", "limit", "message"),
    [
        (0, 1, "page must be positive"),
        (-1, 1, "page must be positive"),
        (1, 0, "limit must be positive"),
        (1, -1, "limit must be positive"),
    ],
)
def test_page_rejects_non_positive_boundaries(page: int, limit: int, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        Page[Contact](items=(), page=page, limit=limit)
