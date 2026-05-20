"""Unit tests for core.tools.signature covering signing and verification invariants."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from core.tools.signature import (
    get_signed_file_url_for_plugin,
    sign_tool_file,
    sign_upload_file_preview_url,
    verify_plugin_file_signature,
    verify_tool_file_signature,
)


def test_sign_tool_file_and_verify_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x01" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 120)

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
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 120)

    url = sign_tool_file("tool-file-id", ".png", for_external=True)
    parsed = urlparse(url)

    assert parsed.scheme == "https"
    assert parsed.netloc == "files.example.com"
    assert parsed.path == "/files/tools/tool-file-id.png"


def test_verify_tool_file_signature_rejects_invalid_sign(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x02" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 10)

    url = sign_tool_file("tool-file-id", ".txt")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    timestamp = query["timestamp"][0]
    nonce = query["nonce"][0]
    sign = query["sign"][0]

    assert verify_tool_file_signature("tool-file-id", timestamp, nonce, "bad-signature") is False


def test_verify_tool_file_signature_rejects_expired_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x02" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 10)

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
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")

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
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")

    url = sign_upload_file_preview_url("upload-id", ".png")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "files.example.com"
    assert parsed.path == "/files/upload-id/image-preview"
    assert query["timestamp"][0]
    assert query["nonce"][0]
    assert query["sign"][0]


def test_get_signed_file_url_for_plugin_and_verify_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x06" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 60)

    url = get_signed_file_url_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
    )
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "internal.example.com"
    assert parsed.path == "/files/upload/for-plugin"
    assert query["tenant_id"] == ["tenant-id"]
    assert query["user_id"] == ["user-id"]
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
        is True
    )


def test_verify_plugin_file_signature_rejects_invalid_signatures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x07" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_ACCESS_TIMEOUT", 30)

    url = get_signed_file_url_for_plugin(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
    )
    query = parse_qs(urlparse(url).query)

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
