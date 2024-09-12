from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class MilvusConfig(BaseSettings):
    """
    Milvus configs
    """

    MILVUS_URI: Optional[str] = Field(
        description="Milvus uri",
        default="http://127.0.0.1:19530",
    )

    MILVUS_TOKEN: Optional[str] = Field(
        description="Milvus token",
        default=None,
    )

    MILVUS_USER: Optional[str] = Field(
        description="Milvus user",
        default=None,
    )

    MILVUS_PASSWORD: Optional[str] = Field(
        description="Milvus password",
        default=None,
    )

    MILVUS_DATABASE: str = Field(
        description="Milvus database, default to `default`",
        default="default",
    )
