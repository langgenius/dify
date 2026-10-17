"""A7 SDK parsing on the native loop; all outbound I/O on the origin worker."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from math import isfinite
from time import monotonic
from typing import override
from urllib.parse import urlsplit

import httpx
import httpx2 as sdk_httpx
from core.helper import ssrf_proxy
from dify_agent.runtime_backend.local import LocalNativeScopeClient
from libs.sensitive_http_telemetry import sensitive_http_telemetry
from shellctl.client.sdk import ShellctlClient

from services.dify_builder.native_testing.sandbox.sync_bridge import (
    NativeCodeLoopBridge,
)


@dataclass(frozen=True, slots=True)
class CodeHttpRequest:
    method: str
    path: str
    content: bytes
    scope_token: str | None = None


class CodeOriginHttp:
    """Trusted fixed endpoint only; no workflow-selected URL or request headers."""

    def __init__(self, *, endpoint, scope_id, generation, token, deadline, max_bytes):
        parsed = urlsplit(endpoint)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.path not in ("", "/")
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or re.fullmatch(r"code_[0-9a-f]{32}", scope_id) is None
            or generation != 1
            or not isfinite(deadline)
            or not 0 < max_bytes <= 16 * 1024 * 1024
            or not token
        ):
            raise ValueError("native_code_endpoint_invalid")
        self.endpoint = endpoint.rstrip("/")
        self.scope_id, self.generation, self.token = scope_id, generation, token
        self.deadline, self.max_bytes = deadline, max_bytes

    def request(self, request: CodeHttpRequest):
        prefix = f"/v1/test-scopes/{self.scope_id}"
        scope = (request.method, request.path) in (
            ("POST", "/v1/test-scopes"),
            ("GET", prefix),
            ("DELETE", prefix),
        )
        job = (
            (request.method == "POST" and request.path == prefix + "/jobs/run")
            or (
                re.fullmatch(
                    re.escape(prefix)
                    + r"/jobs/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/(?:input|wait)",
                    request.path,
                )
                and request.method == "POST"
            )
            or (
                re.fullmatch(
                    re.escape(prefix) + r"/jobs/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
                    request.path,
                )
                and request.method == "GET"
            )
        )
        remaining = self.deadline - monotonic()
        if (
            not (scope or job)
            or remaining <= 0
            or len(request.content) > self.max_bytes
        ):
            raise ValueError("native_code_http_refused")
        if job and not request.scope_token:
            raise ValueError("native_code_scope_token_required")
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-Scope-Generation": str(self.generation),
            "Accept-Encoding": "identity",
            "Content-Type": "application/json",
        }
        if job:
            assert request.scope_token is not None
            headers["X-Scope-Token"] = request.scope_token
        with sensitive_http_telemetry():
            response = ssrf_proxy.make_request(
                request.method,
                self.endpoint + request.path,
                max_retries=0,
                sensitive_request=True,
                stream_response=True,
                follow_redirects=False,
                headers=headers,
                content=request.content,
                timeout=httpx.Timeout(remaining),
            )
            try:
                if response.headers.get("content-encoding", "identity").lower() not in (
                    "",
                    "identity",
                ):
                    raise ValueError("native_code_encoding_refused")
                content = bytearray()
                for chunk in response.iter_bytes(chunk_size=4096):
                    if (
                        monotonic() >= self.deadline
                        or len(content) + len(chunk) > self.max_bytes
                    ):
                        raise ValueError("native_code_response_unavailable")
                    content.extend(chunk)
                if monotonic() >= self.deadline:
                    raise ValueError("native_code_response_expired")
                return response.status_code, bytes(content)
            finally:
                response.close()


class CodeMailboxHttpTransport(sdk_httpx.AsyncBaseTransport):
    def __init__(self, *, bridge, endpoint, scope_token):
        self.bridge, self.endpoint, self.scope_token = (
            bridge,
            endpoint.rstrip("/"),
            scope_token,
        )
        self.closed = False

    @override
    async def handle_async_request(self, request):
        if (
            self.closed
            or str(request.url).split("/v1/", 1)[0] != self.endpoint
            or request.url.query
        ):
            raise ValueError("native_code_http_origin_mismatch")
        content = await request.aread()
        value = CodeHttpRequest(
            request.method, request.url.path, content, self.scope_token
        )
        status, body = await self.bridge.request("http", value)
        return sdk_httpx.Response(status, content=body, request=request)

    @override
    async def aclose(self):
        self.closed = True


class _ObservedJobClient(ShellctlClient):
    def __init__(self, *, bridge, **kwargs):
        self._bridge = bridge
        self.closed = False
        super().__init__(**kwargs)

    @override
    async def input(self, job_id, text, *, offset, timeout=15.0):
        result = await super().input(job_id, text, offset=offset, timeout=timeout)
        self._observe(result, job_id, offset)
        return result

    @override
    async def wait(self, job_id, *, offset, timeout=15.0):
        result = await super().wait(job_id, offset=offset, timeout=timeout)
        self._observe(result, job_id, offset)
        return result

    def _observe(self, result, job_id, offset):
        if (
            result.job_id != job_id
            or result.offset != offset + len(result.output.encode("utf-8"))
            or result.offset > self.output_limit
        ):
            raise ValueError("native_code_output_invalid")
        self._bridge.call("offset", (job_id, offset, result.offset))

    @override
    async def close(self):
        await super().close()
        self.closed = True


class NativeCodeScopeClient(LocalNativeScopeClient):
    def __init__(
        self, *, endpoint, auth_token, bridge: NativeCodeLoopBridge, output_bytes
    ):
        super().__init__(endpoint, auth_token)
        self.bridge = bridge
        self.output_bytes = output_bytes
        self.clients: list[_ObservedJobClient] = []

    @override
    async def _request(self, method, path, *, generation=None, spec=None):
        content = json.dumps(spec.model_dump(mode="json")).encode() if spec else b""
        status, body = await self.bridge.request(
            "create" if method == "POST" and path == "/v1/test-scopes" else "http",
            CodeHttpRequest(method, path, content),
            settlement=method == "DELETE",
        )
        if status not in (200, 201):
            raise ValueError("native_code_scope_unavailable")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise TypeError("native_code_scope_response_invalid")
        return result

    @override
    def job_client(self, handle):
        transport = CodeMailboxHttpTransport(
            bridge=self.bridge,
            endpoint=self.endpoint,
            scope_token=handle.token.get_secret_value(),
        )
        client = _ObservedJobClient(
            bridge=self.bridge,
            base_url=self.endpoint,
            token=self.auth_token,
            native_scope=handle,
            transport=transport,
            output_limit=self.output_bytes,
            request_timeout_grace_seconds=0,
        )
        self.clients.append(client)
        return client
