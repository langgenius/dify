from __future__ import annotations

from collections.abc import Sequence
from typing import Any, override

import httpx

from .protocols import HttpClientProtocol
from .response import HttpResponse

TIMEOUT_COMPONENT_COUNT = 3


class HttpClientMaxRetriesExceededError(Exception):
    """Raised when the client exhausts all retry attempts on request errors."""


class HttpxHttpClient(HttpClientProtocol):
    """HTTPX-backed sync client that matches the workflow HTTP client protocol."""

    @property
    @override
    def max_retries_exceeded_error(self) -> type[Exception]:
        return HttpClientMaxRetriesExceededError

    @property
    @override
    def request_error(self) -> type[Exception]:
        return httpx.RequestError

    @override
    def get(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("GET", url, max_retries=max_retries, **kwargs)

    @override
    def head(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("HEAD", url, max_retries=max_retries, **kwargs)

    @override
    def post(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("POST", url, max_retries=max_retries, **kwargs)

    @override
    def put(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("PUT", url, max_retries=max_retries, **kwargs)

    @override
    def delete(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("DELETE", url, max_retries=max_retries, **kwargs)

    @override
    def patch(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("PATCH", url, max_retries=max_retries, **kwargs)

    def _request(
        self,
        method: str,
        url: str,
        *,
        max_retries: int = 0,
        **kwargs: Any,
    ) -> HttpResponse:
        request_kwargs = self._normalize_request_kwargs(kwargs)
        last_error: httpx.RequestError | None = None

        for attempt in range(max_retries + 1):
            try:
                raw_response = httpx.request(method, url, **request_kwargs)
                return HttpResponse.from_httpx(raw_response)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt >= max_retries:
                    break

        if last_error is None:
            msg = "HTTP request retry loop exited without a result"
            raise RuntimeError(msg)
        if max_retries == 0:
            raise last_error
        msg = f"Request failed after {max_retries + 1} attempt(s): {method} {url}"
        raise HttpClientMaxRetriesExceededError(msg) from last_error

    @staticmethod
    def _normalize_request_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
        request_kwargs = dict(kwargs)

        ssl_verify = request_kwargs.pop("ssl_verify", None)
        if ssl_verify is not None:
            request_kwargs["verify"] = ssl_verify

        timeout = request_kwargs.get("timeout")
        if isinstance(timeout, Sequence) and not isinstance(timeout, str):
            if len(timeout) != TIMEOUT_COMPONENT_COUNT:
                msg = "timeout sequence must contain connect, read, and write values"
                raise ValueError(msg)
            connect, read, write = timeout
            request_kwargs["timeout"] = httpx.Timeout(
                timeout=None,
                connect=connect,
                read=read,
                write=write,
            )

        return request_kwargs
