from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class PyProjectConfig(BaseModel):
    version: str = Field(description="Dify version", default="")


class PyProjectTomlConfig(BaseSettings):
    """
    configs in api/pyproject.toml
    """

    project: PyProjectConfig = Field(
        description="configs in the project section of pyproject.toml",
        default=PyProjectConfig(),
    )
