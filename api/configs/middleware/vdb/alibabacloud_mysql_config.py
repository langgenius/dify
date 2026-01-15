from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class AlibabaCloudMySQLConfig(BaseSettings):
    """
    Configuration settings for AlibabaCloud MySQL vector database
    """

    ALIBABACLOUD_MYSQL_HOST: str = Field(
        description="Hostname or IP address of the AlibabaCloud MySQL server (e.g., 'localhost' or 'mysql.aliyun.com')",
        default="localhost",
    )

    ALIBABACLOUD_MYSQL_PORT: PositiveInt = Field(
        description="Port number on which the AlibabaCloud MySQL server is listening (default is 3306)",
        default=3306,
    )

    ALIBABACLOUD_MYSQL_USER: str = Field(
        description="Username for authenticating with AlibabaCloud MySQL (default is 'root')",
        default="root",
    )

    ALIBABACLOUD_MYSQL_PASSWORD: str = Field(
        description="Password for authenticating with AlibabaCloud MySQL (default is an empty string)",
        default="",
    )

    ALIBABACLOUD_MYSQL_DATABASE: str = Field(
        description="Name of the AlibabaCloud MySQL database to connect to (default is 'dify')",
        default="dify",
    )

    ALIBABACLOUD_MYSQL_MAX_CONNECTION: PositiveInt = Field(
        description="Maximum number of connections in the connection pool",
        default=5,
    )

    ALIBABACLOUD_MYSQL_CHARSET: str = Field(
        description="Character set for AlibabaCloud MySQL connection (default is 'utf8mb4')",
        default="utf8mb4",
    )

    ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION: str = Field(
        description="Distance function used for vector similarity search in AlibabaCloud MySQL "
        "(e.g., 'cosine', 'euclidean')",
        default="cosine",
    )

    ALIBABACLOUD_MYSQL_HNSW_M: PositiveInt = Field(
        description="Maximum number of connections per layer for HNSW vector index (default is 6, range: 3-200)",
        default=6,
    )
