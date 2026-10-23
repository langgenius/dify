"""Adapters that let a vendor SDK send its HTTP requests through ``Egress``.

The SDK keeps its request and response validation; the egress keeps the
network policy. Both adapters forbid SDK-side retries by construction: each
SDK request is exactly one egress request.
"""

from typing import Any, override

import httpx
import requests

from dify_trace_sdk.egress import Egress

SDK_REQUEST_TIMEOUT_SECONDS = 30.0


class EgressHttpxTransport(httpx.BaseTransport):
    def __init__(self, egress: Egress) -> None:
        self._egress = egress

    @override
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._egress.request(
            request.method,
            str(request.url),
            headers=dict(request.headers),
            content=request.read(),
            timeout=SDK_REQUEST_TIMEOUT_SECONDS,
            sensitive_url=False,
        )
        return httpx.Response(
            response.status_code, headers=dict(response.headers), content=response.content, request=request
        )


class EgressRequestsSession(requests.Session):
    def __init__(self, egress: Egress) -> None:
        super().__init__()
        self._egress = egress
        # Host proxies, CA bundles, and .netrc credentials must not reach a tenant's destination.
        self.trust_env = False

    @override
    def send(self, request: requests.PreparedRequest, **kwargs: Any) -> requests.Response:
        body = request.body
        if not request.method or not request.url:
            raise ValueError("The SDK prepared an incomplete request")
        if isinstance(body, str):
            body = body.encode()
        if body is not None and not isinstance(body, bytes):
            raise ValueError("The SDK prepared a streaming request body")
        received = self._egress.request(
            request.method,
            request.url,
            headers=dict(request.headers),
            content=body,
            timeout=SDK_REQUEST_TIMEOUT_SECONDS,
            sensitive_url=False,
        )
        response = requests.Response()
        response.status_code = received.status_code
        response.headers.update(received.headers)
        response._content = received.content
        response.url = request.url
        response.request = request
        return response
