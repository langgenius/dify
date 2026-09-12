"""Provider-owned configuration and export protocol contracts."""

import pytest

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceProviderHttpClient
from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets,
    assert_provider_exports_complete_tree_with_repeatable_ids,
    isolate_deployment_settings,  # noqa: F401
)


def make_provider_config(secret: str = "tenant-secret") -> dict[str, str]:
    return {"token": secret, "service_name": "project", "endpoint": "https://tencent.example:4317"}


def test_export_complete_tree_with_repeatable_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, str, RequestArguments]] = []

    def grpc_request(
        client: OtlpTraceClient, signal: str, serialized: bytes, *, http_client: TraceProviderHttpClient | None = None
    ) -> bytes:
        transport = http_client if http_client is not None else client.http
        requests.append(("GRPC", signal, {"content": serialized, "headers": dict(transport.headers)}))
        return b""

    monkeypatch.setattr(OtlpTraceClient, "_send_grpc", grpc_request)
    assert_provider_exports_complete_tree_with_repeatable_ids("tencent", make_provider_config(), requests)


def test_credentials_round_trip_without_exposing_or_replacing_saved_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
        "tencent", make_provider_config(), monkeypatch
    )
