from collections.abc import Sequence
from typing import override

import pytest
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_arize_phoenix.provider import PhoenixProvider
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.provider import LangfuseProvider

from services.tracing.errors import ProviderConfigUnreadableError
from services.tracing.providers import ProviderConfigCodec, TracingSecretCipher, configured_secrets
from tests.helpers.unit.services.tracing_ports import WorkspaceBoundCipher

WORKSPACE = "tenant-1"
PUBLIC_KEY = "pk-lf-0123456789"
SECRET_KEY = "sk-lf-abcdefghijk"


class _MissingWorkspaceKeyError(Exception):
    pass


class _UnreadableCipher(TracingSecretCipher):
    """A workspace whose key is gone: nothing it stored can be decrypted."""

    @override
    def encrypt(self, tenant_id: str, value: str) -> str:
        raise AssertionError("decoding never encrypts")

    @override
    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        raise _MissingWorkspaceKeyError(f"{tenant_id}: {len(tokens)} tokens")

    @override
    def mask(self, value: str) -> str:
        raise AssertionError("decoding never masks")


def test_stored_configs_encrypt_only_secrets_and_round_trip() -> None:
    cipher = WorkspaceBoundCipher()
    codec = ProviderConfigCodec(cipher)
    config = LangfuseConfig(public_key=PUBLIC_KEY, secret_key=SECRET_KEY, host="https://langfuse.example.com")

    stored = codec.encode(WORKSPACE, config)

    assert stored["public_key"] == cipher.encrypt(WORKSPACE, PUBLIC_KEY)
    assert stored["host"] == "https://langfuse.example.com"
    assert codec.decode(WORKSPACE, LangfuseProvider, stored) == config


def test_a_config_encrypted_for_another_workspace_is_unreadable() -> None:
    codec = ProviderConfigCodec(WorkspaceBoundCipher())
    stored = codec.encode(WORKSPACE, LangfuseConfig(public_key=PUBLIC_KEY, secret_key=SECRET_KEY))

    with pytest.raises(ProviderConfigUnreadableError):
        codec.decode("tenant-2", LangfuseProvider, stored)


def test_empty_optional_secrets_are_stored_empty_and_not_reported_as_configured() -> None:
    codec = ProviderConfigCodec(WorkspaceBoundCipher())
    config = PhoenixConfig(api_key="", project="dify", endpoint="https://app.phoenix.arize.com")

    stored = codec.encode(WORKSPACE, config)

    assert stored["api_key"] == ""
    assert configured_secrets(PhoenixProvider, stored) == ()
    assert codec.decode(WORKSPACE, PhoenixProvider, stored) == config


def test_secrets_that_cannot_be_decrypted_make_the_config_unreadable() -> None:
    stored = ProviderConfigCodec(WorkspaceBoundCipher()).encode(
        WORKSPACE, LangfuseConfig(public_key=PUBLIC_KEY, secret_key=SECRET_KEY)
    )

    with pytest.raises(ProviderConfigUnreadableError):
        ProviderConfigCodec(_UnreadableCipher()).decode(WORKSPACE, LangfuseProvider, stored)


def test_configs_without_secrets_never_load_the_workspace_key() -> None:
    config = ProviderConfigCodec(_UnreadableCipher()).decode(
        WORKSPACE, PhoenixProvider, {"api_key": None, "project": "dify"}
    )

    assert isinstance(config, PhoenixConfig)
    assert config.api_key is None


def test_stored_configs_that_no_longer_validate_are_unreadable() -> None:
    with pytest.raises(ProviderConfigUnreadableError):
        ProviderConfigCodec(WorkspaceBoundCipher()).decode(WORKSPACE, LangfuseProvider, {"host": "ftp://example"})
