from pydantic import Field
from pydantic_settings import BaseSettings


class ArchiveStorageConfig(BaseSettings):
    """
    Configuration settings for workflow run logs archiving storage.
    """

    ARCHIVE_STORAGE_ENABLED: bool = Field(
        description="Enable workflow run logs archiving to S3-compatible storage",
        default=False,
    )

    ARCHIVE_STORAGE_ENDPOINT: str | None = Field(
        description="URL of the S3-compatible storage endpoint (e.g., 'https://storage.example.com')",
        default=None,
    )

    ARCHIVE_STORAGE_ARCHIVE_BUCKET: str | None = Field(
        description="Name of the bucket to store archived workflow logs",
        default=None,
    )

    ARCHIVE_STORAGE_EXPORT_BUCKET: str | None = Field(
        description="Name of the bucket to store exported workflow runs",
        default=None,
    )

    ARCHIVE_STORAGE_ACCESS_KEY: str | None = Field(
        description="Access key ID for authenticating with storage",
        default=None,
    )

    ARCHIVE_STORAGE_SECRET_KEY: str | None = Field(
        description="Secret access key for authenticating with storage",
        default=None,
    )

    ARCHIVE_STORAGE_REGION: str = Field(
        description="Region for storage (use 'auto' if the provider supports it)",
        default="auto",
    )
