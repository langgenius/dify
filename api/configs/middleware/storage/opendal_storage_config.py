from enum import StrEnum
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class OpenDALScheme(StrEnum):
    FS = "fs"
    S3 = "s3"


class OpenDALStorageConfig(BaseSettings):
    STORAGE_OPENDAL_SCHEME: str = Field(
        default=OpenDALScheme.FS.value,
        description="OpenDAL scheme.",
    )
    # FS
    OPENDAL_FS_ROOT: str = Field(
        default="storage",
        description="Root path for local storage.",
    )
    # S3
    OPENDAL_S3_ROOT: str = Field(
        default="/",
        description="Root path for S3 storage.",
    )
    OPENDAL_S3_BUCKET: str = Field(
        default="",
        description="S3 bucket name.",
    )
    OPENDAL_S3_ENDPOINT: str = Field(
        default="https://s3.amazonaws.com",
        description="S3 endpoint URL.",
    )
    OPENDAL_S3_ACCESS_KEY_ID: str = Field(
        default="",
        description="S3 access key ID.",
    )
    OPENDAL_S3_SECRET_ACCESS_KEY: str = Field(
        default="",
        description="S3 secret access key.",
    )
    OPENDAL_S3_REGION: str = Field(
        default="",
        description="S3 region.",
    )
    OPENDAL_S3_SERVER_SIDE_ENCRYPTION: Literal["aws:kms", ""] = Field(
        default="",
        description="S3 server-side encryption.",
    )
