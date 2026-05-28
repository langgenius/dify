import re
from unittest.mock import MagicMock

import pytest

from factories.file_factory import builders
from factories.file_factory.remote import extract_filename, get_remote_file_info
from graphon.file import FileTransferMethod


class _FakeResponse:
    def __init__(self, status_code: int, headers: dict[str, str]):
        self.status_code = status_code
        self.headers = headers


def _mock_head(monkeypatch: pytest.MonkeyPatch, headers: dict[str, str], status_code: int = 200):
    def _fake_head(url: str, follow_redirects: bool = True):
        return _FakeResponse(status_code=status_code, headers=headers)

    monkeypatch.setattr("factories.file_factory.remote.ssrf_proxy.head", _fake_head)


class TestGetRemoteFileInfo:
    """Tests for get_remote_file_info focusing on filename extraction rules."""

    def test_inline_no_filename(self, monkeypatch: pytest.MonkeyPatch):
        _mock_head(
            monkeypatch,
            {
                "Content-Disposition": "inline",
                "Content-Type": "application/pdf",
                "Content-Length": "123",
            },
        )
        mime_type, filename, size = get_remote_file_info("http://example.com/some/path/file.pdf")
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
        mime_type, filename, size = get_remote_file_info("http://example.com/downloads/data.bin")
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
        mime_type, filename, size = get_remote_file_info("http://example.com/ignored")
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
        mime_type, filename, _ = get_remote_file_info("http://example.com/ignored")
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
        mime_type, filename, _ = get_remote_file_info("http://example.com/ignored")
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
        mime_type, filename, size = get_remote_file_info("http://example.com/static/file.txt")
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
        mime_type, filename, _ = get_remote_file_info("http://example.com/test/")
        # Should generate a random hex filename with .bin extension
        assert re.match(r"^[0-9a-f]{32}\.bin$", filename) is not None
        assert mime_type == "application/octet-stream"


