"""Unit tests for HITL human input file upload endpoints."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

import controllers.web.human_input_file_upload as upload_module
from controllers.common.errors import NoFileUploadedError
from controllers.web.human_input_file_upload import (
    HumanInputFileUploadApi,
    InvalidUploadTokenForbiddenError,
    InvalidUploadTokenUnauthorizedError,
)


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _upload_context() -> SimpleNamespace:
    return SimpleNamespace(
        form_id="form-1",
        upload_token_id="token-row-1",
        owner=SimpleNamespace(id="owner-1", current_tenant_id="tenant-1"),
    )


def _upload_file() -> SimpleNamespace:
    return SimpleNamespace(
        id="file-1",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by="end-user-1",
        created_at=datetime(2024, 1, 1),
        tenant_id="tenant-1",
        source_url="signed-source-url",
    )


def _patch_upload_service(monkeypatch: pytest.MonkeyPatch, service: MagicMock) -> tuple[MagicMock, dict[str, object]]:
    workflow_run_repository = MagicMock()
    repo_factory = MagicMock(return_value=workflow_run_repository)
    captured: dict[str, object] = {}

    def _service_factory(session_factory, workflow_run_repository):
        captured["session_factory"] = session_factory
        captured["workflow_run_repository"] = workflow_run_repository
        return service

    monkeypatch.setattr(
        upload_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        repo_factory,
    )
    monkeypatch.setattr(upload_module, "HumanInputFileUploadService", _service_factory)
    return repo_factory, captured


def test_human_input_file_upload_route_uses_unified_path() -> None:
    urls = {
        url for _resource, resource_urls, _route_doc, _kwargs in upload_module.web_ns.resources for url in resource_urls
    }

    assert "/human-input-forms/files" in urls
    assert "/form/human_input/files/upload" not in urls
    assert "/form/human_input/files/remote-upload" not in urls


def test_local_upload_requires_authorization_before_reading_files(app: Flask) -> None:
    data = {"file": (BytesIO(b"content"), "sample.txt")}

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        data=data,
        content_type="multipart/form-data",
    ):
        with pytest.raises(InvalidUploadTokenUnauthorizedError):
            HumanInputFileUploadApi().post()


def test_local_upload_ignores_source_and_records_form_file_link(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    repo_factory, captured = _patch_upload_service(monkeypatch, service)

    file_service = MagicMock()
    file_service.upload_file.return_value = _upload_file()
    file_service_cls = MagicMock(return_value=file_service)
    monkeypatch.setattr(upload_module, "FileService", file_service_cls)
    monkeypatch.setattr(upload_module, "db", SimpleNamespace(engine=object()))

    data = {
        "file": (BytesIO(b"content"), "sample.txt"),
        "source": "datasets",
    }
    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "bearer hitl_upload_token-1"},
        data=data,
        content_type="multipart/form-data",
    ):
        result, status = HumanInputFileUploadApi().post()

    assert status == 201
    assert result["id"] == "file-1"
    file_service.upload_file.assert_called_once()
    assert file_service.upload_file.call_args.kwargs["source"] is None
    assert file_service.upload_file.call_args.kwargs["user"].id == "owner-1"
    repo_factory.assert_called_once()
    assert captured["workflow_run_repository"] is repo_factory.return_value
    service.record_upload_file.assert_called_once_with(
        context=service.validate_upload_token.return_value,
        file_id="file-1",
    )


def test_local_upload_missing_file_raises_after_valid_token(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    _patch_upload_service(monkeypatch, service)
    monkeypatch.setattr(upload_module, "db", SimpleNamespace(engine=object()))

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "bearer hitl_upload_token-1"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(NoFileUploadedError):
            HumanInputFileUploadApi().post()

    service.validate_upload_token.assert_called_once_with("hitl_upload_token-1")


def test_remote_upload_validates_token_before_fetching_remote_url(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.side_effect = InvalidUploadTokenForbiddenError()
    _patch_upload_service(monkeypatch, service)
    monkeypatch.setattr(upload_module, "db", SimpleNamespace(engine=object()))
    ssrf_proxy = MagicMock()
    monkeypatch.setattr(upload_module, "ssrf_proxy", ssrf_proxy)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"url": "https://example.com/file.txt"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(InvalidUploadTokenForbiddenError):
            HumanInputFileUploadApi().post()

    ssrf_proxy.head.assert_not_called()
    ssrf_proxy.get.assert_not_called()


def test_remote_upload_records_form_file_link(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    _patch_upload_service(monkeypatch, service)
    monkeypatch.setattr(upload_module, "db", SimpleNamespace(engine=object()))

    response = MagicMock()
    response.status_code = 200
    response.content = b"remote"
    response.request.method = "GET"
    ssrf_proxy = MagicMock()
    ssrf_proxy.head.return_value = response
    monkeypatch.setattr(upload_module, "ssrf_proxy", ssrf_proxy)
    monkeypatch.setattr(
        upload_module.helpers,
        "guess_file_info_from_response",
        lambda _response: SimpleNamespace(filename="sample.txt", extension="txt", mimetype="text/plain", size=6),
    )

    file_service = MagicMock()
    file_service.upload_file.return_value = _upload_file()
    file_service_cls = MagicMock(return_value=file_service)
    file_service_cls.is_file_size_within_limit.return_value = True
    monkeypatch.setattr(upload_module, "FileService", file_service_cls)
    monkeypatch.setattr(
        upload_module.file_helpers,
        "get_signed_file_url",
        lambda upload_file_id: f"signed:{upload_file_id}",
    )

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"url": "https://example.com/file.txt"},
        content_type="multipart/form-data",
    ):
        result, status = HumanInputFileUploadApi().post()

    assert status == 201
    assert result["url"] == "signed:file-1"
    file_service.upload_file.assert_called_once()
    assert file_service.upload_file.call_args.kwargs["source_url"] == "https://example.com/file.txt"
    assert file_service.upload_file.call_args.kwargs["user"].id == "owner-1"
    service.record_upload_file.assert_called_once_with(
        context=service.validate_upload_token.return_value,
        file_id="file-1",
    )
