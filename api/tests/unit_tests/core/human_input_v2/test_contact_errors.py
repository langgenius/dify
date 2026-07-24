"""Tests for stable Contact Directory rejection contracts."""

from core.human_input_v2.contact_directory import ContactDirectoryError, ContactRejection, ContactRejectionCode


def test_contact_rejection_is_transport_neutral_and_stable() -> None:
    rejection = ContactRejection(ContactRejectionCode.CONFLICTING_IDENTITY)
    error = ContactDirectoryError(rejection)

    assert rejection.to_primitive() == {"reason": "conflicting_identity"}
    assert error.code is ContactRejectionCode.CONFLICTING_IDENTITY
    assert str(error) == "conflicting_identity"
