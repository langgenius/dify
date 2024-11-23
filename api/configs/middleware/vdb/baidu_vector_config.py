from typing import Optional

from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class BaiduVectorDBConfig(BaseSettings):
    """
    Configuration settings for Baidu Vector Database
    """

    BAIDU_VECTOR_DB_ENDPOINT: Optional[str] = Field(
        description="URL of the Baidu Vector Database service (e.g., 'http://vdb.bj.baidubce.com')",
        default=None,
    )

    BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS: PositiveInt = Field(
        description="Timeout in milliseconds for Baidu Vector Database operations (default is 30000 milliseconds)",
        default=30000,
    )

    BAIDU_VECTOR_DB_ACCOUNT: Optional[str] = Field(
        description="Account for authenticating with the Baidu Vector Database",
        default=None,
    )

    BAIDU_VECTOR_DB_API_KEY: Optional[str] = Field(
        description="API key for authenticating with the Baidu Vector Database service",
        default=None,
    )

    BAIDU_VECTOR_DB_DATABASE: Optional[str] = Field(
        description="Name of the specific Baidu Vector Database to connect to",
        default=None,
    )

    BAIDU_VECTOR_DB_SHARD: PositiveInt = Field(
        description="Number of shards for the Baidu Vector Database (default is 1)",
        default=1,
    )

    BAIDU_VECTOR_DB_REPLICAS: NonNegativeInt = Field(
        description="Number of replicas for the Baidu Vector Database (default is 3)",
        default=3,
    )
