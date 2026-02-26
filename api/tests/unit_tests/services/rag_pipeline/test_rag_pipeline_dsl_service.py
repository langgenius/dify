from unittest.mock import Mock

import pytest

from services.rag_pipeline.rag_pipeline_dsl_service import (
    ImportStatus,
    RagPipelineDslService,
    _check_version_compatibility,
)


@pytest.mark.parametrize(
    ("imported_version", "expected_status"),
    [
        ("invalid", ImportStatus.FAILED),
        ("1.0.0", ImportStatus.PENDING),
        ("0.0.9", ImportStatus.COMPLETED_WITH_WARNINGS),
        ("0.1.0", ImportStatus.COMPLETED),
    ],
)
def test_check_version_compatibility(imported_version: str, expected_status: ImportStatus) -> None:
    assert _check_version_compatibility(imported_version) == expected_status


def test_encrypt_decrypt_dataset_id_roundtrip() -> None:
    service = RagPipelineDslService(session=Mock())

    encrypted = service.encrypt_dataset_id("dataset-1", "tenant-1")
    decrypted = service.decrypt_dataset_id(encrypted, "tenant-1")

    assert decrypted == "dataset-1"


def test_decrypt_dataset_id_returns_none_for_invalid_payload() -> None:
    service = RagPipelineDslService(session=Mock())

    result = service.decrypt_dataset_id("not-base64", "tenant-1")

    assert result is None


def test_get_leaked_dependencies_returns_empty_list_for_empty_input() -> None:
    result = RagPipelineDslService.get_leaked_dependencies("tenant-1", [])

    assert result == []


def test_get_leaked_dependencies_delegates_to_analysis_service(mocker) -> None:
    expected = [Mock()]
    get_leaked_mock = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.get_leaked_dependencies",
        return_value=expected,
    )

    dependency = Mock()
    result = RagPipelineDslService.get_leaked_dependencies("tenant-1", [dependency])

    assert result == expected
    get_leaked_mock.assert_called_once_with(tenant_id="tenant-1", dependencies=[dependency])
