from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class OCIStorageConfig(BaseSettings):
    """
    Configuration settings for Oracle Cloud Infrastructure (OCI) Object Storage
    """

    OCI_ENDPOINT: Optional[str] = Field(
        description="URL of the OCI Object Storage endpoint (e.g., 'https://objectstorage.us-phoenix-1.oraclecloud.com')",
        default=None,
    )

    OCI_REGION: Optional[str] = Field(
        description="OCI region where the bucket is located (e.g., 'us-phoenix-1')",
        default=None,
    )

    OCI_BUCKET_NAME: Optional[str] = Field(
        description="Name of the OCI Object Storage bucket to store and retrieve objects (e.g., 'my-oci-bucket')",
        default=None,
    )

    OCI_ACCESS_KEY: Optional[str] = Field(
        description="Access key (also known as API key) for authenticating with OCI Object Storage",
        default=None,
    )

    OCI_SECRET_KEY: Optional[str] = Field(
        description="Secret key associated with the access key for authenticating with OCI Object Storage",
        default=None,
    )
