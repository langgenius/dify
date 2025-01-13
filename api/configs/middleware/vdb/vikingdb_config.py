from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class VikingDBConfig(BaseSettings):
    """
    Configuration for connecting to Volcengine VikingDB.
    Refer to the following documentation for details on obtaining credentials:
    https://www.volcengine.com/docs/6291/65568
    """

    VIKINGDB_ACCESS_KEY: Optional[str] = Field(
        description="The Access Key provided by Volcengine VikingDB for API authentication."
        "Refer to the following documentation for details on obtaining credentials:"
        "https://www.volcengine.com/docs/6291/65568",
        default=None,
    )

    VIKINGDB_SECRET_KEY: Optional[str] = Field(
        description="The Secret Key provided by Volcengine VikingDB for API authentication.",
        default=None,
    )

    VIKINGDB_REGION: str = Field(
        description="The region of the Volcengine VikingDB service.(e.g., 'cn-shanghai', 'cn-beijing').",
        default="cn-shanghai",
    )

    VIKINGDB_HOST: str = Field(
        description="The host of the Volcengine VikingDB service.(e.g., 'api-vikingdb.volces.com', \
            'api-vikingdb.mlp.cn-shanghai.volces.com')",
        default="api-vikingdb.mlp.cn-shanghai.volces.com",
    )

    VIKINGDB_SCHEME: str = Field(
        description="The scheme of the Volcengine VikingDB service.(e.g., 'http', 'https').",
        default="http",
    )

    VIKINGDB_CONNECTION_TIMEOUT: int = Field(
        description="The connection timeout of the Volcengine VikingDB service.",
        default=30,
    )

    VIKINGDB_SOCKET_TIMEOUT: int = Field(
        description="The socket timeout of the Volcengine VikingDB service.",
        default=30,
    )
