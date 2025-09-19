from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class BaiduVectorDBConfig(BaseSettings):
    """
    Configuration settings for Baidu Vector Database
    """

    BAIDU_VECTOR_DB_ENDPOINT: str | None = Field(
        description="URL of the Baidu Vector Database service (e.g., 'http://vdb.bj.baidubce.com')",
        default=None,
    )

    BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS: PositiveInt = Field(
        description="Timeout in milliseconds for Baidu Vector Database operations (default is 30000 milliseconds)",
        default=30000,
    )

    BAIDU_VECTOR_DB_ACCOUNT: str | None = Field(
        description="Account for authenticating with the Baidu Vector Database",
        default=None,
    )

    BAIDU_VECTOR_DB_API_KEY: str | None = Field(
        description="API key for authenticating with the Baidu Vector Database service",
        default=None,
    )

    BAIDU_VECTOR_DB_DATABASE: str | None = Field(
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

    BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER: str = Field(
        description="Analyzer type for inverted index in Baidu Vector Database (default is DEFAULT_ANALYZER)",
        default="DEFAULT_ANALYZER",
    )

    BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE: str = Field(
        description="Parser mode for inverted index in Baidu Vector Database (default is COARSE_MODE)",
        default="COARSE_MODE",
    )
