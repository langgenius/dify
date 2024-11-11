from typing import Optional

from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class TencentVectorDBConfig(BaseSettings):
    """
    Configuration settings for Tencent Vector Database
    """

    TENCENT_VECTOR_DB_URL: Optional[str] = Field(
        description="URL of the Tencent Vector Database service (e.g., 'https://vectordb.tencentcloudapi.com')",
        default=None,
    )

    TENCENT_VECTOR_DB_API_KEY: Optional[str] = Field(
        description="API key for authenticating with the Tencent Vector Database service",
        default=None,
    )

    TENCENT_VECTOR_DB_TIMEOUT: PositiveInt = Field(
        description="Timeout in seconds for Tencent Vector Database operations (default is 30 seconds)",
        default=30,
    )

    TENCENT_VECTOR_DB_USERNAME: Optional[str] = Field(
        description="Username for authenticating with the Tencent Vector Database (if required)",
        default=None,
    )

    TENCENT_VECTOR_DB_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the Tencent Vector Database (if required)",
        default=None,
    )

    TENCENT_VECTOR_DB_SHARD: PositiveInt = Field(
        description="Number of shards for the Tencent Vector Database (default is 1)",
        default=1,
    )

    TENCENT_VECTOR_DB_REPLICAS: NonNegativeInt = Field(
        description="Number of replicas for the Tencent Vector Database (default is 2)",
        default=2,
    )

    TENCENT_VECTOR_DB_DATABASE: Optional[str] = Field(
        description="Name of the specific Tencent Vector Database to connect to",
        default=None,
    )
