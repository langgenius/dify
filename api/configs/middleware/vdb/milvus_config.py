from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class MilvusConfig(BaseSettings):
    """
    Milvus configs
    """

    MILVUS_HOST: Optional[str] = Field(
        description="Milvus host",
        default=None,
    )

    MILVUS_PORT: PositiveInt = Field(
        description="Milvus RestFul API port",
        default=9091,
    )

    MILVUS_USER: Optional[str] = Field(
        description="Milvus user",
        default=None,
    )

    MILVUS_PASSWORD: Optional[str] = Field(
        description="Milvus password",
        default=None,
    )

    MILVUS_SECURE: bool = Field(
        description="whether to use SSL connection for Milvus",
        default=False,
    )

    MILVUS_DATABASE: str = Field(
        description="Milvus database, default to `default`",
        default="default",
    )
