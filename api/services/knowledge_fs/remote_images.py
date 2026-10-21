"""SSRF-safe, bounded retrieval for KnowledgeFS document image references."""

from __future__ import annotations

import hashlib
import socket
import urllib.parse
from dataclasses import dataclass

import httpx

from core.file import remote_fetcher
from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError

KNOWLEDGE_FS_REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
KNOWLEDGE_FS_REMOTE_IMAGE_MAX_URL_CHARS = 8_192
_REMOTE_IMAGE_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1"
_PERMANENT_DNS_ERROR_CODES = frozenset((socket.EAI_NONAME, socket.EAI_NODATA, socket.EAI_FAIL))


class KnowledgeFSRemoteImageError(ValueError):
    """Safe, classified failure returned across the trusted KnowledgeFS bridge."""

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class KnowledgeFSResolvedRemoteImage:
    byte_size: int
    mime_type: str
    body: bytes
    sha256: str


def load_remote_image(url: str) -> KnowledgeFSResolvedRemoteImage:
    """Resolve one user-authored image URL through Dify's SSRF-protected file client."""

    normalized_url = _validate_remote_image_url(url)
    try:
        response = remote_fetcher.make_request(
            "GET",
            normalized_url,
            follow_redirects=True,
            headers={
                "Accept": _REMOTE_IMAGE_ACCEPT,
                "Accept-Encoding": "identity",
            },
            max_retries=1,
            stream_response=True,
        )
    except ToolSSRFError as exc:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_BLOCKED",
            "Remote image access was blocked by network safety policy.",
            retryable=False,
        ) from exc
    except (httpx.TimeoutException, httpx.RequestError, ssrf_proxy.MaxRetriesExceededError) as exc:
        if _is_permanent_dns_failure(exc):
            raise KnowledgeFSRemoteImageError(
                "REMOTE_IMAGE_HOST_NOT_FOUND",
                "Remote image host could not be resolved.",
                retryable=False,
            ) from exc
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE",
            "Remote image service is temporarily unavailable.",
            retryable=True,
        ) from exc

    try:
        _assert_remote_status(response.status_code)
        declared_size = _content_length(response)
        if declared_size is not None and declared_size > KNOWLEDGE_FS_REMOTE_IMAGE_MAX_BYTES:
            raise KnowledgeFSRemoteImageError(
                "REMOTE_IMAGE_TOO_LARGE",
                "Remote image exceeds the configured size limit.",
                retryable=False,
            )
        try:
            buffered = ssrf_proxy.buffer_response(
                response,
                max_response_bytes=KNOWLEDGE_FS_REMOTE_IMAGE_MAX_BYTES,
            )
        except ssrf_proxy.ResponseTooLargeError as exc:
            raise KnowledgeFSRemoteImageError(
                "REMOTE_IMAGE_TOO_LARGE",
                "Remote image exceeds the configured size limit.",
                retryable=False,
            ) from exc
        except ssrf_proxy.UnsupportedResponseEncodingError as exc:
            raise KnowledgeFSRemoteImageError(
                "REMOTE_IMAGE_CONTENT_UNSUPPORTED",
                "Remote image response encoding is not supported.",
                retryable=False,
            ) from exc
    except Exception:
        response.close()
        raise

    body = buffered.content
    if not body:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_EMPTY",
            "Remote image is empty.",
            retryable=False,
        )
    mime_type = _detect_image_mime_type(body)
    return KnowledgeFSResolvedRemoteImage(
        byte_size=len(body),
        mime_type=mime_type,
        body=body,
        sha256=hashlib.sha256(body).hexdigest(),
    )


def _validate_remote_image_url(url: str) -> str:
    normalized = url.strip()
    if not normalized or len(normalized) > KNOWLEDGE_FS_REMOTE_IMAGE_MAX_URL_CHARS:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_URL_INVALID",
            "Remote image URL is invalid.",
            retryable=False,
        )
    parsed = urllib.parse.urlsplit(normalized)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_URL_INVALID",
            "Remote image URL is invalid.",
            retryable=False,
        )
    return normalized


def _is_permanent_dns_failure(error: BaseException) -> bool:
    """Return whether an exception chain contains a non-recoverable DNS lookup result."""

    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None:
        identity = id(current)
        if identity in seen:
            break
        seen.add(identity)
        if isinstance(current, httpx.ProxyError):
            return False
        if isinstance(current, socket.gaierror) and current.errno in _PERMANENT_DNS_ERROR_CODES:
            return True
        next_error = current.__cause__
        if next_error is None and not current.__suppress_context__:
            next_error = current.__context__
        current = next_error
    return False


def _assert_remote_status(status_code: int) -> None:
    if 200 <= status_code < 300:
        return
    if status_code in {404, 410}:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_NOT_FOUND",
            "Remote image was not found.",
            retryable=False,
        )
    if status_code == 429:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_RATE_LIMITED",
            "Remote image service rate limited the request.",
            retryable=True,
        )
    if status_code in {408, 425} or status_code >= 500:
        raise KnowledgeFSRemoteImageError(
            "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE",
            "Remote image service is temporarily unavailable.",
            retryable=True,
        )
    raise KnowledgeFSRemoteImageError(
        "REMOTE_IMAGE_REQUEST_REJECTED",
        "Remote image request was rejected.",
        retryable=False,
    )


def _content_length(response: httpx.Response) -> int | None:
    value = response.headers.get("content-length")
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _detect_image_mime_type(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(body) >= 12 and body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    raise KnowledgeFSRemoteImageError(
        "REMOTE_IMAGE_CONTENT_UNSUPPORTED",
        "Remote image content is not supported.",
        retryable=False,
    )
