import re

import pytest

from factories.file_factory import _extract_filename, _get_remote_file_info


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


class TestExtractFilename:
    """Tests for _extract_filename function focusing on RFC5987 parsing and security."""

    def test_no_content_disposition_uses_url_basename(self):
        """Test that URL basename is used when no Content-Disposition header."""
        result = _extract_filename("http://example.com/path/file.txt", None)
        assert result == "file.txt"

    def test_no_content_disposition_with_percent_encoded_url(self):
        """Test that percent-encoded URL basename is decoded."""
        result = _extract_filename("http://example.com/path/file%20name.txt", None)
        assert result == "file name.txt"

    def test_no_content_disposition_empty_url_path(self):
        """Test that empty URL path returns None."""
        result = _extract_filename("http://example.com/", None)
        assert result is None

    def test_simple_filename_header(self):
        """Test basic filename extraction from Content-Disposition."""
        result = _extract_filename("http://example.com/", 'attachment; filename="test.txt"')
        assert result == "test.txt"

    def test_quoted_filename_with_spaces(self):
        """Test filename with spaces in quotes."""
        result = _extract_filename("http://example.com/", 'attachment; filename="my file.txt"')
        assert result == "my file.txt"

    def test_unquoted_filename(self):
        """Test unquoted filename."""
        result = _extract_filename("http://example.com/", "attachment; filename=test.txt")
        assert result == "test.txt"

    def test_percent_encoded_filename(self):
        """Test percent-encoded filename."""
        result = _extract_filename("http://example.com/", 'attachment; filename="file%20name.txt"')
        assert result == "file name.txt"

    def test_rfc5987_filename_star_utf8(self):
        """Test RFC5987 filename* with UTF-8 encoding."""
        result = _extract_filename("http://example.com/", "attachment; filename*=UTF-8''file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_chinese(self):
        """Test RFC5987 filename* with Chinese characters."""
        result = _extract_filename(
            "http://example.com/", "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6.txt"
        )
        assert result == "测试文件.txt"

    def test_rfc5987_filename_star_with_language(self):
        """Test RFC5987 filename* with language tag."""
        result = _extract_filename("http://example.com/", "attachment; filename*=UTF-8'en'file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_fallback_charset(self):
        """Test RFC5987 filename* with fallback charset."""
        result = _extract_filename("http://example.com/", "attachment; filename*=''file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_malformed_fallback(self):
        """Test RFC5987 filename* with malformed format falls back to simple unquote."""
        result = _extract_filename("http://example.com/", "attachment; filename*=malformed%20filename.txt")
        assert result == "malformed filename.txt"

    def test_filename_star_takes_precedence_over_filename(self):
        """Test that filename* takes precedence over filename."""
        test_string = 'attachment; filename="old.txt"; filename*=UTF-8\'\'new.txt"'
        result = _extract_filename("http://example.com/", test_string)
        assert result == "new.txt"

    def test_path_injection_protection(self):
        """Test that path injection attempts are blocked by os.path.basename."""
        result = _extract_filename("http://example.com/", 'attachment; filename="../../../etc/passwd"')
        assert result == "passwd"

    def test_path_injection_protection_rfc5987(self):
        """Test that path injection attempts in RFC5987 are blocked."""
        result = _extract_filename("http://example.com/", "attachment; filename*=UTF-8''..%2F..%2F..%2Fetc%2Fpasswd")
        assert result == "passwd"

    def test_empty_filename_returns_none(self):
        """Test that empty filename returns None."""
        result = _extract_filename("http://example.com/", 'attachment; filename=""')
        assert result is None

    def test_whitespace_only_filename_returns_none(self):
        """Test that whitespace-only filename returns None."""
        result = _extract_filename("http://example.com/", 'attachment; filename="   "')
        assert result is None

    def test_complex_rfc5987_encoding(self):
        """Test complex RFC5987 encoding with special characters."""
        result = _extract_filename(
            "http://example.com/",
            "attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87%E6%96%87%E4%BB%B6%20%28%E5%89%AF%E6%9C%AC%29.pdf",
        )
        assert result == "中文文件 (副本).pdf"

    def test_iso8859_1_encoding(self):
        """Test ISO-8859-1 encoding in RFC5987."""
        result = _extract_filename("http://example.com/", "attachment; filename*=ISO-8859-1''file%20name.txt")
        assert result == "file name.txt"

    def test_encoding_error_fallback(self):
        """Test that encoding errors fall back to safe ASCII filename."""
        result = _extract_filename("http://example.com/", "attachment; filename*=INVALID-CHARSET''file%20name.txt")
        assert result == "file name.txt"

    def test_mixed_quotes_and_encoding(self):
        """Test filename with mixed quotes and percent encoding."""
        result = _extract_filename(
            "http://example.com/", 'attachment; filename="file%20with%20quotes%20%26%20encoding.txt"'
        )
        assert result == "file with quotes & encoding.txt"
