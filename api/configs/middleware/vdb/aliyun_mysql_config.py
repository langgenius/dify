from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class AliyunMySQLConfig(BaseSettings):
    """
    Configuration settings for Aliyun MySQL vector database
    """

    ALIYUN_MYSQL_HOST: str = Field(
        description="Hostname or IP address of the Aliyun MySQL server (e.g., 'localhost' or 'mysql.aliyun.com')",
        default="localhost",
    )

    ALIYUN_MYSQL_PORT: PositiveInt = Field(
        description="Port number on which the Aliyun MySQL server is listening (default is 3306)",
        default=3306,
    )

    ALIYUN_MYSQL_USER: str = Field(
        description="Username for authenticating with Aliyun MySQL (default is 'root')",
        default="root",
    )

    ALIYUN_MYSQL_PASSWORD: str = Field(
        description="Password for authenticating with Aliyun MySQL (default is an empty string)",
        default="",
    )

    ALIYUN_MYSQL_DATABASE: str = Field(
        description="Name of the Aliyun MySQL database to connect to (default is 'dify')",
        default="dify",
    )

    ALIYUN_MYSQL_MAX_CONNECTION: PositiveInt = Field(
        description="Maximum number of connections in the connection pool",
        default=10,
    )

    ALIYUN_MYSQL_CHARSET: str = Field(
        description="Character set for Aliyun MySQL connection (default is 'utf8mb4')",
        default="utf8mb4",
    )

    ALIYUN_MYSQL_DISTANCE_FUNCTION: str = Field(
        description="Distance function used for vector similarity search in Aliyun MySQL (e.g., 'cosine', 'euclidean')",
        default="cosine",
    )
