import pytest
from flask import Response

from controllers.common.file_response import (
    _normalize_mime_type,
    harden_active_content_response,
    is_active_content,
)


class TestNormalizeMimeType:
    def test_returns_empty_string_for_none(self) -> None:
        assert _normalize_mime_type(None) == ""

    def test_returns_empty_string_for_empty_string(self) -> None:
        assert _normalize_mime_type("") == ""

    def test_normalizes_mime_type(self) -> None:
        assert _normalize_mime_type("Text/HTML; Charset=UTF-8") == "text/html"


class TestIsActiveContent:
    @pytest.mark.parametrize(
        ("mime_type", "filename", "extension"),
        [
            ("Image/SVG+XML; charset=UTF-8", "image.png", "png"),
            ("image/png", "image.SVG", "png"),
            ("image/png", "image.png", ".SVG"),
            (None, "image.svgz", None),
            (None, None, "svgz"),
            ("application/xhtml+xml", None, None),
            (None, None, ".HTM"),
            ("application/xml", "image.txt", "txt"),
            ("Text/XML; Charset=UTF-8", "image.txt", "txt"),
            ("Application/Vnd.Dify+XML; charset=UTF-8", None, None),
            ("text/xsl", None, None),
            (None, "image.XML", None),
            (None, None, ".XML"),
            (None, "image.xsl", None),
            (None, None, "xslt"),
        ],
    )
    def test_detects_active_content_from_any_metadata(
        self, mime_type: str | None, filename: str | None, extension: str | None
    ) -> None:
        assert is_active_content(mime_type, filename, extension) is True

    def test_detects_html_via_mime_type(self) -> None:
        mime_type = "text/html; charset=UTF-8"

        result = is_active_content(
            mime_type=mime_type,
            filename="file.txt",
            extension="txt",
        )

        assert result is True

    def test_detects_html_via_extension_argument(self) -> None:
        result = is_active_content(
            mime_type="text/plain",
            filename=None,
            extension="html",
        )

        assert result is True

    def test_detects_html_via_filename_extension(self) -> None:
        result = is_active_content(
            mime_type="text/plain",
            filename="report.html",
            extension=None,
        )

        assert result is True

    def test_returns_false_for_passive_content(self) -> None:
        result = is_active_content(
            mime_type="application/json",
            filename="data.json",
            extension="json",
        )

        assert result is False

    def test_returns_false_when_all_inputs_are_none(self) -> None:
        result = is_active_content(
            mime_type=None,
            filename=None,
            extension=None,
        )

        assert result is False


class TestHardenActiveContentResponse:
    def test_sets_attachment_when_filename_missing(self) -> None:
        response = Response("payload", mimetype="text/html")

        updated = harden_active_content_response(
            response,
            mime_type="text/html",
            filename=None,
            extension="html",
        )

        assert updated is True
        assert response.headers["Content-Disposition"] == "attachment"
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Security-Policy"] == "default-src 'none'; sandbox"

    @pytest.mark.parametrize("inline_svg", [False, True])
    @pytest.mark.parametrize(
        ("mime_type", "response_mime_type", "filename"),
        [
            ("text/html", "text/html", "unsafe.html"),
            (None, None, "a"),
            ("", "", "a"),
            ("  ", "  ", "a"),
            ("image/png", "text/html", "a"),
            ("image/png", "application/xml", "a"),
            ("image/png", "text/xml", "a"),
        ],
        ids=("html", "missing-mime", "empty-mime", "blank-mime", "response-html", "response-xml", "response-text-xml"),
    )
    def test_unsafe_document_forces_download(
        self, mime_type: str | None, response_mime_type: str | None, filename: str, inline_svg: bool
    ) -> None:
        response = Response(b"<script>alert(document.domain)</script>", mimetype=response_mime_type)

        updated = harden_active_content_response(
            response,
            mime_type=mime_type,
            filename=filename,
            inline_svg=inline_svg,
        )

        assert updated is True
        assert response.headers["Content-Disposition"].startswith("attachment")
        assert filename in response.headers["Content-Disposition"]
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Security-Policy"] == "default-src 'none'; sandbox"

    def test_passive_content_only_adds_nosniff(self) -> None:
        response = Response("payload", mimetype="text/plain")

        updated = harden_active_content_response(
            response,
            mime_type="text/plain",
            filename="notes.txt",
            extension="txt",
        )

        assert updated is False
        assert "Content-Disposition" not in response.headers
        assert response.headers["Content-Type"] == "text/plain; charset=utf-8"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert "Content-Security-Policy" not in response.headers
