import base64
import json

import pytest

from core.workflow.file_reference import (
    FileReference,
    build_file_reference,
    is_canonical_file_reference,
    parse_file_reference,
    resolve_file_record_id,
)


def _encoded_reference(payload: object) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{encoded}"


@pytest.mark.parametrize(
    "reference",
    [
        "dify-file-ref:W10=",  # []
        _encoded_reference(None),
        _encoded_reference("record-id"),
        _encoded_reference(1),
        _encoded_reference({}),
        _encoded_reference({"record_id": None}),
        _encoded_reference({"record_id": ""}),
        _encoded_reference({"record_id": ["record-id"]}),
        "dify-file-ref:not-base64",
        "dify-file-ref:bm90LWpzb24=",  # not-json
        "dify-file-ref:/w==",  # invalid UTF-8
        f"{build_file_reference(record_id='record-id')}!",  # valid payload plus invalid base64 character
    ],
)
def test_malformed_canonical_references_do_not_resolve_file_identity(reference: str) -> None:
    assert parse_file_reference(reference) is None
    assert resolve_file_record_id(reference) is None
    assert is_canonical_file_reference(reference) is False


def test_historical_raw_id_remains_compatible() -> None:
    assert parse_file_reference("historical-file-id") == FileReference(record_id="historical-file-id")
    assert resolve_file_record_id("historical-file-id") == "historical-file-id"
    assert is_canonical_file_reference("historical-file-id") is False


@pytest.mark.parametrize("storage_key", [None, 42])
def test_historical_invalid_storage_key_does_not_hide_valid_record_id(storage_key: object) -> None:
    reference = _encoded_reference({"record_id": "record-id", "storage_key": storage_key})

    assert parse_file_reference(reference) == FileReference(record_id="record-id")
    assert resolve_file_record_id(reference) == "record-id"
    assert is_canonical_file_reference(reference) is True


def test_valid_canonical_reference_preserves_record_and_storage_key() -> None:
    reference = build_file_reference(record_id="record-id", storage_key="files/key")

    assert parse_file_reference(reference) == FileReference(record_id="record-id", storage_key="files/key")
    assert resolve_file_record_id(reference) == "record-id"
    assert is_canonical_file_reference(reference) is True
