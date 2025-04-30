from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from configs.packaging.pyproject import PyProjectConfig, PyProjectTomlConfig


class PackagingInfo(PyProjectTomlConfig):
    """
    Packaging build information
    """

    COMMIT_SHA: str = Field(
        description="SHA-1 checksum of the git commit used to build the app",
        default="",
    )
