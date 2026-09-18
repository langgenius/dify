"""Unit tests for ``ToolFileManager`` behavior.

File metadata is persisted through real SQLite-backed sessions. Storage and
remote HTTP remain mocked because they are external I/O boundaries.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.tools.tool_file_manager as tool_file_manager_module
from core.tools.tool_file_manager import ToolFileManager
from graphon.file import FileTransferMethod, FileType
from models.base import TypeBase
from models.enums import CreatorUserRole
from models.model import MessageFile
from models.tools import ToolFile


@pytest.fixture
def sqlite_tool_file_session(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> Iterator[Session]:
    """Bind manager-owned sessions to SQLite and expose a setup/assertion session."""
    TypeBase.metadata.create_all(sqlite_engine, tables=[ToolFile.__table__, MessageFile.__table__])
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(tool_file_manager_module.session_factory, "create_session", factory)
    with factory() as session:
        yield session


def _tool_file(*, file_key: str = "k1", mimetype: str = "text/plain", name: str = "file.txt") -> ToolFile:
    return ToolFile(
        user_id=str(uuid4()),
        tenant_id=str(uuid4()),
        conversation_id=str(uuid4()),
        file_key=file_key,
        mimetype=mimetype,
        original_url=None,
        name=name,
        size=12,
    )


def _message_file(*, url: str | None) -> MessageFile:
    return MessageFile(
        message_id=str(uuid4()),
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.TOOL_FILE,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        url=url,
    )


def test_tool_file_manager_sign_file_builds_url() -> None:
    url = ToolFileManager.sign_file("tf-1", ".png")
    assert "/files/tools/tf-1.png" in url


def test_create_file_by_raw_stores_file_and_persists_record(sqlite_tool_file_session: Session) -> None:
    manager = ToolFileManager()
    user_id = str(uuid4())
    tenant_id = str(uuid4())
    conversation_id = str(uuid4())

    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.guess_extension", return_value=".txt"),
        patch("core.tools.tool_file_manager.uuid4", return_value=UUID(int=0xABC)),
    ):
        file_model = manager.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            file_binary=b"hello",
            mimetype="text/plain",
            filename="readme",
        )

    persisted = sqlite_tool_file_session.get(ToolFile, file_model.id)
    assert persisted is not None
    assert persisted.name == "readme.txt"
    assert persisted.file_key == f"tools/{tenant_id}/{UUID(int=0xABC).hex}.txt"
    storage.save.assert_called_once_with(persisted.file_key, b"hello")


def test_create_file_by_raw_prefers_filename_extension_over_mimetype(
    sqlite_tool_file_session: Session,
) -> None:
    manager = ToolFileManager()
    tenant_id = str(uuid4())

    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.uuid4", return_value=UUID(int=0xABC)),
    ):
        file_model = manager.create_file_by_raw(
            user_id=str(uuid4()),
            tenant_id=tenant_id,
            conversation_id=str(uuid4()),
            file_binary=b"docx",
            mimetype="application/octet-stream",
            filename="report.docx",
        )

    persisted = sqlite_tool_file_session.get(ToolFile, file_model.id)
    assert persisted is not None
    assert persisted.name == "report.docx"
    assert persisted.file_key == f"tools/{tenant_id}/{UUID(int=0xABC).hex}.docx"
    storage.save.assert_called_once_with(persisted.file_key, b"docx")


def test_create_file_by_url_downloads_and_persists_record(sqlite_tool_file_session: Session) -> None:
    manager = ToolFileManager()
    tenant_id = str(uuid4())
    response = Mock()
    response.content = b"binary"
    response.headers = {"Content-Type": "application/octet-stream"}
    response.raise_for_status.return_value = None

    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.uuid4", return_value=UUID(int=0xDEF)),
        patch("core.tools.tool_file_manager.remote_fetcher.make_request", return_value=response),
    ):
        file_model = manager.create_file_by_url(str(uuid4()), tenant_id, "https://example.com/f.bin", str(uuid4()))

    persisted = sqlite_tool_file_session.get(ToolFile, file_model.id)
    assert persisted is not None
    assert persisted.file_key == f"tools/{tenant_id}/{UUID(int=0xDEF).hex}.bin"
    assert persisted.original_url == "https://example.com/f.bin"
    storage.save.assert_called_once_with(persisted.file_key, b"binary")


def test_create_file_by_url_prefers_url_extension_over_mimetype(
    sqlite_tool_file_session: Session,
) -> None:
    manager = ToolFileManager()
    tenant_id = str(uuid4())
    response = Mock()
    response.content = b"docx"
    response.headers = {"Content-Type": "application/octet-stream"}
    response.raise_for_status.return_value = None

    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.uuid4", return_value=UUID(int=0xABC)),
        patch("core.tools.tool_file_manager.remote_fetcher.make_request", return_value=response),
    ):
        file_model = manager.create_file_by_url(
            str(uuid4()), tenant_id, "https://example.com/report.docx?download=1", str(uuid4())
        )

    persisted = sqlite_tool_file_session.get(ToolFile, file_model.id)
    assert persisted is not None
    assert persisted.file_key == f"tools/{tenant_id}/{UUID(int=0xABC).hex}.docx"
    assert persisted.name == f"{UUID(int=0xABC).hex}.docx"
    storage.save.assert_called_once_with(persisted.file_key, b"docx")


def test_create_file_by_url_raises_on_timeout() -> None:
    manager = ToolFileManager()

    with patch(
        "core.tools.tool_file_manager.remote_fetcher.make_request",
        side_effect=httpx.TimeoutException("timeout"),
    ):
        with pytest.raises(ValueError, match="timeout when downloading file"):
            manager.create_file_by_url("u1", "t1", "https://example.com/f.bin", "c1")


def test_get_file_binary_returns_none_when_not_found(sqlite_tool_file_session: Session) -> None:
    assert ToolFileManager().get_file_binary(str(uuid4())) is None


def test_get_file_binary_returns_bytes_when_found(sqlite_tool_file_session: Session) -> None:
    tool_file = _tool_file()
    sqlite_tool_file_session.add(tool_file)
    sqlite_tool_file_session.commit()

    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"hello"
        result = ToolFileManager().get_file_binary(tool_file.id)

    assert result == (b"hello", "text/plain")
    storage.load_once.assert_called_once_with("k1")


def test_get_file_binary_by_message_file_id_when_messagefile_missing(
    sqlite_tool_file_session: Session,
) -> None:
    assert ToolFileManager().get_file_binary_by_message_file_id(str(uuid4())) is None


def test_get_file_binary_by_message_file_id_when_url_is_none(sqlite_tool_file_session: Session) -> None:
    message_file = _message_file(url=None)
    sqlite_tool_file_session.add(message_file)
    sqlite_tool_file_session.commit()

    assert ToolFileManager().get_file_binary_by_message_file_id(message_file.id) is None


def test_get_file_binary_by_message_file_id_returns_bytes_when_found(
    sqlite_tool_file_session: Session,
) -> None:
    tool_file = _tool_file(file_key="k2", mimetype="image/png", name="image.png")
    message_file = _message_file(url=f"https://x/files/tools/{tool_file.id}.png")
    sqlite_tool_file_session.add_all([tool_file, message_file])
    sqlite_tool_file_session.commit()

    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"img"
        result = ToolFileManager().get_file_binary_by_message_file_id(message_file.id)

    assert result == (b"img", "image/png")
    storage.load_once.assert_called_once_with("k2")


def test_get_file_generator_returns_none_when_toolfile_missing(sqlite_tool_file_session: Session) -> None:
    stream, tool_file = ToolFileManager().get_file_generator_by_tool_file_id(str(uuid4()))

    assert stream is None
    assert tool_file is None


def test_get_file_generator_returns_stream_when_found(sqlite_tool_file_session: Session) -> None:
    tool_file = _tool_file(file_key="k2", mimetype="image/png", name="image.png")
    sqlite_tool_file_session.add(tool_file)
    sqlite_tool_file_session.commit()

    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_stream.return_value = iter([b"a", b"b"])
        result_stream, result_file = ToolFileManager().get_file_generator_by_tool_file_id(tool_file.id)

    assert result_stream is not None
    assert list(result_stream) == [b"a", b"b"]
    assert result_file is not None
    assert result_file.related_id == tool_file.id
    assert result_file.mime_type == "image/png"
    assert result_file.transfer_method == FileTransferMethod.TOOL_FILE
