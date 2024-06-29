from pydantic import BaseModel, Field


class PackagingInfo(BaseModel):
    """
    Packaging build information
    """

    CURRENT_VERSION: str = Field(
        description='Dify version',
        default='0.6.12-fix1',
    )

    COMMIT_SHA: str = Field(
        description="SHA-1 checksum of the git commit used to build the app",
        default='',
    )
