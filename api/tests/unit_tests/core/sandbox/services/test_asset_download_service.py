"""Tests for AssetDownloadService shell script generation.

Covers three scenarios:
1. Remote-only items (presigned URL download)
2. Inline-only items (base64 heredoc write)
3. Mixed (inline written first, then parallel downloads)
"""

import base64

from core.sandbox.services.asset_download_service import AssetDownloadService
from core.zip_sandbox.entities import SandboxDownloadItem

# --- Remote-only tests ---


def test_remote_only_includes_downloader_detection() -> None:
    items = [SandboxDownloadItem(path="file.txt", url="https://example.com/file.txt")]
    script = AssetDownloadService.build_download_script(items, "skills")

    assert "command -v curl" in script
    assert "command -v wget" in script
    assert "command -v python3" in script
    assert "No downloader found" in script


def test_remote_only_contains_items_and_root() -> None:
    items = [
        SandboxDownloadItem(path="/docs/readme.md", url="https://example.com/readme.md"),
        SandboxDownloadItem(path="/data/input.json", url="https://example.com/input.json"),
    ]

    script = AssetDownloadService.build_download_script(items, "skills")

    assert "download_root=skills" in script
    assert "/docs/readme.md" in script
    assert "https://example.com/readme.md" in script
    assert "/data/input.json" in script
    assert "https://example.com/input.json" in script


def test_remote_only_escapes_paths_and_urls() -> None:
    items = [
        SandboxDownloadItem(path='/space path/"quoted".txt', url="https://example.com/a?b=1&c=2"),
        SandboxDownloadItem(path=r"/path/with\\backslash", url="https://example.com/with space"),
    ]

    script = AssetDownloadService.build_download_script(items, "skills")

    assert "'" in script
    assert "\\\\" in script
    assert "?b=1&c=2" in script


def test_remote_only_runs_parallel_jobs() -> None:
    items = [
        SandboxDownloadItem(path="a.txt", url="https://example.com/a"),
        SandboxDownloadItem(path="b.txt", url="https://example.com/b"),
    ]
    script = AssetDownloadService.build_download_script(items, "skills")

    assert "download_one" in script
    assert "&" in script
    assert "wait" in script


def test_remote_only_appends_failures() -> None:
    items = [SandboxDownloadItem(path="a.txt", url="https://example.com/a")]
    script = AssetDownloadService.build_download_script(items, "skills")

    assert "fail_log" in script
    assert "DOWNLOAD_FAILURES" in script


def test_remote_only_contains_python_fallback() -> None:
    items = [SandboxDownloadItem(path="a.txt", url="https://example.com/a")]
    script = AssetDownloadService.build_download_script(items, "skills")

    assert "python3 -" in script
    assert "urllib.request" in script


# --- Inline-only tests ---


def test_inline_only_no_downloader_detection() -> None:
    items = [SandboxDownloadItem(path="skill.md", content=b"hello world")]
    script = AssetDownloadService.build_download_script(items, "skills")

    # No remote items → no downloader detection block.
    assert "command -v curl" not in script
    assert "download_one" not in script
    assert "wait" not in script


def test_inline_only_base64_content() -> None:
    content = b'{"content": "test skill", "metadata": {}}'
    items = [SandboxDownloadItem(path="docs/skill.md", content=content)]
    script = AssetDownloadService.build_download_script(items, "skills")

    encoded = base64.b64encode(content).decode("ascii")
    assert encoded in script
    assert "base64 -d" in script
    assert "docs/skill.md" in script
    assert "_INLINE_0" in script


def test_inline_multiple_items() -> None:
    items = [
        SandboxDownloadItem(path="a.md", content=b"aaa"),
        SandboxDownloadItem(path="b.md", content=b"bbb"),
    ]
    script = AssetDownloadService.build_download_script(items, "skills")

    assert "_INLINE_0" in script
    assert "_INLINE_1" in script
    assert base64.b64encode(b"aaa").decode() in script
    assert base64.b64encode(b"bbb").decode() in script


# --- Mixed tests ---


def test_mixed_inline_and_remote() -> None:
    items = [
        SandboxDownloadItem(path="skill.md", content=b"resolved content"),
        SandboxDownloadItem(path="data.py", url="https://example.com/data.py"),
    ]

    script = AssetDownloadService.build_download_script(items, "skills")

    # Inline content present
    assert "base64 -d" in script
    assert base64.b64encode(b"resolved content").decode() in script

    # Remote download present
    assert "command -v curl" in script
    assert "download_one" in script
    assert "data.py" in script
    assert "https://example.com/data.py" in script


# --- Empty items ---


def test_empty_items_produces_valid_script() -> None:
    script = AssetDownloadService.build_download_script([], "skills")

    assert "download_root=skills" in script
    assert "mkdir -p" in script
    assert "exit 0" in script
