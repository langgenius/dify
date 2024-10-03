from pydantic import Field
from pydantic_settings import BaseSettings


class PackagingInfo(BaseSettings):
    """
    Packaging build information
    """

    CURRENT_VERSION: str = Field(
        description=" Platform version",
        default="0.9.1",
    )

    COMMIT_SHA: str = Field(
        description="SHA-1 checksum of the git commit used to build the app",
        default="",
    )
