from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope
from core.app.workflow import file_runtime
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime, bind_dify_workflow_file_runtime
from core.workflow.file_reference import build_file_reference
from extensions.storage.storage_type import StorageType
from graphon.file import File, FileTransferMethod, FileType
from models import ToolFile, UploadFile
from models.base import TypeBase
from models.enums import CreatorUserRole


@pytest.fixture
def file_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind runtime-owned sessions to SQLite with only the two file tables present."""
    tables = [TypeBase.metadata.tables[model.__tablename__] for model in (UploadFile, ToolFile)]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(file_runtime.session_factory, "create_session", session_maker)
    with session_maker() as session:
        yield session


def _persist_upload_file(
    session: Session,
    *,
    file_id: str = "upload-file-id",
    key: str = "canonical-storage-key",
    tenant_id: str = "tenant-id",
    created_by: str = "end-user-id",
) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name="diagram.png",
        size=128,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.END_USER,
        created_by=created_by,
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
        used=False,
    )
    upload_file.id = file_id
    session.add(upload_file)
    session.commit()
    return upload_file


def _persist_tool_file(
    session: Session,
    *,
    file_id: str = "tool-file-id",
    key: str = "tool-storage-key",
) -> ToolFile:
    tool_file = ToolFile(
        user_id="end-user-id",
        tenant_id="tenant-id",
        conversation_id=None,
        file_key=key,
        mimetype="image/png",
        name="diagram.png",
        size=128,
    )
    tool_file.id = file_id
    session.add(tool_file)
    session.commit()
    return tool_file


def _build_file(
    *,
    transfer_method: FileTransferMethod,
    reference: str | None = None,
    remote_url: str | None = None,
    extension: str | None = None,
) -> File:
    return File(
        file_id="file-id",
        file_type=FileType.IMAGE,
        transfer_method=transfer_method,
        reference=reference,
        remote_url=remote_url,
        filename="diagram.png",
        extension=extension,
        mime_type="image/png",
        size=128,
    )


def _build_runtime() -> DifyWorkflowFileRuntime:
    return DifyWorkflowFileRuntime(file_access_controller=DatabaseFileAccessController())


def test_resolve_file_url_returns_remote_url() -> None:
    runtime = _build_runtime()
    file = _build_file(
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/diagram.png",
    )

    assert runtime.resolve_file_url(file=file) == "https://example.com/diagram.png"


def test_resolve_file_url_requires_file_reference() -> None:
    runtime = _build_runtime()
    file = SimpleNamespace(transfer_method=FileTransferMethod.LOCAL_FILE, reference=None)

    with pytest.raises(ValueError, match="Missing file reference"):
        runtime.resolve_file_url(file=file)


def test_resolve_file_url_requires_extension_for_tool_files() -> None:
    runtime = _build_runtime()
    file = _build_file(
        transfer_method=FileTransferMethod.TOOL_FILE,
        reference=build_file_reference(record_id="tool-file-id"),
        extension=None,
    )

    with pytest.raises(ValueError, match="Missing file extension"):
        runtime.resolve_file_url(file=file)


def test_resolve_file_url_uses_tool_signatures_for_tool_and_datasource_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sign_tool_file = MagicMock(return_value="https://signed.example.com/file")
    monkeypatch.setattr(file_runtime, "sign_tool_file", sign_tool_file)
    runtime = _build_runtime()

    tool_file = _build_file(
        transfer_method=FileTransferMethod.TOOL_FILE,
        reference=build_file_reference(record_id="tool-file-id"),
        extension=".png",
    )
    datasource_file = _build_file(
        transfer_method=FileTransferMethod.DATASOURCE_FILE,
        reference=build_file_reference(record_id="datasource-file-id"),
        extension=".png",
    )

    assert runtime.resolve_file_url(file=tool_file) == "https://signed.example.com/file"
    assert runtime.resolve_file_url(file=datasource_file) == "https://signed.example.com/file"
    assert sign_tool_file.call_count == 2


def test_resolve_upload_file_url_signs_internal_urls_and_supports_attachments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("core.app.workflow.file_runtime.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.app.workflow.file_runtime.os.urandom", lambda _: b"\x01" * 16)
    monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr(
        "core.app.workflow.file_runtime.dify_config.INTERNAL_FILES_URL",
        "https://internal.example.com",
    )

    runtime = _build_runtime()
    url = runtime.resolve_upload_file_url(
        upload_file_id="upload-file-id",
        as_attachment=True,
        for_external=False,
    )
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "internal.example.com"
    assert parsed.path == "/files/upload-file-id/file-preview"
    assert query["as_attachment"] == ["true"]
    assert query["timestamp"] == ["1700000000"]


def test_verify_preview_signature_validates_signature_and_expiration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.app.workflow.file_runtime.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.FILES_ACCESS_TIMEOUT", 60)
    runtime = _build_runtime()
    payload = "file-preview|upload-file-id|1700000000|nonce"
    sign = base64.urlsafe_b64encode(hmac.new(b"unit-secret", payload.encode(), hashlib.sha256).digest()).decode()

    assert (
        runtime.verify_preview_signature(
            preview_kind="file",
            file_id="upload-file-id",
            timestamp="1700000000",
            nonce="nonce",
            sign=sign,
        )
        is True
    )
    assert (
        runtime.verify_preview_signature(
            preview_kind="file",
            file_id="upload-file-id",
            timestamp="1700000000",
            nonce="nonce",
            sign="bad-signature",
        )
        is False
    )

    monkeypatch.setattr("core.app.workflow.file_runtime.time.time", lambda: 1700000100)
    assert (
        runtime.verify_preview_signature(
            preview_kind="file",
            file_id="upload-file-id",
            timestamp="1700000000",
            nonce="nonce",
            sign=sign,
        )
        is False
    )


def test_load_file_bytes_returns_bytes_and_rejects_non_bytes(
    monkeypatch: pytest.MonkeyPatch, file_session: Session
) -> None:
    runtime = _build_runtime()
    file = _build_file(
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference=build_file_reference(record_id="upload-file-id"),
    )
    _persist_upload_file(file_session)
    monkeypatch.setattr(file_runtime.storage, "load", lambda *args, **kwargs: b"image-bytes")

    assert runtime.load_file_bytes(file=file) == b"image-bytes"

    monkeypatch.setattr(file_runtime.storage, "load", lambda *args, **kwargs: "not-bytes")
    with pytest.raises(ValueError, match="is not a bytes object"):
        runtime.load_file_bytes(file=file)


def test_resolve_storage_key_ignores_encoded_reference_when_unscoped(file_session: Session) -> None:
    runtime = _build_runtime()
    file = _build_file(
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference=build_file_reference(record_id="upload-file-id", storage_key="tampered-storage-key"),
    )
    _persist_upload_file(file_session)

    assert runtime._resolve_storage_key(file=file) == "canonical-storage-key"


def test_resolve_storage_key_uses_canonical_record_when_scope_is_bound(file_session: Session) -> None:
    upload_file = _persist_upload_file(file_session)
    controller = MagicMock()
    controller.current_scope.return_value = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    controller.get_upload_file.return_value = upload_file
    runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
    file = _build_file(
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference=build_file_reference(record_id="upload-file-id", storage_key="tampered-storage-key"),
    )
    assert runtime._resolve_storage_key(file=file) == "canonical-storage-key"
    controller.get_upload_file.assert_called_once()
    assert isinstance(controller.get_upload_file.call_args.kwargs["session"], Session)
    assert controller.get_upload_file.call_args.kwargs["file_id"] == "upload-file-id"


def test_resolve_upload_file_url_rejects_unauthorized_scoped_access(file_session: Session) -> None:
    controller = MagicMock()
    controller.current_scope.return_value = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    controller.get_upload_file.return_value = None
    runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
    with pytest.raises(ValueError, match="Upload file upload-file-id not found"):
        runtime.resolve_upload_file_url(upload_file_id="upload-file-id")


@pytest.mark.parametrize(
    ("transfer_method", "record_id", "expected_storage_key"),
    [
        (FileTransferMethod.LOCAL_FILE, "upload-file-id", "upload-storage-key"),
        (FileTransferMethod.DATASOURCE_FILE, "upload-file-id", "upload-storage-key"),
        (FileTransferMethod.TOOL_FILE, "tool-file-id", "tool-storage-key"),
    ],
)
def test_resolve_storage_key_loads_database_records(
    file_session: Session,
    transfer_method: FileTransferMethod,
    record_id: str,
    expected_storage_key: str,
) -> None:
    runtime = _build_runtime()
    file = _build_file(
        transfer_method=transfer_method,
        reference=build_file_reference(record_id=record_id),
        extension=".png",
    )
    if transfer_method in {FileTransferMethod.LOCAL_FILE, FileTransferMethod.DATASOURCE_FILE}:
        _persist_upload_file(file_session, key="upload-storage-key")
    else:
        _persist_tool_file(file_session)

    assert runtime._resolve_storage_key(file=file) == expected_storage_key


@pytest.mark.parametrize(
    ("transfer_method", "expected_message"),
    [
        (FileTransferMethod.LOCAL_FILE, "Upload file upload-file-id not found"),
        (FileTransferMethod.TOOL_FILE, "Tool file tool-file-id not found"),
    ],
)
def test_resolve_storage_key_raises_when_records_are_missing(
    file_session: Session,
    transfer_method: FileTransferMethod,
    expected_message: str,
) -> None:
    runtime = _build_runtime()
    record_id = "upload-file-id" if transfer_method == FileTransferMethod.LOCAL_FILE else "tool-file-id"
    file = _build_file(
        transfer_method=transfer_method,
        reference=build_file_reference(record_id=record_id),
        extension=".png",
    )
    with pytest.raises(ValueError, match=expected_message):
        runtime._resolve_storage_key(file=file)


def test_runtime_helper_wrappers_delegate_to_config_and_io(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.MULTIMODAL_SEND_FORMAT", "url")
    runtime = _build_runtime()

    assert runtime.multimodal_send_format == "url"

    with patch.object(
        file_runtime.remote_fetcher.graphon_remote_file_fetcher,
        "get",
        return_value="response",
    ) as mock_get:
        assert runtime.http_get("http://example", follow_redirects=False) == "response"
        mock_get.assert_called_once_with("http://example", follow_redirects=False)

    with patch.object(file_runtime.storage, "load", return_value=b"data") as mock_load:
        assert runtime.storage_load("path", stream=True) == b"data"
        mock_load.assert_called_once_with("path", stream=True)


def test_bind_dify_workflow_file_runtime_registers_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    set_runtime = MagicMock()
    monkeypatch.setattr(file_runtime, "set_workflow_file_runtime", set_runtime)

    bind_dify_workflow_file_runtime()

    set_runtime.assert_called_once()
    assert isinstance(set_runtime.call_args.args[0], DifyWorkflowFileRuntime)
