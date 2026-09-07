from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class PyProjectConfig(BaseModel):
    version: str = Field(description="Dify version", default="")


class DifyToolConfig(BaseModel):
    min_difyctl_version: str = Field(
        description="Oldest difyctl version served on /openapi/v1",
        default="0.0.0",
    )


class ToolConfig(BaseModel):
    dify: DifyToolConfig = Field(default=DifyToolConfig())


class PyProjectTomlConfig(BaseSettings):
    """
    configs in api/pyproject.toml
    """

    project: PyProjectConfig = Field(
        description="configs in the project section of pyproject.toml",
        default=PyProjectConfig(),
    )

    tool: ToolConfig = Field(
        description="configs in the [tool.*] section of pyproject.toml",
        default=ToolConfig(),
    )
