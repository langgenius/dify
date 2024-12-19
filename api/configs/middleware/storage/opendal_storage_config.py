from pydantic import Field
from pydantic_settings import BaseSettings


class OpenDALStorageConfig(BaseSettings):
    OPENDAL_SCHEME: str = Field(
        default="fs",
        description="OpenDAL scheme.",
    )
