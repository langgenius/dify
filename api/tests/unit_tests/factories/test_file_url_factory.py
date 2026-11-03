"""Behavior tests for refreshing file URLs in display content."""

from collections.abc import Callable
from typing import Literal
from urllib.parse import parse_qs, urlparse

import pytest

from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from core.tools.signature import sign_tool_file, sign_upload_file_preview_url
from factories.file_url_factory import re_sign_file_urls


@pytest.fixture(autouse=True)
def _signature_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        SECRET_KEY="unit-secret",
        FILES_URL="https://files.example.com",
        INTERNAL_FILES_URL="https://internal.example.com",
        FILES_ACCESS_TIMEOUT=120,
    )


@pytest.mark.parametrize("kind", ["upload", "image", "tool", "datasource"])
@pytest.mark.parametrize("base_url", ["", "https://files.example.com", "https://files.example.com/proxy"])
def test_refresh_expired_preview_urls_preserves_target_and_download_options(
    kind: str, base_url: str, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(FILES_URL=base_url, FILES_ACCESS_TIMEOUT=120)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    runtime = create_dify_workflow_file_runtime()
    file_id = "b4c3d2e1-0000-4000-8000-123456789abc"
    match kind:
        case "upload":
            url = runtime.resolve_upload_file_url(upload_file_id=file_id, as_attachment=True)
        case "image":
            url = sign_upload_file_preview_url(file_id, ".png")
        case _:
            url = sign_tool_file(file_id, ".pdf")
            if kind == "datasource":
                url = url.replace("/files/tools/", "/files/datasources/")
    url += "&label=Review%20file#page=2"
    original = urlparse(url)
    old_query = parse_qs(original.query)
    preview_kind: Literal["image", "file"] = "image" if kind == "image" else "file"
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000200)
    assert not runtime.verify_preview_signature(
        preview_kind=preview_kind,
        file_id=file_id,
        timestamp=old_query["timestamp"][0],
        nonce=old_query["nonce"][0],
        sign=old_query["sign"][0],
    )

    refreshed = re_sign_file_urls(url, preserve_url=True)
    parsed = urlparse(refreshed)
    query = parse_qs(parsed.query)
    assert (parsed.scheme, parsed.netloc, parsed.path, parsed.fragment) == (
        original.scheme,
        original.netloc,
        original.path,
        original.fragment,
    )
    assert "&label=Review%20file#page=2" in refreshed
    if kind == "upload":
        assert query["as_attachment"] == ["true"]
    assert query["timestamp"] == ["1700000200"]
    assert query["nonce"] != old_query["nonce"]
    for now, expected_valid in ((1700000200, True), (1700000320, True), (1700000321, False)):
        monkeypatch.setattr("core.tools.signature.time.time", lambda now=now: now)
        assert (
            runtime.verify_preview_signature(
                preview_kind=preview_kind,
                file_id=file_id,
                timestamp=query["timestamp"][0],
                nonce=query["nonce"][0],
                sign=query["sign"][0],
            )
            == expected_valid
        )


@pytest.mark.parametrize(
    "change",
    [
        "external_origin",
        "lookalike_origin",
        "other_file",
        "unsigned",
        "bad_signature",
        "unicode_signature",
        "duplicate",
    ],
)
def test_refresh_preserves_external_unsigned_and_tampered_urls(change: str) -> None:
    url = sign_tool_file("b4c3d2e1-0000-4000-8000-123456789abc", ".pdf")
    match change:
        case "external_origin":
            url = url.replace("files.example.com", "external.example.com")
        case "lookalike_origin":
            url = url.replace("files.example.com", "files.example.com.evil.example")
        case "other_file":
            url = url.replace("b4c3d2e1", "a4c3d2e1")
        case "unsigned":
            url = url.partition("?")[0]
        case "bad_signature":
            url = url.replace("sign=", "sign=bad")
        case "unicode_signature":
            url = url.replace("sign=", "sign=文件")
        case "duplicate":
            url += "&timestamp=1700000000"
    assert re_sign_file_urls(url, preserve_url=True) == url


@pytest.mark.parametrize(
    ("kind", "extension", "expected_path"),
    [
        ("upload", "", "/files/file-1/file-preview"),
        ("image", "", "/files/file-1/file-preview"),
        ("tool", ".pdf", "/files/tools/file-1.pdf"),
        ("tool", "", "/files/tools/file-1.bin"),
        ("tool", ".long-extension", "/files/tools/file-1.bin"),
    ],
)
def test_message_refresh_retains_external_host_and_legacy_preview_conversion(
    kind: str, extension: str, expected_path: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    match kind:
        case "upload":
            old_url = create_dify_workflow_file_runtime().resolve_upload_file_url(
                upload_file_id="file-1", for_external=False
            )
        case "image":
            old_url = sign_upload_file_preview_url("file-1", extension)
        case _:
            old_url = sign_tool_file("file-1", extension, for_external=False)
    old_url += "&as_attachment=true"
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000400)

    content = re_sign_file_urls(f"[Report]({old_url})")

    parsed = urlparse(content.removeprefix("[Report](").removesuffix(")"))
    query = parse_qs(parsed.query)
    assert parsed.netloc == "files.example.com"
    assert parsed.path == expected_path
    assert query["timestamp"] == ["1700000400"]
    assert query["as_attachment"] == ["true"]
    assert create_dify_workflow_file_runtime().verify_preview_signature(
        preview_kind="file",
        file_id="file-1",
        timestamp=query["timestamp"][0],
        nonce=query["nonce"][0],
        sign=query["sign"][0],
    )
