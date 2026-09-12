"""Provider-owned configuration and export protocol contracts."""

from typing import Unpack

import httpx
import pytest

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceProviderHttpClient
from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets,
    assert_provider_exports_complete_tree_with_repeatable_ids,
    isolate_deployment_settings,  # noqa: F401
)


def make_provider_config(provider: str, secret: str = "tenant-secret") -> dict[str, str]:
    return {
        "arize": {"api_key": secret, "project": "project", "space_id": "space", "endpoint": "https://arize.example"},
        "phoenix": {"api_key": secret, "project": "project", "endpoint": "https://phoenix.example"},
    }[provider]


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_export_complete_tree_with_repeatable_ids(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, str, RequestArguments]] = []

    def request(method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((method, url, kwargs))
        if kwargs.get("headers", {}).get("Content-Type") == "application/x-protobuf":
            return httpx.Response(200, content=b"")
        return httpx.Response(200, json={})

    def grpc_request(
        client: OtlpTraceClient, signal: str, serialized: bytes, *, http_client: TraceProviderHttpClient | None = None
    ) -> bytes:
        transport = http_client if http_client is not None else client.http
        requests.append(("GRPC", signal, {"content": serialized, "headers": dict(transport.headers)}))
        return b""

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    monkeypatch.setattr(OtlpTraceClient, "_send_grpc", grpc_request)
    assert_provider_exports_complete_tree_with_repeatable_ids(provider, make_provider_config(provider), requests)


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
        provider, make_provider_config(provider), monkeypatch
    )
