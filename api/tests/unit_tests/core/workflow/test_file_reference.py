import base64

import pytest

from core.workflow.file_reference import FileReference, build_file_reference, parse_file_reference


def test_parse_file_reference_round_trips_canonical_reference() -> None:
    reference = build_file_reference(record_id="file-1", storage_key="files/file-1.png")

    assert parse_file_reference(reference) == FileReference(record_id="file-1", storage_key="files/file-1.png")


@pytest.mark.parametrize(
    "encoded_payload",
    [
        pytest.param("abc", id="invalid-base64"),
        pytest.param(base64.urlsafe_b64encode(b"not json").decode(), id="invalid-json"),
    ],
)
def test_parse_file_reference_falls_back_to_raw_value_for_malformed_payload(encoded_payload: str) -> None:
    reference = f"dify-file-ref:{encoded_payload}"

    assert parse_file_reference(reference) == FileReference(record_id=reference)
