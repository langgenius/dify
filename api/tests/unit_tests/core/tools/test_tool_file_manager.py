from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from core.tools.tool_file_manager import ToolFileManager


def test_tool_file_manager_sign_and_verify(monkeypatch):
    monkeypatch.setattr("core.tools.tool_file_manager.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.tool_file_manager.os.urandom", lambda _: b"\x01" * 16)
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.SECRET_KEY", "secret")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")
    monkeypatch.setattr("core.tools.tool_file_manager.dify_config.FILES_ACCESS_TIMEOUT", 100)

    url = ToolFileManager.sign_file("tf-1", ".png")
    assert "/files/tools/tf-1.png" in url

    query = dict(part.split("=", 1) for part in url.split("?", 1)[1].split("&"))
    assert ToolFileManager.verify_file("tf-1", query["timestamp"], query["nonce"], query["sign"]) is True
    assert ToolFileManager.verify_file("tf-1", query["timestamp"], query["nonce"], "bad") is False


def test_tool_file_manager_create_file_by_raw_and_url(monkeypatch):
    manager = ToolFileManager(engine=Mock())
    session = Mock()
    session.refresh.side_effect = lambda model: setattr(model, "id", "tf-1")

    def tool_file_factory(**kwargs):
        return SimpleNamespace(**kwargs)

    with patch("core.tools.tool_file_manager.storage") as storage:
        with patch("core.tools.tool_file_manager.ToolFile", side_effect=tool_file_factory):
            with patch("core.tools.tool_file_manager.uuid4", return_value=SimpleNamespace(hex="abc")):
                with patch("core.tools.tool_file_manager.Session") as session_cls:
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

    response = Mock()
    response.content = b"binary"
    response.headers = {"Content-Type": "application/octet-stream"}
    response.raise_for_status.return_value = None
    session = Mock()
    with patch("core.tools.tool_file_manager.storage") as storage:
        with patch("core.tools.tool_file_manager.ToolFile", side_effect=tool_file_factory):
            with patch("core.tools.tool_file_manager.uuid4", return_value=SimpleNamespace(hex="def")):
                with patch("core.tools.tool_file_manager.Session") as session_cls:
                    session_cls.return_value.__enter__.return_value = session
                    with patch("core.tools.tool_file_manager.ssrf_proxy.get", return_value=response):
                        file_model = manager.create_file_by_url("u1", "t1", "https://example.com/f.bin", "c1")
    assert file_model.file_key.startswith("tools/t1/")
    storage.save.assert_called_once()

    with patch("core.tools.tool_file_manager.ssrf_proxy.get", side_effect=httpx.TimeoutException("timeout")):
        with pytest.raises(ValueError, match="timeout when downloading file"):
            manager.create_file_by_url("u1", "t1", "https://example.com/f.bin", "c1")


def test_tool_file_manager_get_binary_helpers_and_generators():
    manager = ToolFileManager(engine=Mock())

    # get_file_binary not found
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = None
    with patch("core.tools.tool_file_manager.Session") as session_cls:
        session_cls.return_value.__enter__.return_value = session
        assert manager.get_file_binary("missing") is None

    # get_file_binary found
    tool_file = SimpleNamespace(file_key="k1", mimetype="text/plain")
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = tool_file
    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"hello"
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            assert manager.get_file_binary("id1") == (b"hello", "text/plain")

    # get_file_binary_by_message_file_id branches
    message_file = SimpleNamespace(url="https://x/files/tools/tool123.png")
    tool_file = SimpleNamespace(file_key="k2", mimetype="image/png")
    session = Mock()
    first_query = Mock()
    second_query = Mock()
    first_query.where.return_value.first.return_value = message_file
    second_query.where.return_value.first.return_value = tool_file
    session.query.side_effect = [first_query, second_query]
    with patch("core.tools.tool_file_manager.storage") as storage:
        storage.load_once.return_value = b"img"
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            assert manager.get_file_binary_by_message_file_id("mf-1") == (b"img", "image/png")

    # get_file_generator_by_tool_file_id
    session = Mock()
    session.query.return_value.where.return_value.first.return_value = tool_file
    with patch("core.tools.tool_file_manager.storage") as storage:
        stream = iter([b"a", b"b"])
        storage.load_stream.return_value = stream
        with patch("core.tools.tool_file_manager.Session") as session_cls:
            session_cls.return_value.__enter__.return_value = session
            s, f = manager.get_file_generator_by_tool_file_id("tool123")
    assert list(s) == [b"a", b"b"]
    assert f is tool_file
