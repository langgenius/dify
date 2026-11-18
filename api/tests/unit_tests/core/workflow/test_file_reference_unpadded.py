"""Regression tests for unpadded base64url canonical file references.

RFC 4648 allows base64url output to omit the trailing ``=`` padding, and many
encoders (JWT-style helpers, JS ``btoa`` with padding stripped, values passed
through URLs) do so by default. ``parse_file_reference`` fed the raw reference
to ``urlsafe_b64decode``, which rejects missing padding with a ``binascii.Error``
(a ``ValueError``), so a valid canonical reference was treated as a raw record
id: file attachments stopped resolving and canonical-only checks rejected it.
"""

from core.workflow.file_reference import (
    FileReference,
    build_file_reference,
    is_canonical_file_reference,
    parse_file_reference,
    resolve_file_record_id,
)


def _unpadded_reference(record_id: str) -> str:
    padded = build_file_reference(record_id=record_id)
    assert padded.endswith("=")  # guard: this fixture must exercise omitted padding
    return padded.rstrip("=")


def test_unpadded_base64url_reference_resolves_to_record_id() -> None:
    reference = _unpadded_reference("abc-123")

    assert parse_file_reference(reference) == FileReference(record_id="abc-123")
    assert resolve_file_record_id(reference) == "abc-123"
    assert is_canonical_file_reference(reference) is True


def test_padded_reference_still_resolves() -> None:
    """Regression boundary: normal padded references must be unchanged."""
    reference = build_file_reference(record_id="abc-123", storage_key="store-1")

    assert parse_file_reference(reference) == FileReference(record_id="abc-123", storage_key="store-1")
    assert is_canonical_file_reference(reference) is True


def test_raw_record_id_stays_lenient() -> None:
    """Regression boundary: non-canonical raw ids are not decoded."""
    assert parse_file_reference("raw-record-id") == FileReference(record_id="raw-record-id")
    assert is_canonical_file_reference("raw-record-id") is False


def test_malformed_reference_still_falls_back() -> None:
    """Regression boundary: truly malformed payloads keep the legacy fallback."""
    reference = "dify-file-ref:%%%not-base64%%%"

    assert parse_file_reference(reference) == FileReference(record_id=reference)
    assert is_canonical_file_reference(reference) is False
