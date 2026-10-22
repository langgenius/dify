"""Per-client SDK transports using Dify's HTTP egress policy, never global state."""

from typing import Any, override

import httpx
import requests

from services.tracing.provider_common import request as send_http
from services.tracing.provider_dispatch import TraceExportRejectedError


class SSRFTransport(httpx.BaseTransport):
    def __init__(self, provider: str) -> None:
        self.provider = provider

    @override
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = send_http(
            request.method, str(request.url), self.provider, headers=dict(request.headers), content=request.read()
        )
        return httpx.Response(response.status_code, headers=response.headers, content=response.content, request=request)


class SSRFSession(requests.Session):
    def __init__(self, provider: str) -> None:
        super().__init__()
        self.provider = provider

    @override
    def send(self, request: requests.PreparedRequest, **kwargs: Any) -> requests.Response:
        if not request.method or not request.url or not isinstance(request.body, (str, bytes, type(None))):
            raise TraceExportRejectedError("Tracing SDK prepared an unsupported HTTP request")
        received = send_http(
            request.method, request.url, self.provider, headers=dict(request.headers), content=request.body
        )
        response = requests.Response()
        response.status_code = received.status_code
        response.headers.update(received.headers)
        response._content = received.content
        response.url = str(received.url)
        response.request = request
        return response
