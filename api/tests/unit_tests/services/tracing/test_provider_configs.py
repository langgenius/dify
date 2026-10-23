import pytest
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_arize_phoenix.provider import PhoenixProvider
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.provider import LangfuseProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.testing import RecordingEgress, response

from core.helper.encrypter import obfuscated_token
from services import app_tracing_config_service as config_service
from services.tracing import provider_configs, registry
from services.tracing.provider_configs import (
    ProviderConfigGateway,
    ProviderConfigUnreadableError,
    capabilities_payload,
    configured_secrets,
    decode_config,
    encode_config,
)

WORKSPACE = "tenant-1"
PUBLIC_KEY = "pk-lf-0123456789"
SECRET_KEY = "sk-lf-abcdefghijk"


def _encrypt(tenant_id: str, token: str) -> str:
    return f"enc:{tenant_id}:{token}"


def _batch_decrypt(tenant_id: str, tokens: list[str]) -> list[str]:
    prefix = f"enc:{tenant_id}:"
    if not all(token.startswith(prefix) for token in tokens):
        raise ValueError("token was encrypted for another workspace")
    return [token.removeprefix(prefix) for token in tokens]


@pytest.fixture(autouse=True)
def reversible_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provider_configs, "encrypt_token", _encrypt)
    monkeypatch.setattr(provider_configs, "batch_decrypt_token", _batch_decrypt)


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


def test_stored_configs_encrypt_only_secrets_and_round_trip() -> None:
    config = LangfuseConfig(public_key=PUBLIC_KEY, secret_key=SECRET_KEY, host="https://langfuse.example.com")

    stored = encode_config(WORKSPACE, config)

    assert stored["public_key"] == _encrypt(WORKSPACE, PUBLIC_KEY)
    assert stored["host"] == "https://langfuse.example.com"
    assert decode_config(WORKSPACE, LangfuseProvider, stored) == config


def test_a_config_encrypted_for_another_workspace_is_unreadable() -> None:
    with pytest.raises(ProviderConfigUnreadableError):
        decode_config("tenant-2", LangfuseProvider, _stored())


def test_presentation_never_returns_secrets_or_derived_fields() -> None:
    gateway = ProviderConfigGateway(RecordingEgress([], grpc_target=None))

    presented = gateway.present_config(workspace_id=WORKSPACE, tracing_provider="langfuse", tracing_config=_stored())

    assert presented.values == {
        "host": "https://langfuse.example.com",
        "project_url": "https://langfuse.example.com/project/project-1",
    }
    assert presented.configured_secrets == ("public_key", "secret_key")
    assert configured_secrets(LangfuseProvider, _stored(secret_key="")) == ("public_key",)


def test_new_configs_are_verified_and_store_derived_fields() -> None:
    egress = RecordingEgress([_projects("project-9")], grpc_target=None)
    gateway = ProviderConfigGateway(egress)

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
    gateway = ProviderConfigGateway(RecordingEgress([_projects("project-1")], grpc_target=None))
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
    gateway = ProviderConfigGateway(RecordingEgress([_projects("project-1")], grpc_target=None))

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
    gateway = ProviderConfigGateway(RecordingEgress([response(401, {"message": "bad key"})], grpc_target=None))

    with pytest.raises(config_service.AppTracingConfigVerificationFailedError):
        gateway.prepare_new_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config={"public_key": PUBLIC_KEY, "secret_key": SECRET_KEY},
        )


def test_invalid_configs_are_rejected_before_any_request() -> None:
    egress = RecordingEgress([], grpc_target=None)

    with pytest.raises(config_service.AppTracingConfigInvalidConfigurationError):
        ProviderConfigGateway(egress).prepare_new_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config={"public_key": PUBLIC_KEY, "secret_key": SECRET_KEY, "host": "ftp://langfuse.example.com"},
        )
    assert egress.requests == []


def test_unknown_providers_are_rejected() -> None:
    gateway = ProviderConfigGateway(RecordingEgress([], grpc_target=None))

    with pytest.raises(config_service.AppTracingConfigInvalidProviderError):
        gateway.validate_provider("not-a-provider")


