"""Document downloads through the controller, application service, and SQLite adapter."""

import json
from collections.abc import Iterator
from datetime import datetime
from inspect import unwrap
from io import BytesIO
from os import PathLike
from pathlib import Path
from types import SimpleNamespace
from typing import Never
from unittest.mock import create_autospec
from uuid import UUID
from zipfile import ZipFile

import pytest
from flask import Flask, Response, send_file
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from controllers.console.datasets import datasets_document as controller
from extensions.storage.storage_type import StorageType
from machinery.context import RequestContext
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.errors.document import DocumentSourceNotFoundError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DatasetDocumentApplicationService

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
DOC_ID = str(UUID(int=1))
FILE_ID = str(UUID(int=2))


def _document(**values: object) -> Document:
    return Document(
        **{
            "id": DOC_ID,
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "position": 1,
            "data_source_type": "upload_file",
            "data_source_info": json.dumps({"upload_file_id": FILE_ID}),
            "batch": "batch-1",
            "name": "document.txt",
            "created_from": "web",
            "created_by": "actor-1",
            **values,
        }
    )


@pytest.fixture(autouse=True)
def downloads(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> DatasetDocumentApplicationService:
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id="dataset-1", tenant_id="tenant-1", name="Dataset", created_by="actor-1"))
        session.add(_document())
        upload = UploadFile(
            tenant_id="tenant-1",
            storage_type=StorageType.LOCAL,
            key="key-1",
            name="document.txt",
            size=5,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="actor-1",
            created_at=datetime(2024, 1, 1),
            used=False,
        )
        upload.id = FILE_ID
        session.add(upload)
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset("dataset-1", "tenant-1")
    documents = DatasetDocumentApplicationService(
        dataset_access=access,
        operations=SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory),
        metadata_schema={},
    )
    monkeypatch.setattr(
        controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(documents=documents))
    )
    return documents


def test_document_download_returns_signed_url(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.knowledge import dataset_service

    signed: list[dict[str, object]] = []

    def sign(**kwargs: object) -> str:
        signed.append(kwargs)
        return "https://files.example/download"

    monkeypatch.setattr(dataset_service.file_helpers, "get_signed_file_url", sign)
    with app.test_request_context("/"):
        result = unwrap(controller.DocumentDownloadApi.get)(
            controller.DocumentDownloadApi(), CONTEXT, "dataset-1", DOC_ID
        )
    assert result == {"url": "https://files.example/download"}
    assert signed == [{"upload_file_id": FILE_ID, "as_attachment": True}]


@pytest.mark.parametrize(
    ("values", "expected_error"),
    [
        ({"data_source_type": "website_crawl"}, DocumentSourceNotFoundError),
        ({"data_source_info": "{}"}, DocumentSourceNotFoundError),
        ({"data_source_info": json.dumps({"upload_file_id": "missing"})}, DocumentSourceNotFoundError),
        ({"tenant_id": "foreign"}, NotFound),
        ({"dataset_id": "foreign"}, NotFound),
    ],
)
def test_invalid_or_foreign_document_is_not_downloadable(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
    expected_error: type[BaseException],
) -> None:
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, DOC_ID)
        assert document is not None
        for key, value in values.items():
            setattr(document, key, value)
    with app.test_request_context("/"), pytest.raises(expected_error):
        unwrap(controller.DocumentDownloadApi.get)(controller.DocumentDownloadApi(), CONTEXT, "dataset-1", DOC_ID)


def test_cross_tenant_upload_file_is_not_signed(app: Flask, sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        upload = session.get(UploadFile, FILE_ID)
        assert upload is not None
        upload.tenant_id = "foreign"
    with app.test_request_context("/"), pytest.raises(DocumentSourceNotFoundError):
        unwrap(controller.DocumentDownloadApi.get)(controller.DocumentDownloadApi(), CONTEXT, "dataset-1", DOC_ID)


def test_zip_is_readable_and_cleanup_waits_for_response_close(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    from services import file_service

    paths: list[Path] = []
    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    def load(key: str, *, stream: bool) -> Iterator[bytes]:
        assert not checked_out, "storage I/O must run after the read transaction closes"
        assert key == "key-1"
        assert stream is True
        return iter([b"hello"])

    def send(path: str | PathLike[str], *, mimetype: str, as_attachment: bool, download_name: str) -> Response:
        paths.append(Path(path))
        return send_file(path, mimetype=mimetype, as_attachment=as_attachment, download_name=download_name)

    monkeypatch.setattr(file_service.storage, "load", load)
    monkeypatch.setattr(controller, "send_file", send)
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        with app.test_request_context("/", json={"document_ids": [DOC_ID]}):
            response = unwrap(controller.DocumentBatchDownloadZipApi.post)(
                controller.DocumentBatchDownloadZipApi(), CONTEXT, "dataset-1"
            )
            assert paths[0].exists()
            response.direct_passthrough = False
            with ZipFile(BytesIO(response.get_data())) as archive:
                assert archive.read("document.txt") == b"hello"
            response.close()
        assert not paths[0].exists()
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_zip_cleanup_when_response_creation_fails(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from services import file_service

    paths: list[Path] = []
    monkeypatch.setattr(file_service.storage, "load", lambda *_args, **_kwargs: iter([b"hello"]))

    def fail_send(path: str | PathLike[str], **_kwargs: object) -> Never:
        paths.append(Path(path))
        raise RuntimeError("response failed")

    monkeypatch.setattr(controller, "send_file", fail_send)
    with (
        app.test_request_context("/", json={"document_ids": [DOC_ID]}),
        pytest.raises(RuntimeError, match="response failed"),
    ):
        unwrap(controller.DocumentBatchDownloadZipApi.post)(
            controller.DocumentBatchDownloadZipApi(), CONTEXT, "dataset-1"
        )
    assert paths
    assert not paths[0].exists()


def test_zip_rejects_non_upload_document(app: Flask, sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, DOC_ID)
        assert document is not None
        document.data_source_type = "website_crawl"
    with app.test_request_context("/", json={"document_ids": [DOC_ID]}), pytest.raises(DocumentSourceNotFoundError):
        unwrap(controller.DocumentBatchDownloadZipApi.post)(
            controller.DocumentBatchDownloadZipApi(), CONTEXT, "dataset-1"
        )
