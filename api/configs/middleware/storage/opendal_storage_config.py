from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class OpenDALStorageConfig(BaseSettings):
    STORAGE_OPENDAL_SCHEME: Literal["fs"] = Field(
        default="fs",
        description="OpenDAL scheme.",
    )
    STORAGE_OPENDAL_ROOT_PATH: str = Field(
        default="storage",
        description="OpenDAL root path.",
    )
