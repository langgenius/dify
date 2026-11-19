"""Regression tests for Content-Disposition filename* encoding in remote file responses.

RFC 5987 / RFC 6266 restrict the filename* value to percent-encoded octets and
attr-char characters; a path separator is not an attr-char. urllib.parse.quote
defaults to safe="/" and leaves "/" literal, producing an invalid header that
strict clients reject. The value must be encoded with safe="".
"""

import pytest

from core.file import remote_fetcher


def _content_disposition(filename: str | None) -> str | None:
    response = remote_fetcher._build_response(
        method="GET",
        url="https://example.com/files/abc/file-preview",
        status_code=200,
        filename=filename,
    )
    return response.headers.get("Content-Disposition")


@pytest.mark.parametrize(
    ("filename", "expected_value"),
    [
        ("reports/2024.csv", "reports%2F2024.csv"),
        ("a/b/c.txt", "a%2Fb%2Fc.txt"),
        ("/absolute/report.pdf", "%2Fabsolute%2Freport.pdf"),
    ],
)
def test_filename_star_percent_encodes_path_separators(filename: str, expected_value: str) -> None:
    assert _content_disposition(filename) == f"attachment; filename*=UTF-8''{expected_value}"


def test_filename_star_keeps_ordinary_names_encoded() -> None:
    assert _content_disposition("report.pdf") == "attachment; filename*=UTF-8''report.pdf"
    assert _content_disposition("my report.pdf") == "attachment; filename*=UTF-8''my%20report.pdf"
    assert _content_disposition("a+b(1).txt") == "attachment; filename*=UTF-8''a%2Bb%281%29.txt"


def test_no_content_disposition_without_filename() -> None:
    assert _content_disposition(None) is None
