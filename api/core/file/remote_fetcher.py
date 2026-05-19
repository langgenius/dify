"""Unified remote-file retrieval with Dify signed file URL resolution.

Use this module for backend workflows whose intent is to fetch remote file content
or remote file metadata from a URL, even when the URL originally came from a user
upload, a workflow variable, a tool/datasource file, or an app DSL. GET/HEAD
requests can resolve Dify-signed file URLs locally through DB + storage before
falling back to the SSRF-protected network client.

Use `core.helper.ssrf_proxy` directly only for generic outbound HTTP where the
URL is not being treated as a remote file, such as HTTP Request nodes, external
API integrations, auth discovery, or user-configured tool calls. Those calls must
stay as real network requests and should not reinterpret Dify file URLs as stored
files.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.db.session_factory import session_factory
from core.helper import ssrf_proxy
from core.helper.ssrf_proxy import (
    SSRF_DEFAULT_MAX_RETRIES,
    _to_graphon_http_response,
    max_retries_exceeded_error,
    request_error,
)
from extensions.ext_storage import storage
from models import ToolFile, UploadFile

_UPLOAD_FILE_PATH_PATTERN = re.compile(
    r"^/files/(?P<file_id>[a-fA-F0-9-]+)/(?P<preview_kind>file-preview|image-preview)$"
)
_TOOL_FILE_PATH_PATTERN = re.compile(r"^/files/tools/(?P<file_id>[a-fA-F0-9-]+)\.(?P<extension>[^/]+)$")
_DATASOURCE_FILE_PATH_PATTERN = re.compile(r"^/files/datasources/(?P<file_id>[a-fA-F0-9-]+)\.(?P<extension>[^/]+)$")

_file_access_controller = DatabaseFileAccessController()


@dataclass(frozen=True)
class _SignedFileUrl:
    file_id: str
    preview_kind: Literal["file-preview", "image-preview"]
    record_kind: Literal["upload", "tool", "datasource"]


def make_request(method: str, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    """Fetch remote file content or metadata.

    GET and HEAD requests for Dify-owned signed file URLs are served from local
    storage. Every other request is delegated unchanged to the SSRF proxy.
    """

    normalized_method = method.upper()
    if normalized_method == "GET":
        response = _resolve_dify_signed_file_url("GET", url)
        if response is not None:
            return response
    if normalized_method == "HEAD":
        response = _resolve_dify_signed_file_url("HEAD", url)
        if response is not None:
            return response
    return ssrf_proxy.make_request(method=method, url=url, max_retries=max_retries, **kwargs)


def get(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    """Fetch remote file content, resolving Dify-owned signed file URLs locally."""

    response = _resolve_dify_signed_file_url("GET", url)
    if response is not None:
        return response
    return ssrf_proxy.get(url=url, max_retries=max_retries, **kwargs)


def head(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    """Fetch remote file metadata, resolving Dify-owned signed file URLs locally."""

    response = _resolve_dify_signed_file_url("HEAD", url)
    if response is not None:
        return response
    return ssrf_proxy.head(url=url, max_retries=max_retries, **kwargs)


def post(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return ssrf_proxy.post(url=url, max_retries=max_retries, **kwargs)


def put(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return ssrf_proxy.put(url=url, max_retries=max_retries, **kwargs)


def delete(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return ssrf_proxy.delete(url=url, max_retries=max_retries, **kwargs)


def patch(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return ssrf_proxy.patch(url=url, max_retries=max_retries, **kwargs)


class GraphonRemoteFileFetcher:
    """Graphon HTTP-client adapter backed by the unified remote-file fetcher."""

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return max_retries_exceeded_error

    @property
    def request_error(self) -> type[Exception]:
        return request_error

    def get(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(get(url=url, max_retries=max_retries, **kwargs))

    def head(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(head(url=url, max_retries=max_retries, **kwargs))

    def post(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(post(url=url, max_retries=max_retries, **kwargs))

    def put(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(put(url=url, max_retries=max_retries, **kwargs))

    def delete(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(delete(url=url, max_retries=max_retries, **kwargs))

    def patch(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(patch(url=url, max_retries=max_retries, **kwargs))


def _resolve_dify_signed_file_url(method: Literal["GET", "HEAD"], url: str) -> httpx.Response | None:
    parsed_url = urllib.parse.urlparse(url)
    if not _is_dify_file_origin(parsed_url):
        return None

    signed_file_url = _parse_signed_file_path(parsed_url.path)
    if signed_file_url is None:
        return None

    query = urllib.parse.parse_qs(parsed_url.query, keep_blank_values=True)
    timestamp = _single_query_value(query, "timestamp")
    nonce = _single_query_value(query, "nonce")
    sign = _single_query_value(query, "sign")
    if timestamp is None or nonce is None or sign is None:
        return None

    if not _verify_signed_file_url(
        signed_file_url=signed_file_url,
        timestamp=timestamp,
        nonce=nonce,
        sign=sign,
    ):
        return None

    if signed_file_url.record_kind == "upload":
        return _build_upload_file_response(method=method, url=url, file_id=signed_file_url.file_id)
    if signed_file_url.record_kind == "tool":
        return _build_tool_file_response(method=method, url=url, file_id=signed_file_url.file_id)
    return _build_datasource_file_response(method=method, url=url, file_id=signed_file_url.file_id)


def _parse_signed_file_path(path: str) -> _SignedFileUrl | None:
    upload_match = _UPLOAD_FILE_PATH_PATTERN.match(path)
    if upload_match:
        preview_kind: Literal["file-preview", "image-preview"]
        if upload_match.group("preview_kind") == "image-preview":
            preview_kind = "image-preview"
        else:
            preview_kind = "file-preview"

        return _SignedFileUrl(
            file_id=upload_match.group("file_id"),
            preview_kind=preview_kind,
            record_kind="upload",
        )

    tool_match = _TOOL_FILE_PATH_PATTERN.match(path)
    if tool_match:
        return _SignedFileUrl(
            file_id=tool_match.group("file_id"),
            preview_kind="file-preview",
            record_kind="tool",
        )

    datasource_match = _DATASOURCE_FILE_PATH_PATTERN.match(path)
    if datasource_match:
        return _SignedFileUrl(
            file_id=datasource_match.group("file_id"),
            preview_kind="file-preview",
            record_kind="datasource",
        )

    return None


def _is_dify_file_origin(parsed_url: urllib.parse.ParseResult) -> bool:
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
        return False

    url_origin = _origin_parts(parsed_url)
    if url_origin is None:
        return False

    allowed_origins = {
        origin
        for configured_url in [dify_config.FILES_URL, dify_config.INTERNAL_FILES_URL]
        if configured_url and (origin := _origin_parts(urllib.parse.urlparse(configured_url))) is not None
    }
    return url_origin in allowed_origins


def _origin_parts(parsed_url: urllib.parse.ParseResult) -> tuple[str, str, int] | None:
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
        return None
    return parsed_url.scheme, parsed_url.hostname.lower(), parsed_url.port or _default_port(parsed_url.scheme)


def _default_port(scheme: str) -> int:
    return 443 if scheme == "https" else 80


def _single_query_value(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if not values or len(values) != 1:
        return None
    return values[0]


def _verify_signed_file_url(
    *,
    signed_file_url: _SignedFileUrl,
    timestamp: str,
    nonce: str,
    sign: str,
) -> bool:
    try:
        current_time = int(time.time())
        signed_at = int(timestamp)
    except ValueError:
        return False

    if current_time - signed_at > dify_config.FILES_ACCESS_TIMEOUT:
        return False

    payload = f"{signed_file_url.preview_kind}|{signed_file_url.file_id}|{timestamp}|{nonce}"
    recalculated = hmac.new(dify_config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    expected = base64.urlsafe_b64encode(recalculated).decode()
    return hmac.compare_digest(sign, expected)


def _build_upload_file_response(*, method: Literal["GET", "HEAD"], url: str, file_id: str) -> httpx.Response:
    with session_factory.create_session() as session:
        upload_file = _file_access_controller.get_upload_file(session=session, file_id=file_id)
    if upload_file is None:
        return _build_response(method=method, url=url, status_code=404)

    content = b"" if method == "HEAD" else storage.load_once(upload_file.key)
    return _build_response(
        method=method,
        url=url,
        status_code=200,
        content=content,
        content_length=upload_file.size,
        content_type=upload_file.mime_type,
        filename=upload_file.name,
    )


def _build_tool_file_response(*, method: Literal["GET", "HEAD"], url: str, file_id: str) -> httpx.Response:
    with session_factory.create_session() as session:
        tool_file = _file_access_controller.get_tool_file(session=session, file_id=file_id)
    if tool_file is None:
        return _build_response(method=method, url=url, status_code=404)

    content = b"" if method == "HEAD" else storage.load_once(tool_file.file_key)
    return _build_response(
        method=method,
        url=url,
        status_code=200,
        content=content,
        content_length=tool_file.size,
        content_type=tool_file.mimetype,
        filename=tool_file.name,
    )


def _build_datasource_file_response(*, method: Literal["GET", "HEAD"], url: str, file_id: str) -> httpx.Response:
    with session_factory.create_session() as session:
        upload_file = _file_access_controller.get_upload_file(session=session, file_id=file_id)
        if upload_file is not None:
            return _build_upload_file_record_response(method=method, url=url, upload_file=upload_file)

        tool_file = _file_access_controller.get_tool_file(session=session, file_id=file_id)
        if tool_file is not None:
            return _build_tool_file_record_response(method=method, url=url, tool_file=tool_file)

    return _build_response(method=method, url=url, status_code=404)


def _build_upload_file_record_response(
    *,
    method: Literal["GET", "HEAD"],
    url: str,
    upload_file: UploadFile,
) -> httpx.Response:
    content = b"" if method == "HEAD" else storage.load_once(upload_file.key)
    return _build_response(
        method=method,
        url=url,
        status_code=200,
        content=content,
        content_length=upload_file.size,
        content_type=upload_file.mime_type,
        filename=upload_file.name,
    )


def _build_tool_file_record_response(
    *,
    method: Literal["GET", "HEAD"],
    url: str,
    tool_file: ToolFile,
) -> httpx.Response:
    content = b"" if method == "HEAD" else storage.load_once(tool_file.file_key)
    return _build_response(
        method=method,
        url=url,
        status_code=200,
        content=content,
        content_length=tool_file.size,
        content_type=tool_file.mimetype,
        filename=tool_file.name,
    )


def _build_response(
    *,
    method: Literal["GET", "HEAD"],
    url: str,
    status_code: int,
    content: bytes = b"",
    content_length: int | None = None,
    content_type: str | None = None,
    filename: str | None = None,
) -> httpx.Response:
    headers: dict[str, str] = {}
    if content_type:
        headers["Content-Type"] = content_type
    if content_length is not None and content_length >= 0:
        headers["Content-Length"] = str(content_length)
    if filename:
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}"
    return httpx.Response(
        status_code=status_code,
        headers=headers,
        content=content,
        request=httpx.Request(method, url),
    )


graphon_remote_file_fetcher = GraphonRemoteFileFetcher()
