import re

import pytest

from factories.file_factory import _get_remote_file_info


class _FakeResponse:
    def __init__(self, status_code: int, headers: dict[str, str]):
        self.status_code = status_code
        self.headers = headers


def _mock_head(monkeypatch: pytest.MonkeyPatch, headers: dict[str, str], status_code: int = 200):
    def _fake_head(url: str, follow_redirects: bool = True):
        return _FakeResponse(status_code=status_code, headers=headers)

    monkeypatch.setattr("factories.file_factory.ssrf_proxy.head", _fake_head)


class TestGetRemoteFileInfo:
    """Tests for _get_remote_file_info focusing on filename extraction rules."""

    def test_inline_no_filename(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "inline",
                "Content-Type": "application/pdf",
                "Content-Length": "123",
            },
        )
        mime_type, filename, size = _get_remote_file_info("http://example.com/some/path/file.pdf")
        assert filename == "file.pdf"
        assert mime_type == "application/pdf"
        assert size == 123

    def test_attachment_no_filename(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "attachment",
                "Content-Type": "application/octet-stream",
                "Content-Length": "456",
            },
        )
        mime_type, filename, size = _get_remote_file_info("http://example.com/downloads/data.bin")
        assert filename == "data.bin"
        assert mime_type == "application/octet-stream"
        assert size == 456

    def test_attachment_quoted_space_filename(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": 'attachment; filename="file name.jpg"',
                "Content-Type": "image/jpeg",
                "Content-Length": "789",
            },
        )
        mime_type, filename, size = _get_remote_file_info("http://example.com/ignored")
        assert filename == "file name.jpg"
        assert mime_type == "image/jpeg"
        assert size == 789

    def test_attachment_filename_star_percent20(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "attachment; filename*=UTF-8''file%20name.jpg",
                "Content-Type": "image/jpeg",
            },
        )
        mime_type, filename, _ = _get_remote_file_info("http://example.com/ignored")
        assert filename == "file name.jpg"
        assert mime_type == "image/jpeg"

    def test_attachment_filename_star_chinese(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6.jpg",
                "Content-Type": "image/jpeg",
            },
        )
        mime_type, filename, _ = _get_remote_file_info("http://example.com/ignored")
        assert filename == "测试文件.jpg"
        assert mime_type == "image/jpeg"

    def test_filename_from_url_when_no_header(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                # No Content-Disposition
                "Content-Type": "text/plain",
                "Content-Length": "12",
            },
        )
        mime_type, filename, size = _get_remote_file_info("http://example.com/static/file.txt")
        assert filename == "file.txt"
        assert mime_type == "text/plain"
        assert size == 12

    def test_no_filename_in_url_or_header_generates_uuid_bin(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "inline",
                "Content-Type": "application/octet-stream",
            },
        )
        mime_type, filename, _ = _get_remote_file_info("http://example.com/test/")
        # Should generate a random hex filename with .bin extension
        assert re.match(r"^[0-9a-f]{32}\.bin$", filename) is not None
        assert mime_type == "application/octet-stream"
