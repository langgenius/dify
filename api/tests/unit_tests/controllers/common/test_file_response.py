from flask import Response

from controllers.common.file_response import enforce_download_for_html, is_html_content


class TestFileResponseHelpers:
    def test_is_html_content_detects_mime_type(self):
        mime_type = "text/html; charset=UTF-8"

        result = is_html_content(mime_type, filename="file.txt", extension="txt")

        assert result is True

    def test_is_html_content_detects_extension(self):
        result = is_html_content("text/plain", filename="report.html", extension=None)

        assert result is True

    def test_enforce_download_for_html_sets_headers(self):
        response = Response("payload", mimetype="text/html")

        updated = enforce_download_for_html(
            response,
            mime_type="text/html",
            filename="unsafe.html",
            extension="html",
        )

        assert updated is True
        assert "attachment" in response.headers["Content-Disposition"]
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_enforce_download_for_html_no_change_for_non_html(self):
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
