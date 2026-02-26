from __future__ import annotations

import base64
import hashlib
import hmac
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse

import pytest

from core.workflow.file.helpers import (
    get_signed_file_url,
    get_signed_file_url_for_plugin,
    get_signed_tool_file_url,
    verify_file_signature,
    verify_image_signature,
    verify_plugin_file_signature,
)


def _expected_signature(secret: str, payload: str) -> str:
    digest = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode()


def test_get_signed_file_url_builds_external_url_and_attachment_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(
        files_url="https://files.example.com",
        internal_files_url="http://files.internal",
        secret_key="secret",
    )
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_000)
    monkeypatch.setattr("core.workflow.file.helpers.os.urandom", lambda _: b"\x01" * 16)

    url = get_signed_file_url("upload-1", as_attachment=True)

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    nonce = query["nonce"][0]
    expected = _expected_signature("secret", f"file-preview|upload-1|1700000000|{nonce}")

    assert parsed.scheme == "https"
    assert parsed.netloc == "files.example.com"
    assert parsed.path.endswith("/files/upload-1/file-preview")
    assert query["timestamp"] == ["1700000000"]
    assert query["as_attachment"] == ["true"]
    assert query["sign"] == [expected]


def test_get_signed_file_url_uses_internal_base_when_for_external_is_false(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(
        files_url="https://files.example.com",
        internal_files_url="http://files.internal",
        secret_key="secret",
    )
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_000)
    monkeypatch.setattr("core.workflow.file.helpers.os.urandom", lambda _: b"\x02" * 16)

    url = get_signed_file_url("upload-2", for_external=False)

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    nonce = query["nonce"][0]
    expected = _expected_signature("secret", f"file-preview|upload-2|1700000000|{nonce}")

    assert parsed.netloc == "files.internal"
    assert "as_attachment" not in query
    assert query["sign"] == [expected]


def test_get_signed_file_url_for_plugin_uses_internal_base_and_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(
        files_url="https://files.example.com",
        internal_files_url="http://files.internal",
        secret_key="secret",
    )
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_100)
    monkeypatch.setattr("core.workflow.file.helpers.os.urandom", lambda _: b"\x03" * 16)

    url = get_signed_file_url_for_plugin(
        filename="report.csv",
        mimetype="text/csv",
        tenant_id="tenant-1",
        user_id="user-1",
    )

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    nonce = query["nonce"][0]
    expected = _expected_signature(
        "secret",
        f"upload|report.csv|text/csv|tenant-1|user-1|1700000100|{nonce}",
    )

    assert parsed.netloc == "files.internal"
    assert parsed.path.endswith("/files/upload/for-plugin")
    assert query["timestamp"] == ["1700000100"]
    assert query["user_id"] == ["user-1"]
    assert query["tenant_id"] == ["tenant-1"]
    assert query["sign"] == [expected]


def test_get_signed_tool_file_url_delegates_to_runtime_signer(monkeypatch: pytest.MonkeyPatch) -> None:
    sign_tool_file = MagicMock(return_value="signed-tool-url")

    runtime = SimpleNamespace(sign_tool_file=sign_tool_file)
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)

    url = get_signed_tool_file_url("tool-1", ".pdf", for_external=False)

    assert url == "signed-tool-url"
    sign_tool_file.assert_called_once_with(tool_file_id="tool-1", extension=".pdf", for_external=False)


def test_verify_plugin_file_signature_validates_signature_and_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(secret_key="secret", files_access_timeout=60)
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_050)

    sign = _expected_signature(
        "secret",
        "upload|report.csv|text/csv|tenant-1|user-1|1700000000|nonce",
    )

    assert (
        verify_plugin_file_signature(
            filename="report.csv",
            mimetype="text/csv",
            tenant_id="tenant-1",
            user_id="user-1",
            timestamp="1700000000",
            nonce="nonce",
            sign=sign,
        )
        is True
    )


def test_verify_plugin_file_signature_returns_false_for_mismatch_or_expiration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = SimpleNamespace(secret_key="secret", files_access_timeout=10)
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_050)

    valid_sign = _expected_signature(
        "secret",
        "upload|report.csv|text/csv|tenant-1|user-1|1700000000|nonce",
    )

    assert (
        verify_plugin_file_signature(
            filename="report.csv",
            mimetype="text/csv",
            tenant_id="tenant-1",
            user_id="user-1",
            timestamp="1700000000",
            nonce="nonce",
            sign="bad-sign",
        )
        is False
    )
    assert (
        verify_plugin_file_signature(
            filename="report.csv",
            mimetype="text/csv",
            tenant_id="tenant-1",
            user_id="user-1",
            timestamp="1700000000",
            nonce="nonce",
            sign=valid_sign,
        )
        is False
    )


@pytest.mark.parametrize(
    ("verify_fn", "payload"),
    [
        (verify_image_signature, "image-preview|upload-1|1700000000|nonce"),
        (verify_file_signature, "file-preview|upload-1|1700000000|nonce"),
    ],
)
def test_verify_image_and_file_signature_success(
    verify_fn,
    payload: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = SimpleNamespace(secret_key="secret", files_access_timeout=120)
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_030)

    sign = _expected_signature("secret", payload)

    assert verify_fn(upload_file_id="upload-1", timestamp="1700000000", nonce="nonce", sign=sign) is True


@pytest.mark.parametrize(
    "verify_fn",
    [verify_image_signature, verify_file_signature],
)
def test_verify_image_and_file_signature_return_false_on_invalid_sign_and_timeout(
    verify_fn,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = SimpleNamespace(secret_key="secret", files_access_timeout=5)
    monkeypatch.setattr("core.workflow.file.helpers.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.helpers.time.time", lambda: 1_700_000_030)

    assert verify_fn(upload_file_id="upload-1", timestamp="1700000000", nonce="nonce", sign="bad") is False
