from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class PyProjectConfig(BaseModel):
    version: str = Field(
        description="Dify version",
    )


class PyProjectTomlConfig(BaseSettings):
    """
    configs in api/pyproject.toml
    """

    # [project] section
    project: PyProjectConfig
