"""Download behavior for legacy and pipeline file-backed documents."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from models.dataset import Document
from models.enums import DataSourceType
from models.model import UploadFile
from services.dataset_service import DocumentService


def _document(source_type: DataSourceType, source_info: dict[str, str], *, tenant_id: str = "tenant-1") -> Document:
    return cast(
        Document,
        SimpleNamespace(
            id="doc-1",
            tenant_id=tenant_id,
            dataset_id="dataset-1",
            data_source_type=source_type,
            data_source_info_dict=source_info,
        ),
    )


@pytest.mark.parametrize(
    ("source_type", "source_info"),
    [
        (DataSourceType.UPLOAD_FILE, {"upload_file_id": "file-1"}),
        (DataSourceType.LOCAL_FILE, {"real_file_id": "file-1"}),
        (DataSourceType.LOCAL_FILE, {"related_id": "file-1"}),
        (DataSourceType.LOCAL_FILE, {"reference": "file-1"}),
    ],
)
def test_single_and_zip_download_resolve_tenant_file(source_type: DataSourceType, source_info: dict[str, str]) -> None:
    document = _document(source_type, source_info)
    upload_file = cast(UploadFile, SimpleNamespace(id="file-1"))
    with (
        patch(
            "services.dataset_service.FileService.get_upload_files_by_ids", return_value={"file-1": upload_file}
        ) as files,
        patch("services.dataset_service.DocumentService.get_documents_by_ids", return_value=[document]),
        patch("services.dataset_service.file_helpers.get_signed_file_url", return_value="signed-url") as signed_url,
    ):
        assert DocumentService.get_document_download_url(document) == "signed-url"
        assert DocumentService._get_upload_files_by_document_id_for_zip_download(
            dataset_id=document.dataset_id,
            document_ids=[document.id],
            tenant_id=document.tenant_id,
        ) == {document.id: upload_file}

    signed_url.assert_called_once_with(upload_file_id="file-1", as_attachment=True)
    assert files.call_count == 2
    files.assert_any_call("tenant-1", ["file-1"])


@pytest.mark.parametrize(
    ("source_type", "source_info", "files_by_id"),
    [
        (DataSourceType.LOCAL_FILE, {}, {"file-1": SimpleNamespace(id="file-1")}),
        (DataSourceType.LOCAL_FILE, {"real_file_id": "file-1"}, {}),
        (DataSourceType.NOTION_IMPORT, {"real_file_id": "file-1"}, {"file-1": SimpleNamespace(id="file-1")}),
    ],
)
def test_download_rejects_missing_foreign_or_non_file_source(
    source_type: DataSourceType, source_info: dict[str, str], files_by_id: dict[str, UploadFile]
) -> None:
    document = _document(source_type, source_info)
    with (
        patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value=files_by_id),
        patch("services.dataset_service.DocumentService.get_documents_by_ids", return_value=[document]),
    ):
        with pytest.raises(NotFound):
            DocumentService.get_document_download_url(document)
        with pytest.raises(NotFound):
            DocumentService._get_upload_files_by_document_id_for_zip_download(
                dataset_id=document.dataset_id,
                document_ids=[document.id],
                tenant_id=document.tenant_id,
            )


def test_zip_download_rejects_document_from_another_tenant() -> None:
    document = _document(DataSourceType.LOCAL_FILE, {"real_file_id": "file-1"}, tenant_id="other-tenant")
    with patch("services.dataset_service.DocumentService.get_documents_by_ids", return_value=[document]):
        with pytest.raises(Forbidden):
            DocumentService._get_upload_files_by_document_id_for_zip_download(
                dataset_id=document.dataset_id,
                document_ids=[document.id],
                tenant_id="tenant-1",
            )
