import pytest
from dify_trace_arize_phoenix.provider import PhoenixProvider
from dify_trace_langfuse.provider import LangfuseProvider
from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.testing import RecordingEgress, response

from core.helper.encrypter import obfuscated_token
from services import app_tracing_config_service as config_service
from services.tracing.provider_configs import (
    ProviderConfigGateway,
    TraceProviderCapabilitiesQuery,
    TraceProviderSupport,
)
from services.tracing.providers import ProviderConfigCodec, configured_secrets
from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher

WORKSPACE = "tenant-1"
PUBLIC_KEY = "pk-lf-0123456789"
SECRET_KEY = "sk-lf-abcdefghijk"
CIPHER = WorkspaceBoundCipher()


def _encrypt(tenant_id: str, token: str) -> str:
    return CIPHER.encrypt(tenant_id, token)


def _gateway(egress: Egress) -> ProviderConfigGateway:
    return ProviderConfigGateway(
        providers=InstalledTraceProviders(LangfuseProvider, PhoenixProvider),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        egress=egress,
    )


def _projects(project_id: str) -> EgressResponse:
    return response(200, {"data": [{"id": project_id}]})


def _stored(**overrides: object) -> dict[str, object]:
    return {
        "public_key": _encrypt(WORKSPACE, PUBLIC_KEY),
        "secret_key": _encrypt(WORKSPACE, SECRET_KEY),
        "host": "https://langfuse.example.com",
        "project_key": "project-1",
        **overrides,
    }


def test_presentation_never_returns_secrets_or_derived_fields() -> None:
    gateway = _gateway(RecordingEgress([], grpc_target=None))

    presented = gateway.present_config(workspace_id=WORKSPACE, tracing_provider="langfuse", tracing_config=_stored())

    assert presented.values == {
        "host": "https://langfuse.example.com",
        "project_url": "https://langfuse.example.com/project/project-1",
    }
    assert presented.configured_secrets == ("public_key", "secret_key")
    assert configured_secrets(LangfuseProvider, _stored(secret_key="")) == ("public_key",)


def test_new_configs_are_verified_and_store_derived_fields() -> None:
    egress = RecordingEgress([_projects("project-9")], grpc_target=None)
    gateway = _gateway(egress)

    stored = gateway.prepare_new_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={
            "public_key": PUBLIC_KEY,
            "secret_key": SECRET_KEY,
            "host": "https://langfuse.example.com",
            "project_key": "client-supplied",
        },
    )

    assert stored["project_key"] == "project-9"
    assert stored["secret_key"] == _encrypt(WORKSPACE, SECRET_KEY)
    (request,) = egress.requests
    assert request.url == "https://langfuse.example.com/api/public/projects"


@pytest.mark.parametrize(
    "submitted_secret",
    [None, "", obfuscated_token(SECRET_KEY)],
    ids=["omitted", "blank", "masked"],
)
def test_updates_keep_a_secret_that_was_not_re_entered(submitted_secret: str | None) -> None:
    gateway = _gateway(RecordingEgress([_projects("project-1")], grpc_target=None))
    submitted: dict[str, object] = {"public_key": PUBLIC_KEY, "host": "https://langfuse.example.com"}
    if submitted_secret is not None:
        submitted["secret_key"] = submitted_secret

    stored = gateway.prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config=submitted,
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, SECRET_KEY)


def test_updates_replace_a_re_entered_secret() -> None:
    gateway = _gateway(RecordingEgress([_projects("project-1")], grpc_target=None))

    stored = gateway.prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={
            "public_key": PUBLIC_KEY,
            "secret_key": "sk-lf-rotated",
            "host": "https://langfuse.example.com",
        },
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, "sk-lf-rotated")


