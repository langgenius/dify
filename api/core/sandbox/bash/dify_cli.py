from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from core.model_runtime.utils.encoders import jsonable_encoder
from core.session.cli_api import CliApiSession
from core.skill.entities import ToolDependencies, ToolReference
from core.tools.entities.tool_entities import ToolParameter, ToolProviderType
from core.virtual_environment.__base.entities import Arch, OperatingSystem

from ..entities import DifyCli

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
            api_root = Path(__file__).resolve().parents[3]
            self._root = api_root / "bin"

    def resolve(self, operating_system: OperatingSystem, arch: Arch) -> DifyCliBinary:
        filename = DifyCli.PATH_PATTERN.format(os=operating_system.value, arch=arch.value)
        candidate = self._root / filename
        if not candidate.is_file():
            raise FileNotFoundError(
                f"dify CLI binary not found: {candidate}. Configure SANDBOX_DIFY_CLI_ROOT or ensure the file exists."
            )

        return DifyCliBinary(os=operating_system, arch=arch, path=candidate)


class DifyCliEnvConfig(BaseModel):
    files_url: str
    cli_api_url: str
    cli_api_session_id: str
    cli_api_secret: str


class DifyCliToolConfig(BaseModel):
    provider_type: str
    enabled: bool = True
    identity: dict[str, Any]
    description: dict[str, Any]
    parameters: list[dict[str, Any]]

    @classmethod
    def transform_provider_type(cls, tool_provider_type: ToolProviderType) -> str:
        provider_type = tool_provider_type
        match tool_provider_type:
            case ToolProviderType.BUILT_IN | ToolProviderType.PLUGIN:
                provider_type = "builtin"
            case ToolProviderType.MCP | ToolProviderType.WORKFLOW | ToolProviderType.API:
                provider_type = provider_type
            case _:
                raise ValueError(f"Invalid tool provider type: {tool_provider_type}")
        return provider_type

    @classmethod
    def create_from_tool(cls, tool: Tool) -> DifyCliToolConfig:
        return cls(
            identity=to_json(tool.entity.identity),
            provider_type=cls.transform_provider_type(tool.tool_provider_type()),
            description=to_json(tool.entity.description),
            parameters=[cls.transform_parameter(parameter) for parameter in tool.entity.parameters],
        )

    @classmethod
    def transform_parameter(cls, parameter: ToolParameter) -> dict[str, Any]:
        transformed_parameter = to_json(parameter)
        transformed_parameter.pop("input_schema", None)
        transformed_parameter.pop("form", None)
        match parameter.type:
            case (
                ToolParameter.ToolParameterType.SYSTEM_FILES
                | ToolParameter.ToolParameterType.FILE
                | ToolParameter.ToolParameterType.FILES
            ):
                return transformed_parameter
            case _:
                return transformed_parameter


class DifyCliToolReference(BaseModel):
    id: str
    tool_type: str
    tool_name: str
    tool_provider: str
    credential_id: str | None = None
    default_value: dict[str, Any] | None = None

    @classmethod
    def create_from_tool_reference(cls, reference: ToolReference) -> DifyCliToolReference:
        return cls(
            id=reference.uuid,
            tool_type=reference.type.value,
            tool_name=reference.tool_name,
            tool_provider=reference.provider,
            credential_id=reference.credential_id,
            default_value=reference.configuration.default_values() if reference.configuration else None,
        )


class DifyCliConfig(BaseModel):
    env: DifyCliEnvConfig
    tool_references: list[DifyCliToolReference]
    tools: list[DifyCliToolConfig]

    @classmethod
    def create(
        cls,
        session: CliApiSession,
        tenant_id: str,
        tool_deps: ToolDependencies,
    ) -> DifyCliConfig:
        from configs import dify_config

        cli_api_url = dify_config.CLI_API_URL

        return cls(
            env=DifyCliEnvConfig(
                files_url=dify_config.FILES_API_URL,
                cli_api_url=cli_api_url,
                cli_api_session_id=session.id,
                cli_api_secret=session.secret,
            ),
            tool_references=[DifyCliToolReference.create_from_tool_reference(ref) for ref in tool_deps.references],
            tools=[],
        )


def to_json(obj: Any) -> dict[str, Any]:
    return jsonable_encoder(obj, exclude_unset=True, exclude_defaults=True, exclude_none=True)


__all__ = [
    "DifyCliBinary",
    "DifyCliConfig",
    "DifyCliEnvConfig",
    "DifyCliLocator",
    "DifyCliToolConfig",
    "DifyCliToolReference",
]
