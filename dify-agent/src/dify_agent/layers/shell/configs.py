"""Client-safe DTOs for the Dify shell Agenton layer.

Server-only shellctl connection settings are injected by the runtime provider
factory. Public config carries product-level Agent Soul settings that must affect
the sandbox workspace itself: CLI tool bootstrap commands, normal environment
variables, secret environment variable names, sandbox-provider metadata, and the
Agent Stub drive ref used by shell-visible drive commands.
"""

import re
from typing import ClassVar, Final

from pydantic import BaseModel, ConfigDict, Field, field_validator

from agenton.layers import LayerConfig


DIFY_SHELL_LAYER_TYPE_ID: Final[str] = "dify.shell"
_ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class DifyShellEnvVarConfig(BaseModel):
    """One shell environment variable exported for every sandbox command."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    value: str = ""

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not _ENV_NAME_PATTERN.fullmatch(value):
            raise ValueError("env var name must be a valid shell identifier")
        return value


class DifyShellSecretRefConfig(BaseModel):
    """Name of a secret env var expected to be supplied by the sandbox host."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    ref: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not _ENV_NAME_PATTERN.fullmatch(value):
            raise ValueError("secret env var name must be a valid shell identifier")
        return value


class DifyShellCliToolConfig(BaseModel):
    """One CLI tool declaration that can bootstrap itself in the sandbox."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    install_commands: list[str] = Field(default_factory=list)
    env: list[DifyShellEnvVarConfig] = Field(default_factory=list)
    secret_refs: list[DifyShellSecretRefConfig] = Field(default_factory=list)

    @field_validator("install_commands")
    @classmethod
    def _reject_blank_install_commands(cls, value: list[str]) -> list[str]:
        return [command for command in (item.strip() for item in value) if command]


class DifyShellSandboxConfig(BaseModel):
    """Sandbox provider selection persisted in Agent Soul."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    provider: str | None = Field(default=None, max_length=255)
    config: dict[str, object] = Field(default_factory=dict)

class DifyShellEnterpriseSandboxConfig(DifyShellSandboxConfig):
    """Enterprise sandbox provider configuration."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")
    gateway_endpoint: str = Field(..., max_length=255)

class DifyShellLayerConfig(LayerConfig):
    """Public config for the shellctl-backed Dify shell layer."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    # Optional because shell can be used without a drive layer.
    agent_stub_drive_ref: str | None = Field(default=None, max_length=1024)
    cli_tools: list[DifyShellCliToolConfig] = Field(default_factory=list)
    env: list[DifyShellEnvVarConfig] = Field(default_factory=list)
    secret_refs: list[DifyShellSecretRefConfig] = Field(default_factory=list)
    sandbox: DifyShellSandboxConfig | None = None


__all__ = [
    "DIFY_SHELL_LAYER_TYPE_ID",
    "DifyShellCliToolConfig",
    "DifyShellEnvVarConfig",
    "DifyShellLayerConfig",
    "DifyShellSandboxConfig",
    "DifyShellSecretRefConfig",
]
