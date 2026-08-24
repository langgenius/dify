"""Unit tests for core.tools.signature covering signing and verification invariants."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal
from urllib.parse import parse_qs, urlparse

import pytest

from core.tools.signature import (
    bind_file_uri,
    get_signed_file_uri_for_plugin,
    sign_tool_file,
    sign_tool_file_uri,
    sign_upload_file_preview_url,
    verify_plugin_file_signature,
    verify_tool_file_signature,
)


@pytest.fixture(autouse=True)
def _signature_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        SECRET_KEY="unit-secret",
        FILES_URL="https://files.example.com",
        INTERNAL_FILES_URL="https://internal.example.com",
        FILES_ACCESS_TIMEOUT=120,
    )


def test_bind_file_uri_uses_selected_base_and_preserves_remote_url() -> None:
    uri = "/files/tools/tool-file-id.png?sign=1"

    assert bind_file_uri(uri, "https://files.example.com") == f"https://files.example.com{uri}"
    assert bind_file_uri(uri, "") == uri
    assert bind_file_uri("https://remote.example.com/report.pdf", "https://files.example.com") == (
        "https://remote.example.com/report.pdf"
    )


def test_sign_tool_file_uri_has_no_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x08" * 16)

    uri = sign_tool_file_uri("tool-file-id", ".png")
    parsed = urlparse(uri)

    assert parsed.scheme == ""
    assert parsed.netloc == ""
    assert parsed.path == "/files/tools/tool-file-id.png"
    assert parse_qs(parsed.query)["timestamp"] == ["1700000000"]


def test_sign_tool_file_and_verify_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x01" * 16)

    url = sign_tool_file("tool-file-id", ".png", for_external=False)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    timestamp = query["timestamp"][0]
    nonce = query["nonce"][0]
    sign = query["sign"][0]

    assert parsed.scheme == "https"
    assert parsed.netloc == "internal.example.com"
    assert parsed.path == "/files/tools/tool-file-id.png"
    assert verify_tool_file_signature("tool-file-id", timestamp, nonce, sign) is True


def test_sign_tool_file_for_external_uses_files_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x04" * 16)

    url = sign_tool_file("tool-file-id", ".png", for_external=True)
    parsed = urlparse(url)

    assert parsed.scheme == "https"
    assert parsed.netloc == "files.example.com"
    assert parsed.path == "/files/tools/tool-file-id.png"


def test_verify_tool_file_signature_rejects_invalid_sign(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(INTERNAL_FILES_URL="", FILES_ACCESS_TIMEOUT=10)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x02" * 16)

    url = sign_tool_file("tool-file-id", ".txt")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    timestamp = query["timestamp"][0]
    nonce = query["nonce"][0]
    sign = query["sign"][0]

    assert verify_tool_file_signature("tool-file-id", timestamp, nonce, "bad-signature") is False


def test_verify_tool_file_signature_rejects_expired_signature(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(INTERNAL_FILES_URL="", FILES_ACCESS_TIMEOUT=10)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x02" * 16)

    url = sign_tool_file("tool-file-id", ".txt")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    timestamp = query["timestamp"][0]
    nonce = query["nonce"][0]
    sign = query["sign"][0]

    monkeypatch.setattr("core.tools.signature.time.time", lambda: int(timestamp) + 99)
    assert verify_tool_file_signature("tool-file-id", timestamp, nonce, sign) is False


def test_sign_upload_file_preview_url_uses_files_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x03" * 16)

    url = sign_upload_file_preview_url("upload-id", ".png")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "files.example.com"
    assert parsed.path == "/files/upload-id/image-preview"
    assert query["timestamp"][0]
    assert query["nonce"][0]
    assert query["sign"][0]


def test_sign_upload_file_preview_url_ignores_internal_files_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x05" * 16)

    url = sign_upload_file_preview_url("upload-id", ".png")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "files.example.com"
    assert parsed.path == "/files/upload-id/image-preview"
    assert query["timestamp"][0]
    assert query["nonce"][0]
    assert query["sign"][0]


def test_get_signed_file_uri_for_plugin_and_verify_roundtrip(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(FILES_ACCESS_TIMEOUT=60)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x06" * 16)

    uri = get_signed_file_uri_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
        conversation_id="conversation-id",
    )
    parsed = urlparse(uri)
    query = parse_qs(parsed.query)

    assert parsed.netloc == ""
    assert parsed.path == "/files/upload/for-plugin"
    assert query["tenant_id"] == ["tenant-id"]
    assert query["user_id"] == ["user-id"]
    assert query["conversation_id"] == ["conversation-id"]
    assert "max_size" not in query
    assert (
        verify_plugin_file_signature(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
            conversation_id="conversation-id",
            timestamp=query["timestamp"][0],
            nonce=query["nonce"][0],
            sign=query["sign"][0],
        )
        is True
    )


@pytest.mark.parametrize(
    ("user_from", "forged_nonce_suffix"),
    [
        (None, "|1024"),
        ("account", "|account|1024"),
    ],
)
def test_plugin_upload_signature_binds_max_size_without_legacy_payload_ambiguity(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    user_from: Literal["account", "end-user"] | None,
    forged_nonce_suffix: str,
) -> None:
    config_overrides(FILES_ACCESS_TIMEOUT=60)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x0a" * 16)

    uri = get_signed_file_uri_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
        user_from=user_from,
        max_size=1024,
    )
    query = parse_qs(urlparse(uri).query)
    signed = {
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "tenant_id": "tenant-id",
        "user_id": "user-id",
        "timestamp": query["timestamp"][0],
        "nonce": query["nonce"][0],
        "sign": query["sign"][0],
    }

    assert query["max_size"] == ["1024"]
    assert verify_plugin_file_signature(**signed, user_from=user_from, max_size=1024) is True
    assert verify_plugin_file_signature(**signed, user_from=user_from, max_size=2048) is False
    assert verify_plugin_file_signature(**signed, user_from=user_from) is False
    forged = {**signed, "nonce": f"{signed['nonce']}{forged_nonce_suffix}"}
    assert verify_plugin_file_signature(**forged) is False


def test_plugin_upload_signature_binds_account_user_from(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(FILES_ACCESS_TIMEOUT=60)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x09" * 16)

    uri = get_signed_file_uri_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="account-id",
        user_from="account",
    )
    query = parse_qs(urlparse(uri).query)

    assert query["user_from"] == ["account"]
    signed = {
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "tenant_id": "tenant-id",
        "user_id": "account-id",
        "timestamp": query["timestamp"][0],
        "nonce": query["nonce"][0],
        "sign": query["sign"][0],
    }
    assert verify_plugin_file_signature(**signed, user_from="account") is True
    assert verify_plugin_file_signature(**signed, user_from="end-user") is False
    assert verify_plugin_file_signature(**signed) is False


def test_verify_plugin_file_signature_rejects_invalid_signatures(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(FILES_ACCESS_TIMEOUT=30)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x07" * 16)

    uri = get_signed_file_uri_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
    )
    query = parse_qs(urlparse(uri).query)

    assert (
        verify_plugin_file_signature(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
            timestamp=query["timestamp"][0],
            nonce=query["nonce"][0],
            sign="bad-signature",
        )
        is False
    )

    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000100)
    assert (
        verify_plugin_file_signature(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
            timestamp=query["timestamp"][0],
            nonce=query["nonce"][0],
            sign=query["sign"][0],
        )
        is False
    )
