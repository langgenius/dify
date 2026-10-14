"""Fixed-origin transport and bounded parsing shared by validation and generation."""

import json
import re
from collections.abc import Generator, Mapping
from http import HTTPStatus

import requests
from dify_plugin.errors.model import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

ENDPOINT_URL = "https://developer.amd.com.cn/radeon/api/v1"
MODELS_URL = f"{ENDPOINT_URL}/models"
CHAT_COMPLETIONS_URL = f"{ENDPOINT_URL}/chat/completions"
SOURCE_HEADER = "X-Source"
SOURCE_VALUE = "dify"
MAX_MODELS_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_COMPLETION_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_SSE_EVENT_BYTES = 1024 * 1024
_EVENT_SEPARATOR = re.compile(rb"\r\n\r\n|\n\n|\r\r")


class _ExplicitBearerAuth(requests.auth.AuthBase):
    """Keep the supplied Bearer header; never substitute ambient .netrc credentials."""

    def __call__(self, request):
        return request


def request_response(
    url: str,
    *,
    headers: Mapping[str, str],
    timeout: tuple[int, int],
    operation: str,
    json_body: Mapping | None = None,
    data: bytes | None = None,
) -> requests.Response:
    if url not in {MODELS_URL, CHAT_COMPLETIONS_URL}:
        raise InvokeBadRequestError("AMDGPUCloud requires its fixed API endpoint")
    options = {
        "headers": dict(headers),
        "timeout": timeout,
        "allow_redirects": False,
        "stream": True,
        "auth": _ExplicitBearerAuth(),
    }
    try:
        if url == MODELS_URL:
            response = requests.get(url, **options)
        elif json_body is not None:
            response = requests.post(url, json=dict(json_body), **options)
        else:
            response = requests.post(url, data=data, **options)
    except requests.Timeout:
        raise InvokeConnectionError(f"AMDGPUCloud {operation} timed out") from None
    except requests.RequestException:
        raise InvokeConnectionError(f"Unable to reach AMDGPUCloud for {operation}") from None

    try:
        check_status(response, operation)
    except InvokeError:
        response.close()
        raise
    return response


def check_status(response: requests.Response, operation: str) -> None:
    status = response.status_code
    if status == HTTPStatus.OK:
        return
    if status in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
        raise InvokeAuthorizationError("Invalid AMDGPUCloud API key")
    if status == HTTPStatus.TOO_MANY_REQUESTS:
        raise InvokeRateLimitError(f"AMDGPUCloud {operation} was rate limited; retry later")
    if status in {HTTPStatus.REQUEST_TIMEOUT, HTTPStatus.GATEWAY_TIMEOUT}:
        raise InvokeConnectionError(f"AMDGPUCloud {operation} timed out")
    if 300 <= status < 400:
        raise InvokeConnectionError(f"AMDGPUCloud refused a redirect (status {status})")
    if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        raise InvokeServerUnavailableError(
            f"AMDGPUCloud is temporarily unavailable for {operation}"
        )
    raise InvokeBadRequestError(f"AMDGPUCloud {operation} failed with status {status}")


def read_json_response(response: requests.Response, limit: int, kind: str) -> dict:
    content = bytearray()
    try:
        for chunk in response.iter_content(chunk_size=8192):
            if len(content) + len(chunk) > limit:
                raise InvokeServerUnavailableError(f"AMDGPUCloud returned an oversized {kind}")
            content.extend(chunk)
        payload = json.loads(content)
    except requests.Timeout:
        raise InvokeConnectionError(f"AMDGPUCloud {kind} read timed out") from None
    except requests.RequestException:
        raise InvokeConnectionError(f"AMDGPUCloud {kind} connection was interrupted") from None
    except (ValueError, UnicodeError):
        raise InvokeServerUnavailableError(f"AMDGPUCloud returned an invalid {kind}") from None
    if not isinstance(payload, dict):
        raise InvokeServerUnavailableError(f"AMDGPUCloud returned an invalid {kind}")
    # The SDK consumes response.json(); preserve only the bounded, already validated bytes.
    response._content = bytes(content)
    response._content_consumed = True
    return payload


def valid_usage(usage: object) -> bool:
    return isinstance(usage, dict) and all(
        isinstance(usage.get(key), int) and not isinstance(usage[key], bool) and usage[key] >= 0
        for key in ("prompt_tokens", "completion_tokens")
    )


class SSEReader(requests.Response):
    """Adapt LF/CRLF SSE to the SDK while rejecting malformed or truncated streams."""

    def __init__(self, response: requests.Response) -> None:
        super().__init__()
        self.response = response

    def iter_lines(
        self, chunk_size: int = 512, decode_unicode: bool = False, delimiter=None
    ) -> Generator:
        del chunk_size, delimiter
        pending = b""
        has_usage = False
        try:
            for chunk in self.response.iter_content(chunk_size=8192):
                pending += chunk
                while match := _EVENT_SEPARATOR.search(pending):
                    event, pending = pending[: match.start()], pending[match.end() :]
                    if len(event) > MAX_SSE_EVENT_BYTES:
                        raise InvokeServerUnavailableError(
                            "AMDGPUCloud returned an oversized stream event"
                        )
                    values = []
                    for line in event.splitlines():
                        if line.startswith(b"data:"):
                            values.append(line[5:].removeprefix(b" "))
                    if not values:
                        continue
                    raw = b"\n".join(values)
                    if raw == b"[DONE]":
                        if not has_usage:
                            raise InvokeServerUnavailableError(
                                "AMDGPUCloud returned incomplete stream usage"
                            )
                        yield "data: [DONE]" if decode_unicode else b"data: [DONE]"
                        return
                    try:
                        payload = json.loads(raw)
                    except (ValueError, UnicodeError):
                        raise InvokeServerUnavailableError(
                            "AMDGPUCloud returned an invalid stream response"
                        ) from None
                    if not isinstance(payload, dict):
                        raise InvokeServerUnavailableError(
                            "AMDGPUCloud returned an invalid stream response"
                        )
                    if payload.get("error"):
                        raise InvokeServerUnavailableError("AMDGPUCloud reported a stream error")
                    if valid_usage(payload.get("usage")):
                        has_usage = True
                    if "choices" not in payload and valid_usage(payload.get("usage")):
                        payload["choices"] = []
                    if not isinstance(payload.get("choices"), list):
                        raise InvokeServerUnavailableError(
                            "AMDGPUCloud returned an invalid stream response"
                        )
                    normalized = "data: " + json.dumps(payload, ensure_ascii=False)
                    yield normalized if decode_unicode else normalized.encode("utf-8")
                if len(pending) > MAX_SSE_EVENT_BYTES:
                    raise InvokeServerUnavailableError(
                        "AMDGPUCloud returned an oversized stream event"
                    )
        except requests.Timeout:
            raise InvokeConnectionError("AMDGPUCloud stream read timed out") from None
        except requests.RequestException:
            raise InvokeConnectionError("AMDGPUCloud stream connection was interrupted") from None
        raise InvokeServerUnavailableError("AMDGPUCloud returned an incomplete stream")