"""Unit tests for `ToolFileManager` behavior.

Covers signing/verification, file persistence flows, and retrieval APIs with
mocked storage/session boundaries (httpx, SimpleNamespace, Mock/patch) to
avoid real IO.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from core.tools.tool_file_manager import ToolFileManager


def _setup_tool_file_signing(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.setattr("core.tools.tool_file_manager.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.tool_file_manager.os.urandom", lambda _: b"\x01" * 16)
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.SECRET_KEY", "secret")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.FILES_ACCESS_TIMEOUT", 100)

    url = ToolFileManager.sign_file("tf-1", ".png")
    assert "/files/tools/tf-1.png" in url
    return dict(part.split("=", 1) for part in url.split("?", 1)[1].split("&"))


def test_tool_file_manager_sign_verify_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    query = _setup_tool_file_signing(monkeypatch)

    assert ToolFileManager.verify_file("tf-1", query["timestamp"], query["nonce"], query["sign"]) is True


def test_tool_file_manager_sign_verify_bad_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    query = _setup_tool_file_signing(monkeypatch)

    assert ToolFileManager.verify_file("tf-1", query["timestamp"], query["nonce"], "bad") is False


def test_tool_file_manager_sign_verify_expired_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    query = _setup_tool_file_signing(monkeypatch)
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.FILES_ACCESS_TIMEOUT", 0)
    monkeypatch.setattr("core.tools.tool_file_manager.time.time", lambda: 1700000100)

    assert ToolFileManager.verify_file("tf-1", query["timestamp"], query["nonce"], query["sign"]) is False


def test_create_file_by_raw_stores_file_and_persists_record() -> None:
    manager = ToolFileManager(engine=Mock())
    session = Mock()
    session.refresh.side_effect = lambda model: setattr(model, "id", "tf-1")

    def tool_file_factory(**kwargs):
        return SimpleNamespace(**kwargs)

    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.ToolFile", side_effect=tool_file_factory),
        patch("core.tools.tool_file_manager.uuid4", return_value=SimpleNamespace(hex="abc")),
        patch("core.tools.tool_file_manager.Session") as session_cls,
    ):
        session_cls.return_value.__enter__.return_value = session
        file_model = manager.create_file_by_raw(
            user_id="u1",
            tenant_id="t1",
            conversation_id="c1",
            file_binary=b"hello",
            mimetype="text/plain",
            filename="readme",
        )

    assert file_model.name.endswith(".txt")
    storage.save.assert_called_once()
    session.add.assert_called_once()
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(file_model)


def test_create_file_by_url_downloads_and_persists_record() -> None:
    manager = ToolFileManager(engine=Mock())
    response = Mock()
    response.content = b"binary"
    response.headers = {"Content-Type": "application/octet-stream"}
    response.raise_for_status.return_value = None
    session = Mock()

    def tool_file_factory(**kwargs):
        return SimpleNamespace(**kwargs)

    session.refresh.side_effect = lambda model: setattr(model, "id", "tf-2")
    with (
        patch("core.tools.tool_file_manager.storage") as storage,
        patch("core.tools.tool_file_manager.ToolFile", side_effect=tool_file_factory),
        patch("core.tools.tool_file_manager.uuid4", return_value=SimpleNamespace(hex="def")),
        patch("core.tools.tool_file_manager.Session") as session_cls,
        patch("core.tools.tool_file_manager.ssrf_proxy.get", return_value=response),
    ):
        session_cls.return_value.__enter__.return_value = session
        file_model = manager.create_file_by_url("u1", "t1", "https://example.com/f.bin", "c1")

    assert file_model.file_key.startswith("tools/t1/")
    storage.save.assert_called_once()
    session.add.assert_called_once_with(file_model)
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(file_model)


def test_create_file_by_url_raises_on_timeout() -> None:
    manager = ToolFileManager(engine=Mock())

    with patch("core.tools.tool_file_manager.ssrf_proxy.get", side_effect=httpx.TimeoutException("timeout")):
        with pytest.raises(ValueError, match="timeout when downloading file"):
            manager.create_file_by_url("u1", "t1", "https://example.com/f.bin", "c1")


def test_get_file_binary_returns_none_when_not_found() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = None

    # Act
    with patch("core.tools.tool_file_manager.Session") as session_cls:
        session_cls.return_value.__enter__.return_value = session
        result = manager.get_file_binary("missing")

    # Assert
    assert result is None


def test_get_file_binary_returns_bytes_when_found() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    tool_file = SimpleNamespace(file_key="k1", mimetype="text/plain")
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = tool_file

    # Act
    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"hello"
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            result = manager.get_file_binary("id1")

    # Assert
    assert result == (b"hello", "text/plain")


def test_get_file_binary_by_message_file_id_when_messagefile_missing() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    session = Mock()
    first_query = Mock()
    second_query = Mock()
    first_query.where.return_value.first.return_value = None
    second_query.where.return_value.first.return_value = None
    session.query.side_effect = [first_query, second_query]

    # Act
    with patch("core.tools.tool_file_manager.Session") as session_cls:
        session_cls.return_value.__enter__.return_value = session
        result = manager.get_file_binary_by_message_file_id("mf-1")

    # Assert
    assert result is None


def test_get_file_binary_by_message_file_id_when_url_is_none() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    message_file = SimpleNamespace(url=None)
    session = Mock()
    first_query = Mock()
    second_query = Mock()
    first_query.where.return_value.first.return_value = message_file
    second_query.where.return_value.first.return_value = None
    session.query.side_effect = [first_query, second_query]

    # Act
    with patch("core.tools.tool_file_manager.Session") as session_cls:
        session_cls.return_value.__enter__.return_value = session
        result = manager.get_file_binary_by_message_file_id("mf-1")

    # Assert
    assert result is None


def test_get_file_binary_by_message_file_id_returns_bytes_when_found() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    message_file = SimpleNamespace(url="https://x/files/tools/tool123.png")
    tool_file = SimpleNamespace(file_key="k2", mimetype="image/png")
    session = Mock()
    first_query = Mock()
    second_query = Mock()
    first_query.where.return_value.first.return_value = message_file
    second_query.where.return_value.first.return_value = tool_file
    session.query.side_effect = [first_query, second_query]

    # Act
    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"img"
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            result = manager.get_file_binary_by_message_file_id("mf-1")

    # Assert
    assert result == (b"img", "image/png")


def test_get_file_generator_returns_none_when_toolfile_missing() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = None

    # Act
    with patch("core.tools.tool_file_manager.Session") as session_cls:
        session_cls.return_value.__enter__.return_value = session
        stream, tool_file = manager.get_file_generator_by_tool_file_id("tool123")

    # Assert
    assert stream is None
    assert tool_file is None


def test_get_file_generator_returns_stream_when_found() -> None:
    # Arrange
    manager = ToolFileManager(engine=Mock())
    tool_file = SimpleNamespace(file_key="k2", mimetype="image/png")
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = tool_file

    # Act
    with patch("core.tools.tool_file_manager.storage") as storage:
        stream = iter([b"a", b"b"])
        storage.load_stream.return_value = stream
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            result_stream, result_file = manager.get_file_generator_by_tool_file_id("tool123")
            assert list(result_stream) == [b"a", b"b"]
            assert result_file is tool_file
