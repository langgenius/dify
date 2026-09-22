from collections.abc import Callable, Generator
from functools import partial
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from configs import dify_config
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.models.document import Document
from enums import DeploymentEdition
from models.enums import CreatorUserRole
from models.model import UploadFile
from services import file_service as file_service_module
from services.errors.file import FileNotExistsError
from services.file_service import PREVIEW_WORDS_LIMIT, FileArchiveEntry
from services.file_service_adapters import extract_file_text
from services.file_upload_service import FileUploadResult
from tests.file_service_test_utils import make_file_service


class _Storage:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.data: dict[str, bytes] = {}
        self.events: list[str] = []
        self.delete_error = False
        self.stream_error = False
        self.stream_closed = False

    def record(self, event: str) -> None:
        assert cast(QueuePool, self.engine.pool).checkedout() == 0
        self.events.append(event)

    def save(self, filename: str, data: bytes, /) -> None:
        self.record("save")
        self.data[filename] = data

    def load_once(self, filename: str) -> bytes:
        self.record("load")
        return self.data[filename]

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        self.record("stream")
        try:
            yield self.data[filename]
            if self.stream_error:
                raise OSError("stream failed")
        finally:
            self.stream_closed = True

    def delete(self, filename: str) -> None:
        self.record("delete")
        if self.delete_error:
            raise OSError("delete failed")
        del self.data[filename]

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str:
        self.record("presign")
        assert expires_in == dify_config.FILES_ACCESS_TIMEOUT
        assert content_type == "text/plain"
        return f"https://storage.example.com/{filename}"


def test_file_operations_release_database_before_storage_extraction_and_signing(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    storage = _Storage(sqlite_engine)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    def extract(*, file: FileUploadResult) -> str:
        storage.record("extract")
        assert file.tenant_id == tenant_id
        return "preview" * PREVIEW_WORDS_LIMIT

    def sign(*, upload_file_id: str) -> str:
        storage.record("sign")
        return f"https://files.example.com/{upload_file_id}"

    service = make_file_service(sqlite_session_factory, storage=storage, extract_text=extract, sign_file_url=sign)
    tenant_id = str(uuid4())
    file = service.upload_text("hello", "report.txt", str(uuid4()), tenant_id)

    assert service.get_file_content(file.id) == "hello"
    assert service.get_file_base64(file.id) == "aGVsbG8="
    assert len(service.get_file_preview(file.id, tenant_id)) == PREVIEW_WORDS_LIMIT
    assert service.get_file_presigned_url(file_id=file.id, tenant_id=tenant_id).endswith(file.key)
    assert service.get_icon_url(file.id, tenant_id).endswith(file.id)
    assert storage.events == ["save", "load", "load", "extract", "presign", "sign"]

    with pytest.raises(FileNotExistsError):
        service.get_file_preview(file.id, str(uuid4()))
    with pytest.raises(FileNotExistsError):
        service.get_file_presigned_url(file_id=file.id, tenant_id=str(uuid4()))
    assert storage.events == ["save", "load", "load", "extract", "presign", "sign"]

    service.delete_file(file.id)
    assert storage.events[-1] == "delete"
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, file.id) is None


def test_text_offload_preserves_internal_metadata_without_upload_quota_or_signed_url(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    storage = _Storage(sqlite_engine)
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=0, inner_UPLOAD_FILE_EXTENSION_BLACKLIST="txt")

    def unexpected_sign(*, upload_file_id: str) -> str:
        pytest.fail(f"Internal text offload {upload_file_id} must not sign a public URL")

    service = make_file_service(sqlite_session_factory, storage=storage, sign_file_url=unexpected_sign)
    text = "包含多字节 UTF-8 文本 🚀"
    owner_id, tenant_id = str(uuid4()), str(uuid4())
    file = service.upload_text(text, "a" * 210, owner_id, tenant_id)

    assert isinstance(file, FileUploadResult)
    assert file.name == "a" * 200
    assert file.size == len(text.encode("utf-8"))
    assert storage.data[file.key] == text.encode("utf-8")
    assert file.created_by == file.used_by == owner_id
    assert file.created_by_role == CreatorUserRole.ACCOUNT
    assert file.tenant_id == tenant_id
    assert file.used is True
    assert file.used_at is not None
    assert file.hash is None
    assert file.source_url == ""
    assert file.extension == "txt"
    assert file.mime_type == "text/plain"
    with sqlite_session_factory() as session:
        persisted = session.get(UploadFile, file.id)
        assert persisted is not None
        assert persisted.used is True
        assert persisted.used_by == owner_id
        assert persisted.used_at == file.used_at
        assert persisted.size == file.size
        assert persisted.hash is None
        assert persisted.source_url == ""


def test_storage_delete_failure_preserves_metadata_for_retry(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    storage = _Storage(sqlite_engine)
    service = make_file_service(sqlite_session_factory, storage=storage)
    file = service.upload_text("content", "report.txt", str(uuid4()), str(uuid4()))
    storage.delete_error = True

    with pytest.raises(OSError, match="delete failed"):
        service.delete_file(file.id)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, file.id) is not None
    storage.delete_error = False
    service.delete_file(file.id)
    service.delete_file(file.id)
    assert storage.events == ["save", "delete", "delete"]


def test_zip_removes_partial_tempfile_and_closes_stream_on_read_failure(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    storage = _Storage(sqlite_engine)
    service = make_file_service(sqlite_session_factory, storage=storage)
    file = service.upload_text("content", "report.txt", str(uuid4()), str(uuid4()))
    storage.stream_error = True
    monkeypatch.setattr(file_service_module, "NamedTemporaryFile", partial(NamedTemporaryFile, dir=tmp_path))

    entries = [FileArchiveEntry(name=file.name, key=file.key)]
    with pytest.raises(OSError, match="stream failed"), service.build_upload_files_zip_tempfile(upload_files=entries):
        pytest.fail("An incomplete archive must never be yielded")

    assert storage.stream_closed is True
    assert list(tmp_path.glob("*.zip")) == []


def test_extraction_adapter_keeps_file_identity_through_real_extract_setting(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _Storage(sqlite_engine)
    service = make_file_service(sqlite_session_factory, storage=storage)
    file = service.upload_text("content", "report.txt", str(uuid4()), str(uuid4()))

    def extract(
        _cls: type[ExtractProcessor], extract_setting: ExtractSetting, is_automatic: bool = False
    ) -> list[Document]:
        storage.record("extract")
        assert is_automatic is False
        assert isinstance(extract_setting, ExtractSetting)
        upload = extract_setting.upload_file
        assert isinstance(upload, UploadFile)
        assert upload.id == file.id
        assert upload.tenant_id == file.tenant_id
        assert upload.created_by == file.created_by
        assert upload.key == file.key
        return [Document(page_content="first"), Document(page_content="second")]

    monkeypatch.setattr(ExtractProcessor, "extract", classmethod(extract))

    def unexpected_query(*_args: object) -> None:
        pytest.fail("The extraction adapter must use detached metadata without reloading the file")

    event.listen(sqlite_engine, "before_cursor_execute", unexpected_query)
    try:
        assert extract_file_text(file=file) == "first\nsecond"
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", unexpected_query)
    assert storage.events == ["save", "extract"]
