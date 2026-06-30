from typing import cast

import pytest

import dify_agent.runtime.compositor_factory as compositor_factory_module
from dify_agent.adapters.shell.config import ShellAdapterSettings
from dify_agent.adapters.shell.protocols import ShellProvisionProtocol
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


class FakeProvisioner:
    """No-op provisioner for tests that never actually provision a workspace."""

    async def provision(self) -> object:
        raise AssertionError("provision should not be called by these tests")

    async def reattach(self, descriptor: object) -> object:
        raise AssertionError("reattach should not be called by these tests")

    async def destroy(self, handle: object) -> None:
        raise AssertionError("destroy should not be called by these tests")


def test_default_layer_providers_register_shell_layer_with_configured_token_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_settings: list[ShellAdapterSettings] = []
    fake_provisioner = FakeProvisioner()

    def fake_create_shell_provisioner(settings: ShellAdapterSettings) -> ShellProvisionProtocol:
        captured_settings.append(settings)
        return cast(ShellProvisionProtocol, fake_provisioner)

    monkeypatch.setattr(compositor_factory_module, "create_shell_provisioner", fake_create_shell_provisioner)

    providers = create_default_layer_providers(
        shellctl_entrypoint="http://shellctl.example",
        shellctl_auth_token="shell-secret",
    )
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    shell_layer = shell_provider.create_layer(DifyShellLayerConfig())

    assert isinstance(shell_layer, DifyShellLayer)
    assert shell_layer.shell_provisioner is fake_provisioner
    assert len(captured_settings) == 1
    assert captured_settings[0].shellctl_entrypoint == "http://shellctl.example"
    assert captured_settings[0].shellctl_auth_token == "shell-secret"


def test_default_layer_providers_keep_empty_shellctl_token_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_settings: list[ShellAdapterSettings] = []

    def fake_create_shell_provisioner(settings: ShellAdapterSettings) -> ShellProvisionProtocol:
        captured_settings.append(settings)
        return cast(ShellProvisionProtocol, FakeProvisioner())

    monkeypatch.setattr(compositor_factory_module, "create_shell_provisioner", fake_create_shell_provisioner)

    providers = create_default_layer_providers(shellctl_entrypoint="http://shellctl.example")
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    _ = shell_provider.create_layer(DifyShellLayerConfig())

    assert len(captured_settings) == 1
    assert captured_settings[0].shellctl_auth_token is None


def test_shell_provider_rejects_blank_settings_entrypoint_only_when_shell_layer_is_created() -> None:
    providers = create_default_layer_providers(shellctl_entrypoint="   ")
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)

    with pytest.raises(ValueError, match="DIFY_AGENT_SHELLCTL_ENTRYPOINT"):
        _ = shell_provider.create_layer(DifyShellLayerConfig())


def test_default_layer_providers_build_agent_stub_token_factory_from_agent_stub_codec() -> None:
    codec = AgentStubTokenCodec.from_server_secret("MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE")

    providers = create_default_layer_providers(
        shellctl_entrypoint="http://shellctl.example",
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
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