def test_capabilities_describe_the_provider_mapping() -> None:
    payload = capabilities_payload("langfuse")

    assert payload["provider"] == "langfuse"
    assert payload["native_cost"] is True
    assert payload["export_ack"] == "accepted"


def test_empty_optional_secrets_are_stored_empty_and_not_reported_as_configured() -> None:
    config = PhoenixConfig(api_key="", project="dify", endpoint="https://app.phoenix.arize.com")

    stored = encode_config(WORKSPACE, config)

    assert stored["api_key"] == ""
    assert configured_secrets(PhoenixProvider, stored) == ()
    assert decode_config(WORKSPACE, PhoenixProvider, stored) == config


def test_uninstalled_providers_can_still_be_named_but_not_presented(monkeypatch: pytest.MonkeyPatch) -> None:
    registry.provider_class.cache_clear()
    monkeypatch.setattr(registry, "_entry_points", dict)
    gateway = ProviderConfigGateway(RecordingEgress([], grpc_target=None))
    try:
        gateway.validate_provider("langfuse")
        with pytest.raises(config_service.AppTracingConfigProviderUnavailableError):
            gateway.present_config(workspace_id=WORKSPACE, tracing_provider="langfuse", tracing_config=_stored())
    finally:
        registry.provider_class.cache_clear()


def test_secrets_that_cannot_be_decrypted_make_the_config_unreadable(monkeypatch: pytest.MonkeyPatch) -> None:
    class _MissingWorkspaceKeyError(Exception):
        pass

    def fail(tenant_id: str, tokens: list[str]) -> list[str]:
        raise _MissingWorkspaceKeyError(f"{tenant_id}: {len(tokens)} tokens")

    monkeypatch.setattr(provider_configs, "batch_decrypt_token", fail)

    with pytest.raises(ProviderConfigUnreadableError):
        decode_config(WORKSPACE, LangfuseProvider, _stored())


def test_configs_without_secrets_never_load_the_workspace_key(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(tenant_id: str, tokens: list[str]) -> list[str]:
        raise AssertionError(f"{tenant_id} has no secret to decrypt, got {tokens}")

    monkeypatch.setattr(provider_configs, "batch_decrypt_token", forbidden)

    config = decode_config(WORKSPACE, PhoenixProvider, {"api_key": None, "project": "dify"})

    assert isinstance(config, PhoenixConfig)
    assert config.api_key is None


@pytest.mark.parametrize(
    "submitted_secret", [None, "", obfuscated_token(SECRET_KEY)], ids=["omitted", "blank", "masked"]
)
def test_stored_secrets_never_follow_an_edited_destination(submitted_secret: str | None) -> None:
    egress = RecordingEgress([], grpc_target=None)
    submitted: dict[str, object] = {"public_key": PUBLIC_KEY, "host": "https://collector.attacker.example"}
    if submitted_secret is not None:
        submitted["secret_key"] = submitted_secret

    with pytest.raises(config_service.AppTracingConfigInvalidConfigurationError):
        ProviderConfigGateway(egress).prepare_updated_config(
            workspace_id=WORKSPACE,
            tracing_provider="langfuse",
            tracing_config=submitted,
            current_tracing_config=_stored(),
        )
    assert egress.requests == []


def test_an_edited_destination_accepts_re_entered_secrets() -> None:
    egress = RecordingEgress([_projects("project-2")], grpc_target=None)

    stored = ProviderConfigGateway(egress).prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={"public_key": PUBLIC_KEY, "secret_key": "sk-lf-new", "host": "https://eu.langfuse.example"},
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, "sk-lf-new")
    assert egress.requests[0].url == "https://eu.langfuse.example/api/public/projects"


def test_an_unchanged_destination_with_a_trailing_slash_keeps_secrets() -> None:
    egress = RecordingEgress([_projects("project-1")], grpc_target=None)

    stored = ProviderConfigGateway(egress).prepare_updated_config(
        workspace_id=WORKSPACE,
        tracing_provider="langfuse",
        tracing_config={"public_key": PUBLIC_KEY, "host": "https://langfuse.example.com/"},
        current_tracing_config=_stored(),
    )

    assert stored["secret_key"] == _encrypt(WORKSPACE, SECRET_KEY)
