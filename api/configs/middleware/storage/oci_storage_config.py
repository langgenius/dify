from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class OCIStorageConfig(BaseSettings):
    """
    OCI storage configs
    """

    OCI_ENDPOINT: Optional[str] = Field(
        description='OCI storage endpoint',
        default=None,
    )

    OCI_REGION: Optional[str] = Field(
        description='OCI storage region',
        default=None,
    )

    OCI_BUCKET_NAME: Optional[str] = Field(
        description='OCI storage bucket name',
        default=None,
    )

    OCI_ACCESS_KEY: Optional[str] = Field(
        description='OCI storage access key',
        default=None,
    )

    OCI_SECRET_KEY: Optional[str] = Field(
        description='OCI storage secret key',
        default=None,
    )

