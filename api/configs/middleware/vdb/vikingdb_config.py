from typing import Optional

from pydantic import BaseModel, Field


class VikingDBConfig(BaseModel):
    """
    Configuration for connecting to Volcengine VikingDB.
    Refer to the following documentation for details on obtaining credentials:
    https://www.volcengine.com/docs/6291/65568
    """

    VIKINGDB_ACCESS_KEY: Optional[str] = Field(
        default=None, description="The Access Key provided by Volcengine VikingDB for API authentication."
    )
    VIKINGDB_SECRET_KEY: Optional[str] = Field(
        default=None, description="The Secret Key provided by Volcengine VikingDB for API authentication."
    )
    VIKINGDB_REGION: Optional[str] = Field(
        default="cn-shanghai",
        description="The region of the Volcengine VikingDB service.(e.g., 'cn-shanghai', 'cn-beijing').",
    )
    VIKINGDB_HOST: Optional[str] = Field(
        default="api-vikingdb.mlp.cn-shanghai.volces.com",
        description="The host of the Volcengine VikingDB service.(e.g., 'api-vikingdb.volces.com', \
            'api-vikingdb.mlp.cn-shanghai.volces.com')",
    )
    VIKINGDB_SCHEME: Optional[str] = Field(
        default="http",
        description="The scheme of the Volcengine VikingDB service.(e.g., 'http', 'https').",
    )
    VIKINGDB_CONNECTION_TIMEOUT: Optional[int] = Field(
        default=30, description="The connection timeout of the Volcengine VikingDB service."
    )
    VIKINGDB_SOCKET_TIMEOUT: Optional[int] = Field(
        default=30, description="The socket timeout of the Volcengine VikingDB service."
    )
