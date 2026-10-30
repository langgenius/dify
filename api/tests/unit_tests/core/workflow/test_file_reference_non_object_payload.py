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
from core.workflow.nodes.agent_v2.output_type_checker import (
    OutputTypeCheckStatus,
    PerOutputTypeChecker,
)
from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType


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


def test_object_payload_without_valid_record_id_falls_back_to_raw_reference() -> None:
    reference = _canonical_with_payload({"storage_key": "storage-1"})

    parsed = parse_file_reference(reference)

    assert parsed is not None
    assert parsed.record_id == reference
    assert parsed.storage_key is None
    assert is_canonical_file_reference(reference) is False


def test_non_string_storage_key_is_dropped() -> None:
    reference = _canonical_with_payload({"record_id": "record-1", "storage_key": 5})

    parsed = parse_file_reference(reference)

    assert parsed is not None
    assert parsed.record_id == "record-1"
    assert parsed.storage_key is None


@pytest.mark.parametrize("reference", [None, ""])
def test_empty_reference_parses_to_none(reference: str | None) -> None:
    assert parse_file_reference(reference) is None
    assert resolve_file_record_id(reference) is None
    assert is_canonical_file_reference(reference) is False


def test_output_type_checker_reports_non_object_file_payload_as_type_check_failed() -> None:
    class _AcceptingFileValidator:
        def is_accessible_file_mapping(self, *, file_id: str, tenant_id: str, transfer_method: object) -> bool:
            del file_id, tenant_id, transfer_method
            return True

    reference = _canonical_with_payload([])
    outcome = PerOutputTypeChecker(_AcceptingFileValidator()).check(
        declared_outputs=[DeclaredOutputConfig(name="attachment", type=DeclaredOutputType.FILE, required=True)],
        raw_output={"attachment": {"transfer_method": "local_file", "reference": reference}},
        tenant_id="tenant-1",
    )

    result = outcome.by_name()["attachment"]
    assert result.status == OutputTypeCheckStatus.TYPE_CHECK_FAILED
    assert result.reason == "local_file file mapping has invalid canonical reference"
