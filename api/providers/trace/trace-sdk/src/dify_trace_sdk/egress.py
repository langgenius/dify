"""The only network access a provider has.

The Dify API supplies an ``Egress`` that applies its outbound policy (SSRF
proxy, timeouts, response size limits, log redaction). Providers never open
sockets, HTTP clients, or gRPC channels of their own.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

import grpc  # type: ignore[import-untyped]


@dataclass(frozen=True)
class EgressResponse:
    status_code: int
    headers: Mapping[str, str]
    """Header names are lowercase."""
    content: bytes

    def json(self) -> object:
        return json.loads(self.content)


class Egress(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        content: bytes | None,
        timeout: float,
        sensitive_url: bool,
    ) -> EgressResponse:
        """Send one request without retries or redirects.

        ``sensitive_url`` marks a URL that embeds a credential, so transport
        diagnostics must not log it.

        Raises:
            EgressError: The request failed in transport or was blocked by policy.
        """
        ...

    def grpc_channel(self, endpoint: str) -> grpc.Channel:
        """Open a gRPC channel to an ``http(s)://host[:port]`` endpoint; the caller closes it.

        Raises:
            EgressError: The endpoint is not allowed.
        """
        ...
