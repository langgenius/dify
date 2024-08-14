from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class GoogleCloudStorageConfig(BaseSettings):
    """
    Google Cloud storage configs
    """

    GOOGLE_STORAGE_BUCKET_NAME: Optional[str] = Field(
        description='Google Cloud storage bucket name',
        default=None,
    )

    GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64: Optional[str] = Field(
        description='Google Cloud storage service account json base64',
        default=None,
    )
