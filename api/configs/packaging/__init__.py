from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from configs.packaging.pyproject import PyProjectConfig, PyProjectTomlConfig


class PackagingInfo(PyProjectTomlConfig):
    """
    Packaging build information
    """

    CURRENT_VERSION: str = Field(
        description="Dify version",
        default="1.3.1",
    )

    COMMIT_SHA: str = Field(
        description="SHA-1 checksum of the git commit used to build the app",
        default="",
    )
