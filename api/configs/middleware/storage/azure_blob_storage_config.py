from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class AzureBlobStorageConfig(BaseSettings):
    """
    Configuration settings for Azure Blob Storage
    """

    AZURE_BLOB_ACCOUNT_NAME: Optional[str] = Field(
        description="Name of the Azure Storage account (e.g., 'mystorageaccount')",
        default=None,
    )

    AZURE_BLOB_ACCOUNT_KEY: Optional[str] = Field(
        description="Access key for authenticating with the Azure Storage account",
        default=None,
    )

    AZURE_BLOB_CONTAINER_NAME: Optional[str] = Field(
        description="Name of the Azure Blob container to store and retrieve objects",
        default=None,
    )

    AZURE_BLOB_ACCOUNT_URL: Optional[str] = Field(
        description="URL of the Azure Blob storage endpoint (e.g., 'https://mystorageaccount.blob.core.windows.net')",
        default=None,
    )
