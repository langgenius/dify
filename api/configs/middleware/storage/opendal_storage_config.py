from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings


class OpenDALScheme(StrEnum):
    FS = "fs"
    S3 = "s3"


class OpenDALStorageConfig(BaseSettings):
    STORAGE_OPENDAL_SCHEME: OpenDALScheme = Field(
        default=OpenDALScheme.FS,
        description="OpenDAL scheme.",
    )
    OPENDAL_FS_ROOT: str = Field(
        default="storage",
        description="Root path for local storage.",
    )
