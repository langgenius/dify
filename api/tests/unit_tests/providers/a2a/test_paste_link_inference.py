"""URL-only metadata inference retains the bounded no-credential fetch contract."""

import httpx
import pytest
from sqlalchemy import func, select

from machinery.context import RequestContext
from models.model import UploadFile
from providers.a2a.test_files import ExternalTestFileUpload
from providers.a2a.transport import BoundedTransport
from services.external_agents.file_profile import FileLimits
from services.external_agents.io_contracts import ExternalIOError
from tests.unit_tests.providers.a2a.test_files import FileDomain, file_domain

__all__ = ["file_domain"]


class InferencePeer:
    def __init__(self, data: bytes, media_type: str, disposition: str = "") -> None:
        self.data, self.media_type, self.disposition = data, media_type, disposition
        self.requests: list[tuple[str, str]] = []

    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        self.requests.append((method, url))
        assert kwargs["follow_redirects"] is False
        assert kwargs["max_retries"] == 0
        assert kwargs["ssl_verify"] is True
        headers = kwargs["headers"]
        assert isinstance(headers, dict)
        assert "Authorization" not in headers
        assert "Cookie" not in headers
        return httpx.Response(
            200,
            content=self.data,
            headers={
                "content-type": self.media_type,
                "content-disposition": self.disposition,
                "content-length": str(len(self.data)),
            },
        )


@pytest.mark.parametrize(
    ("data", "media", "disposition", "url", "expected_name", "expected_media"),
    [
        (
            b"%PDF-1.4\nfixture",
            "application/pdf",
            "attachment; filename*=UTF-8''contract%20review.pdf",
            "https://files.example/download?token=not-a-name",
            "contract review.pdf",
            "application/pdf",
        ),
        (
            b"# Markdown\n",
            "application/octet-stream",
            "attachment; filename=report.md",
            "https://files.example/download",
            "report.md",
            "text/markdown",
        ),
        (
            b"\x89PNG\r\n\x1a\nfixture",
            "application/octet-stream",
            "",
            "https://files.example/download?signature=not-a-name",
            "download.png",
            "image/png",
        ),
        (b"\xff\xd8\xfffixture", "image/jpeg", "", "https://files.example/picture.jpeg", "picture.jpeg", "image/jpeg"),
        (
            b"plain UTF-8 text",
            "",
            "attachment; filename=../../report.exe",
            "https://files.example/download",
            "report.txt",
            "text/plain",
        ),
        (
            b"<svg>literal code</svg>",
            "text/plain",
            "",
            "https://files.example/example.txt",
            "example.txt",
            "text/plain",
        ),
        (
            b"# Example\n<html>literal</html>",
            "text/markdown; charset=utf-8",
            "",
            "https://files.example/example.md",
            "example.md",
            "text/markdown",
        ),
    ],
)
def test_url_only_uses_one_bounded_get_and_safe_supported_metadata(
    file_domain: FileDomain,
    data: bytes,
    media: str,
    disposition: str,
    url: str,
    expected_name: str,
    expected_media: str,
) -> None:
    _, files, _, sessions, _ = file_domain
    peer = InferencePeer(data, media, disposition)
    adapter = ExternalTestFileUpload(files=files, remote=BoundedTransport(peer), limits=FileLimits())
    blob = adapter.fetch(RequestContext("paste", None, "actor-a", "tenant-a"), url=url, filename=None, media_type=None)
    assert (blob.filename, blob.media_type, blob.data) == (expected_name, expected_media, data)
    assert peer.requests == [("GET", url)]
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(UploadFile)) == 0


@pytest.mark.parametrize(
    ("body", "media"),
    [
        (b"<html>not PDF</html>", "application/pdf"),
        (b"arbitrary\x00binary", "image/png"),
        (b"%PDF-1.4\nfixture", "image/jpeg"),
        (b"<svg>unsupported</svg>", "image/svg+xml"),
        (b"<html>unsupported</html>", "text/html"),
        (b"text\x00binary", "text/plain"),
        (b"\xff\xfeinvalid UTF8", "text/markdown"),
    ],
)
def test_auto_inference_does_not_trust_spoofed_binary_or_unsupported_response_types(
    file_domain: FileDomain, body: bytes, media: str
) -> None:
    _, files, _, _, _ = file_domain
    peer = InferencePeer(body, media)
    adapter = ExternalTestFileUpload(files=files, remote=BoundedTransport(peer), limits=FileLimits())
    with pytest.raises(ExternalIOError) as error:
        adapter.fetch(
            RequestContext("paste", None, "actor-a", "tenant-a"),
            url="https://files.example/cannot-trust-suffix.md",
            filename=None,
            media_type=None,
        )
    assert error.value.code == "unsupported_file_type"
    assert len(peer.requests) == 1


def test_explicit_metadata_overrides_remain_compatible_and_cannot_remove_byte_limits(file_domain: FileDomain) -> None:
    _, files, _, _, _ = file_domain
    peer = InferencePeer(b"legacy literal body", "application/octet-stream")
    adapter = ExternalTestFileUpload(files=files, remote=BoundedTransport(peer), limits=FileLimits())
    value = adapter.fetch(
        RequestContext("paste", None, "actor-a", "tenant-a"),
        url="https://files.example/report",
        filename="legacy.pdf",
        media_type="application/x-pdf; version=1",
    )
    assert value.filename == "legacy.pdf"
    assert value.media_type == "application/pdf"
    bounded = ExternalTestFileUpload(
        files=files,
        remote=BoundedTransport(peer),
        limits=FileLimits(max_document_bytes=5, max_image_bytes=7, max_total_bytes=8),
    )
    with pytest.raises(ExternalIOError) as error:
        bounded.fetch(
            RequestContext("paste", None, "actor-a", "tenant-a"),
            url="https://files.example/report",
            filename=None,
            media_type=None,
        )
    assert error.value.code == "file_fetch_failed"