class TestExtractFilename:
    """Tests for extract_filename focusing on RFC5987 parsing and security."""

    def test_no_content_disposition_uses_url_basename(self):
        """Test that URL basename is used when no Content-Disposition header."""
        result = extract_filename("http://example.com/path/file.txt", None)
        assert result == "file.txt"

    def test_no_content_disposition_with_percent_encoded_url(self):
        """Test that percent-encoded URL basename is decoded."""
        result = extract_filename("http://example.com/path/file%20name.txt", None)
        assert result == "file name.txt"

    def test_no_content_disposition_empty_url_path(self):
        """Test that empty URL path returns None."""
        result = extract_filename("http://example.com/", None)
        assert result is None

    def test_simple_filename_header(self):
        """Test basic filename extraction from Content-Disposition."""
        result = extract_filename("http://example.com/", 'attachment; filename="test.txt"')
        assert result == "test.txt"

    def test_quoted_filename_with_spaces(self):
        """Test filename with spaces in quotes."""
        result = extract_filename("http://example.com/", 'attachment; filename="my file.txt"')
        assert result == "my file.txt"

    def test_unquoted_filename(self):
        """Test unquoted filename."""
        result = extract_filename("http://example.com/", "attachment; filename=test.txt")
        assert result == "test.txt"

    def test_percent_encoded_filename(self):
        """Test percent-encoded filename."""
        result = extract_filename("http://example.com/", 'attachment; filename="file%20name.txt"')
        assert result == "file name.txt"

    def test_rfc5987_filename_star_utf8(self):
        """Test RFC5987 filename* with UTF-8 encoding."""
        result = extract_filename("http://example.com/", "attachment; filename*=UTF-8''file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_chinese(self):
        """Test RFC5987 filename* with Chinese characters."""
        result = extract_filename(
            "http://example.com/", "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6.txt"
        )
        assert result == "测试文件.txt"

    def test_rfc5987_filename_star_with_language(self):
        """Test RFC5987 filename* with language tag."""
        result = extract_filename("http://example.com/", "attachment; filename*=UTF-8'en'file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_fallback_charset(self):
        """Test RFC5987 filename* with fallback charset."""
        result = extract_filename("http://example.com/", "attachment; filename*=''file%20name.txt")
        assert result == "file name.txt"

    def test_rfc5987_filename_star_malformed_fallback(self):
        """Test RFC5987 filename* with malformed format falls back to simple unquote."""
        result = extract_filename("http://example.com/", "attachment; filename*=malformed%20filename.txt")
        assert result == "malformed filename.txt"

    def test_filename_star_takes_precedence_over_filename(self):
        """Test that filename* takes precedence over filename."""
        test_string = 'attachment; filename="old.txt"; filename*=UTF-8\'\'new.txt"'
        result = extract_filename("http://example.com/", test_string)
        assert result == "new.txt"

    def test_path_injection_protection(self):
        """Test that path injection attempts are blocked by os.path.basename."""
        result = extract_filename("http://example.com/", 'attachment; filename="../../../etc/passwd"')
        assert result == "passwd"

    def test_path_injection_protection_rfc5987(self):
        """Test that path injection attempts in RFC5987 are blocked."""
        result = extract_filename("http://example.com/", "attachment; filename*=UTF-8''..%2F..%2F..%2Fetc%2Fpasswd")
        assert result == "passwd"

    def test_empty_filename_returns_none(self):
        """Test that empty filename returns None."""
        result = extract_filename("http://example.com/", 'attachment; filename=""')
        assert result is None

    def test_whitespace_only_filename_returns_none(self):
        """Test that whitespace-only filename returns None."""
        result = extract_filename("http://example.com/", 'attachment; filename="   "')
        assert result is None

    def test_complex_rfc5987_encoding(self):
        """Test complex RFC5987 encoding with special characters."""
        result = extract_filename(
            "http://example.com/",
            "attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87%E6%96%87%E4%BB%B6%20%28%E5%89%AF%E6%9C%AC%29.pdf",
        )
        assert result == "中文文件 (副本).pdf"

    def test_iso8859_1_encoding(self):
        """Test ISO-8859-1 encoding in RFC5987."""
        result = extract_filename("http://example.com/", "attachment; filename*=ISO-8859-1''file%20name.txt")
        assert result == "file name.txt"

    def test_encoding_error_fallback(self):
        """Test that encoding errors fall back to safe ASCII filename."""
        result = extract_filename("http://example.com/", "attachment; filename*=INVALID-CHARSET''file%20name.txt")
        assert result == "file name.txt"

    def test_mixed_quotes_and_encoding(self):
        """Test filename with mixed quotes and percent encoding."""
        result = extract_filename(
            "http://example.com/", 'attachment; filename="file%20with%20quotes%20%26%20encoding.txt"'
        )
        assert result == "file with quotes & encoding.txt"

    def test_url_with_query_string(self):
        """Test that query strings are stripped from URL basename."""
        result = extract_filename("http://example.com/path/file.txt?signature=abc123&expires=12345", None)
        assert result == "file.txt"

    def test_url_with_hash_fragment(self):
        """Test that hash fragments are stripped from URL basename."""
        result = extract_filename("http://example.com/path/file.txt#section", None)
        assert result == "file.txt"

    def test_url_with_query_and_fragment(self):
        """Test that both query strings and hash fragments are stripped."""
        result = extract_filename("http://example.com/path/file.txt?token=xyz#section", None)
        assert result == "file.txt"

    def test_signed_url_preserves_filename(self):
        """Test that signed URL parameters don't affect filename extraction."""
        result = extract_filename(
            "http://storage.example.com/bucket/documents/report.pdf?AWSAccessKeyId=xxx&Signature=yyy&Expires=12345",
            None,
        )
        assert result == "report.pdf"

    def test_percent_encoded_filename_with_query_string(self):
        """Test percent-encoded filename with query string is decoded correctly."""
        result = extract_filename("http://example.com/path/my%20file.txt?download=true", None)
        assert result == "my file.txt"

    def test_percent_encoded_filename_with_fragment(self):
        """Test percent-encoded filename with fragment is decoded correctly."""
        result = extract_filename("http://example.com/path/my%20file.txt#page=1", None)
        assert result == "my file.txt"

    def test_complex_percent_encoding_with_query(self):
        """Test complex percent-encoded filename with query parameters."""
        result = extract_filename("http://example.com/docs/%E4%B8%AD%E6%96%87%E6%96%87%E4%BB%B6.pdf?v=1", None)
        assert result == "中文文件.pdf"

    def test_url_with_special_chars_in_query(self):
        """Test that special characters in query string don't affect filename."""
        result = extract_filename("http://example.com/file.bin?name=test&path=/some/path", None)
        assert result == "file.bin"

    def test_malformed_percent_encoding_safe_fallback(self):
        """Test that malformed percent-encoding is handled safely."""
        result = extract_filename("http://example.com/path/file%20name%GG.txt?x=1", None)
        # %GG is invalid, should be replaced with replacement character

        assert "file" in result
        assert ".txt" in result

    def test_empty_path_with_query_returns_none(self):
        """Test that empty path with query string returns None."""
        result = extract_filename("http://example.com/?query=value", None)
        assert result is None

    def test_path_only_with_query_string(self):
        """Test bare path (not full URL) with query string."""
        result = extract_filename("/path/to/file.txt?extra=params", None)
        assert result == "file.txt"


class TestBuildFromDatasourceFile:
    """Tests for _build_from_datasource_file extension handling."""

    @staticmethod
    def _patch_session(monkeypatch: pytest.MonkeyPatch, datasource_file):
        """Stub session_factory.create_session() so it returns the given UploadFile-shaped record."""
        session = MagicMock()
        session.scalar.return_value = datasource_file
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        monkeypatch.setattr(builders.session_factory, "create_session", lambda: ctx)

    def _make_datasource_file(self, *, key: str, mime_type: str = "text/csv"):
        f = MagicMock()
        f.id = "file-id"
        f.key = key
        f.name = key.split("/")[-1]
        f.mime_type = mime_type
        f.size = 123
        f.source_url = f"https://example.com/{key}"
        return f

    def test_extension_passed_without_doubled_dot(self, monkeypatch: pytest.MonkeyPatch):
        """Regression: standardize_file_type must receive the extension exactly once-prefixed.

        Previously the call was ``standardize_file_type(extension="." + extension, ...)`` while
        ``extension`` already had a leading dot, producing ``"..csv"``. The mitigating
        ``lstrip(".")`` inside ``standardize_file_type`` masked the bug from end users, but the
        argument shape itself was wrong and showed up in any caller that didn't strip dots.
        """
        captured: dict = {}

        def fake_standardize(*, extension: str = "", mime_type: str = ""):
            from graphon.file import FileType

            captured["extension"] = extension
            captured["mime_type"] = mime_type
            return FileType.DOCUMENT

        monkeypatch.setattr(builders, "standardize_file_type", fake_standardize)

        datasource_file = self._make_datasource_file(key="folder/data.csv", mime_type="text/csv")
        self._patch_session(monkeypatch, datasource_file)

        access_controller = MagicMock()
        access_controller.apply_upload_file_filters = lambda stmt: stmt

        file = builders._build_from_datasource_file(
            mapping={"datasource_file_id": "file-id", "transfer_method": "datasource_file"},
            tenant_id="tenant-id",
            transfer_method=FileTransferMethod.DATASOURCE_FILE,
            access_controller=access_controller,
        )

        assert captured["extension"] == ".csv", (
            f"standardize_file_type received {captured['extension']!r}; expected single-dot '.csv'"
        )
        assert captured["mime_type"] == "text/csv"
        assert file.extension == ".csv"

    def test_extension_falls_back_to_bin_when_key_has_no_dot(self, monkeypatch: pytest.MonkeyPatch):
        captured: dict = {}

        def fake_standardize(*, extension: str = "", mime_type: str = ""):
            from graphon.file import FileType

            captured["extension"] = extension
            return FileType.CUSTOM

        monkeypatch.setattr(builders, "standardize_file_type", fake_standardize)

        datasource_file = self._make_datasource_file(key="dotless-key", mime_type="application/octet-stream")
        self._patch_session(monkeypatch, datasource_file)

        access_controller = MagicMock()
        access_controller.apply_upload_file_filters = lambda stmt: stmt

        file = builders._build_from_datasource_file(
            mapping={"datasource_file_id": "file-id", "transfer_method": "datasource_file"},
            tenant_id="tenant-id",
            transfer_method=FileTransferMethod.DATASOURCE_FILE,
            access_controller=access_controller,
        )

        assert captured["extension"] == ".bin"
        assert file.extension == ".bin"
