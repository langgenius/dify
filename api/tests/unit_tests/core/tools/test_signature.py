"""Unit tests for core.tools.signature covering signing and verification invariants."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from core.tools.signature import (
    get_signed_file_url_for_plugin,
    require_files_base_url,
    sign_tool_file,
    sign_upload_file,
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


def test_sign_upload_file_prefers_internal_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x03" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")

    url = sign_upload_file("upload-id", ".png")
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "internal.example.com"
    assert parsed.path == "/files/upload-id/image-preview"
    assert query["timestamp"][0]
    assert query["nonce"][0]
    assert query["sign"][0]


def test_sign_upload_file_uses_files_url_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x05" * 16)
    monkeypatch.setattr("core.tools.signature.dify_config.SECRET_KEY", "unit-secret")
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    url = sign_upload_file("upload-id", ".png")
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


def test_require_files_base_url_returns_files_url_for_external(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")

    assert require_files_base_url(for_external=True) == "https://files.example.com"


def test_require_files_base_url_prefers_internal_for_non_external(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "https://internal.example.com")

    assert require_files_base_url(for_external=False) == "https://internal.example.com"


def test_require_files_base_url_falls_back_to_files_url_when_internal_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    assert require_files_base_url(for_external=False) == "https://files.example.com"


def test_require_files_base_url_raises_when_both_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        require_files_base_url(for_external=True)
    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        require_files_base_url(for_external=False)


@pytest.mark.parametrize(
    "invalid_url",
    [
        "localhost:5001",
        "example.com",
        "//example.com:5001",
        "ftp://example.com:5001",
        "http://",
    ],
)
def test_require_files_base_url_rejects_scheme_less_or_invalid_urls(
    monkeypatch: pytest.MonkeyPatch, invalid_url: str
) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", invalid_url)
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        require_files_base_url(for_external=True)
    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        require_files_base_url(for_external=False)


def test_require_files_base_url_rejects_internal_url_without_scheme(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "https://files.example.com")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "api:5001")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        require_files_base_url(for_external=False)
    # external path still resolves against the valid FILES_URL
    assert require_files_base_url(for_external=True) == "https://files.example.com"


def test_sign_tool_file_raises_when_files_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        sign_tool_file("tool-file-id", ".png", for_external=True)
    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        sign_tool_file("tool-file-id", ".png", for_external=False)


def test_sign_upload_file_raises_when_files_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        sign_upload_file("upload-id", ".png")


def test_get_signed_file_url_for_plugin_raises_when_files_url_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("core.tools.signature.dify_config.FILES_URL", "")
    monkeypatch.setattr("core.tools.signature.dify_config.INTERNAL_FILES_URL", "")

    with pytest.raises(ValueError, match="FILES_URL is not configured with a fully-qualified"):
        get_signed_file_url_for_plugin(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
        )
