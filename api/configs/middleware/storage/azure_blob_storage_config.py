from typing import Optional

from pydantic import BaseModel, Field


class AzureBlobStorageConfig(BaseModel):
    """
    Azure Blob storage configs
    """

    AZURE_BLOB_ACCOUNT_NAME: Optional[str] = Field(
        description='Azure Blob account name',
        default=None,
    )

    AZURE_BLOB_ACCOUNT_KEY: Optional[str] = Field(
        description='Azure Blob account key',
        default=None,
    )

    AZURE_BLOB_CONTAINER_NAME: Optional[str] = Field(
        description='Azure Blob container name',
        default=None,
    )

    AZURE_BLOB_ACCOUNT_URL: Optional[str] = Field(
        description='Azure Blob account URL',
        default=None,
    )
