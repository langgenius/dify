from flask import Response
import pytest

from controllers.common.file_response import (
    enforce_download_for_html,
    is_html_content,
    _normalize_mime_type,
)


class TestNormalizeMimeType:
    def test_returns_empty_string_for_none(self):
        assert _normalize_mime_type(None) == ""

    def test_returns_empty_string_for_empty_string(self):
        assert _normalize_mime_type("") == ""

    def test_normalizes_mime_type(self):
        assert _normalize_mime_type("Text/HTML; Charset=UTF-8") == "text/html"


class TestIsHtmlContent:
    def test_detects_html_via_mime_type(self):
        mime_type = "text/html; charset=UTF-8"

        result = is_html_content(
            mime_type=mime_type,
            filename="file.txt",
            extension="txt",
        )

        assert result is True

    def test_detects_html_via_extension_argument(self):
        result = is_html_content(
            mime_type="text/plain",
            filename=None,
            extension="html",
        )

        assert result is True

    def test_detects_html_via_filename_extension(self):
        result = is_html_content(
            mime_type="text/plain",
            filename="report.html",
            extension=None,
        )

        assert result is True

    def test_returns_false_when_no_html_detected_anywhere(self):
        """
        Missing negative test:
        - MIME type is not HTML
        - filename has no HTML extension
        - extension argument is not HTML
        """
        result = is_html_content(
            mime_type="application/json",
            filename="data.json",
            extension="json",
        )

        assert result is False

    def test_returns_false_when_all_inputs_are_none(self):
        result = is_html_content(
            mime_type=None,
            filename=None,
            extension=None,
        )

        assert result is False


class TestEnforceDownloadForHtml:
    def test_sets_attachment_when_filename_missing(self):
        response = Response("payload", mimetype="text/html")

        updated = enforce_download_for_html(
            response,
            mime_type="text/html",
            filename=None,
            extension="html",
        )

        assert updated is True
        assert response.headers["Content-Disposition"] == "attachment"
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_sets_headers_when_filename_present(self):
        response = Response("payload", mimetype="text/html")

        updated = enforce_download_for_html(
            response,
            mime_type="text/html",
            filename="unsafe.html",
            extension="html",
        )

        assert updated is True
        assert response.headers["Content-Disposition"].startswith("attachment")
        assert "unsafe.html" in response.headers["Content-Disposition"]
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_does_not_modify_response_for_non_html_content(self):
        response = Response("payload", mimetype="text/plain")

        updated = enforce_download_for_html(
            response,
            mime_type="text/plain",
            filename="notes.txt",
            extension="txt",
        )

        assert updated is False
        assert "Content-Disposition" not in response.headers
        assert "X-Content-Type-Options" not in response.headers
