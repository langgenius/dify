from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from core.sandbox.constants import DIFY_CLI_PATH_PATTERN
from core.virtual_environment.__base.entities import Arch, OperatingSystem

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool


class DifyCliBinary(BaseModel):
    operating_system: OperatingSystem = Field(alias="os")
    arch: Arch
    path: Path

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
    }


class DifyCliLocator:
    def __init__(self, root: str | Path | None = None) -> None:
        from configs import dify_config

        if root is not None:
            self._root = Path(root)
        elif dify_config.SANDBOX_DIFY_CLI_ROOT:
            self._root = Path(dify_config.SANDBOX_DIFY_CLI_ROOT)
        else:
            api_root = Path(__file__).resolve().parents[2]
            self._root = api_root / "bin"

    def resolve(self, operating_system: OperatingSystem, arch: Arch) -> DifyCliBinary:
        filename = DIFY_CLI_PATH_PATTERN.format(os=operating_system.value, arch=arch.value)
        candidate = self._root / filename
        if not candidate.is_file():
            raise FileNotFoundError(
                f"dify CLI binary not found: {candidate}. Configure SANDBOX_DIFY_CLI_ROOT or ensure the file exists."
            )

        return DifyCliBinary(os=operating_system, arch=arch, path=candidate)


class DifyCliEnvConfig(BaseModel):
    files_url: str
    inner_api_url: str
    inner_api_session_id: str


class DifyCliToolConfig(BaseModel):
    provider_type: str
    identity: dict[str, Any]
    description: dict[str, Any]
    parameters: list[dict[str, Any]]

    @classmethod
    def create_from_tool(cls, tool: Tool) -> DifyCliToolConfig:
        return cls(
            provider_type=tool.tool_provider_type().value,
            identity=tool.entity.identity.model_dump(),
            description=tool.entity.description.model_dump() if tool.entity.description else {},
            parameters=[param.model_dump() for param in tool.entity.parameters],
        )


class DifyCliConfig(BaseModel):
    env: DifyCliEnvConfig
    tools: list[DifyCliToolConfig]

    @classmethod
    def create(cls, session_id: str, tools: list[Tool]) -> DifyCliConfig:
        from configs import dify_config

        return cls(
            env=DifyCliEnvConfig(
                files_url=dify_config.FILES_URL,
                inner_api_url=dify_config.CONSOLE_API_URL,
                inner_api_session_id=session_id,
            ),
            tools=[DifyCliToolConfig.create_from_tool(tool) for tool in tools],
        )


__all__ = [
    "DifyCliBinary",
    "DifyCliConfig",
    "DifyCliEnvConfig",
    "DifyCliLocator",
    "DifyCliToolConfig",
]
