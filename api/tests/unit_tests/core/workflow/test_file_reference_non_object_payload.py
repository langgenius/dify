from __future__ import annotations

import base64
import json

import pytest
from pydantic import ValidationError

from core.plugin.entities.request import RequestDownloadFileMapping
from core.workflow.file_reference import (
    build_file_reference,
    is_canonical_file_reference,
    parse_file_reference,
    resolve_file_record_id,
)


def _canonical_with_payload(payload: object) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    return f"dify-file-ref:{encoded}"


def test_valid_canonical_reference_round_trips() -> None:
    reference = build_file_reference(record_id="record-1", storage_key="storage-1")

    parsed = parse_file_reference(reference)

    assert parsed is not None
    assert parsed.record_id == "record-1"
    assert parsed.storage_key == "storage-1"
    assert is_canonical_file_reference(reference) is True
    assert resolve_file_record_id(reference) == "record-1"


def test_raw_record_id_stays_lenient() -> None:
    parsed = parse_file_reference("raw-record-id")

    assert parsed is not None
    assert parsed.record_id == "raw-record-id"
    assert is_canonical_file_reference("raw-record-id") is False


@pytest.mark.parametrize(
    "reference",
    [
        "dify-file-ref:%%%not-base64%%%",
        "dify-file-ref:" + base64.urlsafe_b64encode(b"not json").decode(),
    ],
)
def test_malformed_encoded_payload_falls_back_to_raw_reference(reference: str) -> None:
    parsed = parse_file_reference(reference)

    assert parsed is not None
    assert parsed.record_id == reference
    assert is_canonical_file_reference(reference) is False


@pytest.mark.parametrize("payload", [[], None, "abc", 3, [{"record_id": "record-1"}]])
def test_non_object_payload_falls_back_to_raw_reference(payload: object) -> None:
    reference = _canonical_with_payload(payload)

    parsed = parse_file_reference(reference)

    assert parsed is not None
    assert parsed.record_id == reference
    assert parsed.storage_key is None
    assert is_canonical_file_reference(reference) is False
    assert resolve_file_record_id(reference) == reference


def test_download_mapping_rejects_non_object_payload_with_validation_error() -> None:
    reference = _canonical_with_payload([])

    with pytest.raises(ValidationError):
        RequestDownloadFileMapping.model_validate({"transfer_method": "local_file", "reference": reference})
