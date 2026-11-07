"""OTel uses structured secret validation; encrypted headers must still be presentable."""

import base64
from collections.abc import Sequence

import pytest
from dify_trace_otel.provider import OTelProvider
from dify_trace_sdk.testing import RecordingEgress, response

from services.tracing.provider_configs import ProviderConfigGateway
from services.tracing.providers import ProviderConfigCodec
from services.tracing.registry import EntryPointTraceProviderCatalog

ENDPOINT = "http://collector:4318/v1/traces"
WORKSPACE = "otel-test-workspace"


class _Cipher:
    """Test cipher exposes whether presentation decrypts and enforces workspace ownership."""

    def __init__(self) -> None:
        self.decryptions = 0

    def encrypt(self, tenant_id: str, value: str) -> str:
        return base64.b64encode(f"{tenant_id}:{value}".encode()).decode()

    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        self.decryptions += 1
        prefix = f"{tenant_id}:"
        values = [base64.b64decode(token).decode() for token in tokens]
        if not all(value.startswith(prefix) for value in values):
            raise ValueError("wrong workspace")
        return [value.removeprefix(prefix) for value in values]

    def mask(self, value: str) -> str:
        return "*" * len(value)


def _gateway(egress: RecordingEgress, cipher: _Cipher) -> ProviderConfigGateway:
    return ProviderConfigGateway(
        providers=EntryPointTraceProviderCatalog(), codec=ProviderConfigCodec(cipher), egress=egress
    )


def _create(gateway: ProviderConfigGateway) -> dict[str, object]:
    return gateway.prepare_new_config(
        workspace_id=WORKSPACE,
        tracing_provider="otel",
        tracing_config={"endpoint": ENDPOINT, "headers": '{"Authorization":"Bearer a*b"}'},
    )


def test_encrypted_headers_are_write_only_but_reported_as_configured() -> None:
    cipher = _Cipher()
    egress = RecordingEgress([response(200, b"")], grpc_target=None)
    gateway = _gateway(egress, cipher)
    stored = _create(gateway)
    assert isinstance(stored["headers"], str)
    assert "Bearer" not in stored["headers"]
    presented = gateway.present_config(workspace_id=WORKSPACE, tracing_provider="otel", tracing_config=stored)
    assert "headers" not in presented.values
    assert presented.configured_secrets == ("headers",)
    assert presented.values["endpoint"] == ENDPOINT
    assert presented.values["project_url"] is None
    assert cipher.decryptions == 0
    assert len(egress.requests) == 1
    assert EntryPointTraceProviderCatalog().resolve("otel") is OTelProvider


@pytest.mark.parametrize("submitted", [{}, {"headers": ""}])
def test_edit_preserves_header_credentials_for_unchanged_destination(submitted: dict[str, object]) -> None:
    cipher = _Cipher()
    egress = RecordingEgress([response(200, b""), response(200, b"")], grpc_target=None)
    gateway = _gateway(egress, cipher)
    original = _create(gateway)
    updated = gateway.prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="otel",
        current_tracing_config=original,
        tracing_config={"endpoint": ENDPOINT, "service_name": "updated", **submitted},
    )
    assert updated["headers"] == original["headers"]
    assert egress.requests[-1].headers["Authorization"] == "Bearer a*b"


@pytest.mark.parametrize("submitted", [{"headers": "{}"}, {"endpoint": "http://other:4318/v1/traces"}])
def test_explicit_clear_or_changed_destination_never_reuses_headers(submitted: dict[str, object]) -> None:
    cipher = _Cipher()
    egress = RecordingEgress([response(200, b""), response(200, b"")], grpc_target=None)
    gateway = _gateway(egress, cipher)
    original = _create(gateway)
    updated = gateway.prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="otel",
        current_tracing_config=original,
        tracing_config={"endpoint": ENDPOINT, **submitted},
    )
    assert updated["headers"] == ""
    assert "Authorization" not in egress.requests[-1].headers


def test_custom_otlp_path_slash_change_does_not_forward_saved_credentials() -> None:
    egress = RecordingEgress([response(200, b""), response(200, b"")], grpc_target=None)
    gateway = _gateway(egress, _Cipher())
    original = gateway.prepare_new_config(
        workspace_id=WORKSPACE,
        tracing_provider="otel",
        tracing_config={"endpoint": "https://collector/custom/", "headers": '{"Authorization":"Bearer secret"}'},
    )
    updated = gateway.prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="otel",
        current_tracing_config=original,
        tracing_config={"endpoint": "https://collector/custom", "headers": ""},
    )
    assert updated["headers"] == ""
    assert "Authorization" not in egress.requests[-1].headers