def test_failed_verification_is_reported_without_details() -> None:
    gateway = _gateway(RecordingEgress([response(401, {"message": "bad key"})], grpc_target=None))

    with pytest.raises(config_service.AppTracingConfigVerificationFailedError):
        gateway.prepare_new_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config={"public_key": PUBLIC_KEY, "secret_key": SECRET_KEY},
        )


def test_invalid_configs_are_rejected_before_any_request() -> None:
    egress = RecordingEgress([], grpc_target=None)

    with pytest.raises(config_service.AppTracingConfigInvalidConfigurationError):
        _gateway(egress).prepare_new_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config={"public_key": PUBLIC_KEY, "secret_key": SECRET_KEY, "host": "ftp://langfuse.example.com"},
        )
    assert egress.requests == []


def test_unknown_providers_are_rejected() -> None:
    gateway = _gateway(RecordingEgress([], grpc_target=None))

    with pytest.raises(config_service.AppTracingConfigInvalidProviderError):
        gateway.validate_provider("not-a-provider")


def test_capabilities_describe_the_provider_mapping_and_the_collection_gate() -> None:
    capabilities = TraceProviderCapabilitiesQuery(
        providers=InstalledTraceProviders(LangfuseProvider), api_collection_enabled=True
    ).get("langfuse")

    assert capabilities.support == TraceProviderSupport(
        provider="langfuse", native_cost=True, trace_url=True, span_url=True
    )
    assert capabilities.support.export_ack == "accepted"
    assert capabilities.api_collection_enabled is True


@pytest.mark.parametrize(
    ("provider_id", "error"),
    [
        ("datadog", config_service.AppTracingConfigInvalidProviderError),
        ("opik", config_service.AppTracingConfigProviderUnavailableError),
    ],
)
def test_capabilities_of_unknown_or_uninstalled_providers_are_errors(provider_id: str, error: type[Exception]) -> None:
    query = TraceProviderCapabilitiesQuery(
        providers=InstalledTraceProviders(LangfuseProvider), api_collection_enabled=False
    )

    with pytest.raises(error):
        query.get(provider_id)


def test_uninstalled_providers_can_still_be_named_but_not_presented() -> None:
    gateway = ProviderConfigGateway(
        providers=InstalledTraceProviders(),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        egress=RecordingEgress([], grpc_target=None),
    )

    gateway.validate_provider("langfuse")
    with pytest.raises(config_service.AppTracingConfigProviderUnavailableError):
        gateway.present_config(workspace_id=WORKSPACE, tracing_provider="langfuse", tracing_config=_stored())


@pytest.mark.parametrize(
    "submitted_secret", [None, "", obfuscated_token(SECRET_KEY)], ids=["omitted", "blank", "masked"]
)
def test_stored_secrets_never_follow_an_edited_destination(submitted_secret: str | None) -> None:
    egress = RecordingEgress([], grpc_target=None)
    submitted: dict[str, object] = {"public_key": PUBLIC_KEY, "host": "https://collector.attacker.example"}
    if submitted_secret is not None:
        submitted["secret_key"] = submitted_secret

    with pytest.raises(config_service.AppTracingConfigInvalidConfigurationError):
        _gateway(egress).prepare_updated_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config=submitted,
            current_tracing_config=_stored(),
        )
    assert egress.requests == []


def test_an_edited_destination_accepts_re_entered_secrets() -> None:
    egress = RecordingEgress([_projects("project-2")], grpc_target=None)

    stored = _gateway(egress).prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={"public_key": PUBLIC_KEY, "secret_key": "sk-lf-new", "host": "https://eu.langfuse.example"},
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, "sk-lf-new")
    assert egress.requests[0].url == "https://eu.langfuse.example/api/public/projects"


def test_an_unchanged_destination_with_a_trailing_slash_keeps_secrets() -> None:
    egress = RecordingEgress([_projects("project-1")], grpc_target=None)

    stored = _gateway(egress).prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={"public_key": PUBLIC_KEY, "host": "https://langfuse.example.com/"},
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, SECRET_KEY)
