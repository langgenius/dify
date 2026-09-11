"""Native Requests authentication through Dify's shared SSRF and TLS policy."""

import ssl
from typing import Any, override

import requests
from requests.adapters import HTTPAdapter

from core.helper import ssrf_proxy
from core.helper.ssl_context import create_ssl_context
from core.tools.errors import ToolSSRFError


class SSRFRequestsAdapter(HTTPAdapter):
    """An operation-owned native connection pool, including raw authentication responses."""

    def __init__(self, *, ssl_context: ssl.SSLContext | None = None):
        self.ssl_context = ssl_context if ssl_context is not None else create_ssl_context({})
        self.proxies = ssrf_proxy.get_proxy_urls()
        super().__init__(max_retries=0)

    @override
    def build_connection_pool_key_attributes(
        self, request: requests.PreparedRequest, verify: Any, cert: Any = None
    ) -> Any:
        host, _ = super().build_connection_pool_key_attributes(request, True, None)
        return host, {"ssl_context": self.ssl_context, "cert_reqs": self.ssl_context.verify_mode}

    @override
    def cert_verify(self, conn: Any, url: str, verify: Any, cert: Any) -> None:
        # The owned context already contains the captured CA and client certificate.
        # Requests must not reopen certificate files or add its default trust roots.
        pass

    @override
    def send(
        self,
        request: requests.PreparedRequest,
        stream: bool = False,
        timeout: Any = None,
        verify: Any = True,
        cert: Any = None,
        proxies: Any = None,
    ) -> requests.Response:
        if request.url is None:
            raise requests.exceptions.InvalidURL("Request URL is missing")
        # Resolve only environment proxy routing when no Dify route is configured;
        # authentication and CA discovery stay disabled on the owning Session.
        routes = self.proxies if self.proxies is not None else requests.utils.get_environ_proxies(request.url)
        response = super().send(
            request,
            stream=stream,
            timeout=timeout,
            verify=self.ssl_context.verify_mode != ssl.CERT_NONE,
            cert=None,
            proxies=routes,
        )
        try:
            ssrf_proxy.raise_for_proxy_rejection(response.status_code, response.headers, request.url)
        except ToolSSRFError:
            response.close()
            raise
        return response
