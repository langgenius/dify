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
import ipaddress
import re
import socket
import string
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
from core.tools.errors import ToolSSRFError
from extensions.ext_storage import storage
from models import ToolFile, UploadFile

_UPLOAD_FILE_PATH_PATTERN = re.compile(
    r"^/files/(?P<file_id>[a-fA-F0-9-]+)/(?P<preview_kind>file-preview|image-preview)$"
)
_TOOL_FILE_PATH_PATTERN = re.compile(r"^/files/tools/(?P<file_id>[a-fA-F0-9-]+)(?P<extension>\.[^/]*)?$")
_DATASOURCE_FILE_PATH_PATTERN = re.compile(r"^/files/datasources/(?P<file_id>[a-fA-F0-9-]+)(?P<extension>\.[^/]*)?$")
_REMOTE_FILE_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
_REMOTE_FILE_MAX_REDIRECTS = 5

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
    _normalize_redirect_kwargs(kwargs)
    if normalized_method in {"GET", "HEAD"} and kwargs.get("follow_redirects") is True:
        return _make_request_following_safe_redirects(
            method=normalized_method,
            url=url,
            max_retries=max_retries,
            **kwargs,
        )
    return ssrf_proxy.make_request(method=method, url=url, max_retries=max_retries, **kwargs)


def _normalize_redirect_kwargs(kwargs: dict[str, Any]) -> None:
    if "allow_redirects" not in kwargs:
        return

    allow_redirects = kwargs.pop("allow_redirects")
    if "follow_redirects" not in kwargs:
        kwargs["follow_redirects"] = allow_redirects


def _make_request_following_safe_redirects(
    *,
    method: Literal["GET", "HEAD"],
    url: str,
    max_retries: int,
    **kwargs: Any,
) -> httpx.Response:
    current_url = url
    redirect_count = 0
    request_kwargs = dict(kwargs)
    request_kwargs["follow_redirects"] = False

    while True:
        _assert_public_remote_file_url(current_url)
        response = ssrf_proxy.make_request(
            method=method,
            url=current_url,
            max_retries=max_retries,
            **request_kwargs,
        )
        if response.status_code not in _REMOTE_FILE_REDIRECT_STATUS_CODES:
            return response

        location = response.headers.get("Location")
        if not location:
            return response
        if redirect_count >= _REMOTE_FILE_MAX_REDIRECTS:
            raise ToolSSRFError("Access to the remote file was blocked because it redirected too many times.")

        next_url = urllib.parse.urljoin(_response_request_url(response=response, fallback=current_url), location)
        _assert_public_remote_file_url(next_url)
        current_url = next_url
        redirect_count += 1


def _response_request_url(*, response: httpx.Response, fallback: str) -> str:
    try:
        return str(response.request.url)
    except RuntimeError:
        return fallback


def _assert_public_remote_file_url(url: str) -> None:
    parsed_url = urllib.parse.urlparse(url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
        raise ToolSSRFError("Access to the remote file was blocked because the URL must use HTTP or HTTPS.")

    try:
        port = parsed_url.port or _default_port(parsed_url.scheme)
    except ValueError as exc:
        raise ToolSSRFError("Access to the remote file was blocked because the URL port is invalid.") from exc

    host = _normalize_remote_file_host(parsed_url.hostname)
    ip_literal = _parse_ip_literal(host)
    if ip_literal is not None:
        _assert_public_ip(ip_literal)
        return

    _assert_public_dns_resolution(host=host, port=port)


def _normalize_remote_file_host(host: str) -> str:
    normalized = host.strip()
    for _ in range(3):
        decoded = urllib.parse.unquote(normalized)
        if decoded == normalized:
            break
        normalized = decoded

    normalized = normalized.rstrip(".").lower()
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    return normalized


def _parse_ip_literal(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass

    if ":" in host:
        return None
    return _parse_obscured_ipv4(host)


def _parse_obscured_ipv4(host: str) -> ipaddress.IPv4Address | None:
    parts = host.split(".")
    if not 1 <= len(parts) <= 4:
        return None

    values: list[int] = []
    for part in parts:
        value = _parse_ipv4_number(part)
        if value is None:
            return None
        values.append(value)

    if len(values) == 1:
        if values[0] > 0xFFFFFFFF:
            return None
        return ipaddress.IPv4Address(values[0])
    if len(values) == 2:
        if values[0] > 0xFF or values[1] > 0xFFFFFF:
            return None
        return ipaddress.IPv4Address((values[0] << 24) + values[1])
    if len(values) == 3:
        if values[0] > 0xFF or values[1] > 0xFF or values[2] > 0xFFFF:
            return None
        return ipaddress.IPv4Address((values[0] << 24) + (values[1] << 16) + values[2])
    if any(value > 0xFF for value in values):
        return None
    return ipaddress.IPv4Address((values[0] << 24) + (values[1] << 16) + (values[2] << 8) + values[3])


def _parse_ipv4_number(value: str) -> int | None:
    if not value:
        return None

    lowered = value.lower()
    try:
        if lowered.startswith("0x"):
            return int(lowered, 0)
        if len(lowered) > 1 and lowered.startswith("0") and all(char in string.octdigits for char in lowered):
            return int(lowered, 8)
        if lowered.isdigit():
            return int(lowered, 10)
    except ValueError:
        return None
    return None


def _assert_public_dns_resolution(*, host: str, port: int) -> None:
    try:
        addr_infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ToolSSRFError("Access to the remote file was blocked because the host could not be resolved.") from exc

    resolved_ips: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    for addr_info in addr_infos:
        sockaddr = addr_info[4]
        if not sockaddr:
            continue
        try:
            resolved_ips.add(ipaddress.ip_address(sockaddr[0]))
        except ValueError as exc:
            raise ToolSSRFError(
                "Access to the remote file was blocked because DNS returned an invalid address."
            ) from exc

    if not resolved_ips:
        raise ToolSSRFError("Access to the remote file was blocked because DNS returned no addresses.")

    for resolved_ip in resolved_ips:
        _assert_public_ip(resolved_ip)


def _assert_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if not ip.is_global or ip.is_multicast:
        raise ToolSSRFError(
            "Access to the remote file was blocked by SSRF protection. "
            "The URL may point to a private or local network address."
        )


class GraphonRemoteFileFetcher:
    """Graphon HTTP-client adapter backed by the unified remote-file fetcher.

    Graphon requires method-specific HTTP client methods, while regular Dify
    call sites should use `make_request` directly.
    """

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return max_retries_exceeded_error

    @property
    def request_error(self) -> type[Exception]:
        return request_error

    def get(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("GET", url=url, max_retries=max_retries, **kwargs))

    def head(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("HEAD", url=url, max_retries=max_retries, **kwargs))

    def post(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("POST", url=url, max_retries=max_retries, **kwargs))

    def put(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("PUT", url=url, max_retries=max_retries, **kwargs))

    def delete(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("DELETE", url=url, max_retries=max_retries, **kwargs))

    def patch(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any):
        return _to_graphon_http_response(make_request("PATCH", url=url, max_retries=max_retries, **kwargs))


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
    try:
        port = parsed_url.port
    except ValueError:
        return None
    return parsed_url.scheme, parsed_url.hostname.lower(), port or _default_port(parsed_url.scheme)


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
