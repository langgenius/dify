import base64

import pytest

from core.workflow.file_reference import (
    FileReference,
    is_canonical_file_reference,
    parse_file_reference,
    resolve_file_record_id,
)


@pytest.mark.parametrize("payload", [b"{", b"\xff"])
def test_malformed_reference_preserves_legacy_record_id(payload: bytes) -> None:
    reference = "dify-file-ref:" + base64.urlsafe_b64encode(payload).decode()

    assert parse_file_reference(reference) == FileReference(record_id=reference)
    assert resolve_file_record_id(reference) == reference
    assert is_canonical_file_reference(reference) is False
