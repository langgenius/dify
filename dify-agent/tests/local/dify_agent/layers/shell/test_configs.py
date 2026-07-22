import pytest
from pydantic import ValidationError

import dify_agent.layers.shell as shell_exports
from dify_agent.layers.shell import (
    DIFY_SHELL_LAYER_TYPE_ID,
    DifyShellCliToolConfig,
    DifyShellEnvVarConfig,
    DifyShellLayerConfig,
    DifyShellSandboxConfig,
    DifyShellSecretRefConfig,
)


def test_shell_package_exports_client_safe_config_symbols_only() -> None:
    assert shell_exports.__all__ == [
        "DIFY_SHELL_LAYER_TYPE_ID",
        "DifyShellCliToolConfig",
        "DifyShellEnvVarConfig",
        "DifyShellLayerConfig",
        "DifyShellSandboxConfig",
        "DifyShellSecretRefConfig",
    ]
    assert DIFY_SHELL_LAYER_TYPE_ID == "dify.shell"
    assert not hasattr(shell_exports, "DifyShellLayer")


def test_shell_layer_config_defaults_and_forbids_unknown_fields() -> None:
    config = DifyShellLayerConfig()

    assert config.model_dump() == {
        "agent_stub_drive_ref": None,
        "cli_tools": [],
        "env": [],
        "secret_refs": [],
        "sandbox": None,
        "redact_patterns": [],
    }

    with pytest.raises(ValidationError):
        _ = DifyShellLayerConfig.model_validate({"entrypoint": "http://shellctl"})


def test_shell_layer_config_accepts_agent_soul_shell_settings() -> None:
    config = DifyShellLayerConfig(
        cli_tools=[
            DifyShellCliToolConfig(
                name="ripgrep",
                install_commands=["  apt-get update  ", "", "apt-get install -y ripgrep"],
                env=[DifyShellEnvVarConfig(name="RG_CONFIG_PATH", value="/workspace/.ripgreprc")],
                secret_refs=[DifyShellSecretRefConfig(name="GITHUB_TOKEN", ref="credential-2")],
            )
        ],
        env=[DifyShellEnvVarConfig(name="PROJECT_NAME", value="demo")],
        secret_refs=[DifyShellSecretRefConfig(name="OPENAI_API_KEY", ref="credential-1")],
        agent_stub_drive_ref="agent-1",
        sandbox=DifyShellSandboxConfig(provider="independent", config={"cpu": 2}),
    )

    assert config.cli_tools[0].install_commands == ["apt-get update", "apt-get install -y ripgrep"]
    assert config.cli_tools[0].env[0].name == "RG_CONFIG_PATH"
    assert config.cli_tools[0].secret_refs[0].ref == "credential-2"
    assert config.env[0].name == "PROJECT_NAME"
    assert config.secret_refs[0].ref == "credential-1"
    assert config.agent_stub_drive_ref == "agent-1"
    assert config.sandbox is not None
    assert config.sandbox.config == {"cpu": 2}


def test_shell_layer_config_rejects_invalid_env_names() -> None:
    with pytest.raises(ValidationError):
        _ = DifyShellEnvVarConfig(name="1_BAD", value="x")

    with pytest.raises(ValidationError):
        _ = DifyShellSecretRefConfig(name="BAD-NAME", ref="secret")
