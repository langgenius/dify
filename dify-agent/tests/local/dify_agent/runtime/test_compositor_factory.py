import pytest

import dify_agent.runtime.compositor_factory as compositor_factory_module
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


class FakeFactoryClient:
    async def close(self) -> None:
        return None


def test_default_layer_providers_register_shell_layer_with_configured_token_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_tokens: list[str] = []
    captured_entrypoints: list[str] = []
    fake_client = FakeFactoryClient()

    def fake_create_shellctl_client_factory(*, token: str):
        captured_tokens.append(token)

        def factory(entrypoint: str) -> FakeFactoryClient:
            captured_entrypoints.append(entrypoint)
            return fake_client

        return factory

    monkeypatch.setattr(
        compositor_factory_module, "create_shellctl_client_factory", fake_create_shellctl_client_factory
    )

    providers = create_default_layer_providers(
        shellctl_entrypoint="http://shellctl.example",
        shellctl_auth_token="shell-secret",
    )
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    shell_layer = shell_provider.create_layer(DifyShellLayerConfig())

    assert isinstance(shell_layer, DifyShellLayer)
    assert shell_layer.shellctl_entrypoint == "http://shellctl.example"
    assert captured_tokens == ["shell-secret"]
    assert shell_layer.shellctl_client_factory(shell_layer.shellctl_entrypoint) is fake_client
    assert captured_entrypoints == ["http://shellctl.example"]


def test_default_layer_providers_keep_empty_shellctl_token_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_tokens: list[str] = []

    def fake_create_shellctl_client_factory(*, token: str):
        captured_tokens.append(token)

        def factory(_entrypoint: str) -> FakeFactoryClient:
            return FakeFactoryClient()

        return factory

    monkeypatch.setattr(
        compositor_factory_module, "create_shellctl_client_factory", fake_create_shellctl_client_factory
    )

    providers = create_default_layer_providers(shellctl_entrypoint="http://shellctl.example")
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    _ = shell_provider.create_layer(DifyShellLayerConfig())

    assert captured_tokens == [""]


def test_shell_provider_rejects_blank_settings_entrypoint_only_when_shell_layer_is_created() -> None:
    providers = create_default_layer_providers(shellctl_entrypoint="   ")
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)

    with pytest.raises(ValueError, match="DIFY_AGENT_SHELLCTL_ENTRYPOINT"):
        _ = shell_provider.create_layer(DifyShellLayerConfig())


def test_default_layer_providers_build_agent_stub_token_factory_from_agent_stub_codec() -> None:
    codec = AgentStubTokenCodec.from_server_secret("MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE")

    providers = create_default_layer_providers(
        shellctl_entrypoint="http://shellctl.example",
        agent_stub_url="https://agent.example.com/agent-stub",
        agent_stub_token_codec=codec,
    )
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    shell_layer = shell_provider.create_layer(DifyShellLayerConfig())

    token = shell_layer.agent_stub_token_factory(
        DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            agent_mode="workflow_run",
            invoke_from="service-api",
        ),
        session_id="abc12ff",
    )

    assert isinstance(token, str)
    assert token
