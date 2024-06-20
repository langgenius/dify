from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class TencentVectorDBConfigs(BaseModel):
    """
    Tencent Vector configs
    """

    TENCENT_VECTOR_DB_URL: Optional[str] = Field(
        description='Tencent Vector URL',
        default=None,
    )

    TENCENT_VECTOR_DB_API_KEY: Optional[str] = Field(
        description='Tencent Vector api key',
        default=None,
    )

    TENCENT_VECTOR_DB_TIMEOUT: PositiveInt = Field(
        description='Tencent Vector timeout',
        default=30,
    )

    TENCENT_VECTOR_DB_USERNAME: Optional[str] = Field(
        description='Tencent Vector password',
        default=None,
    )

    TENCENT_VECTOR_DB_PASSWORD: Optional[str] = Field(
        description='Tencent Vector password',
        default=None,
    )

    TENCENT_VECTOR_DB_SHARD: PositiveInt = Field(
        description='Tencent Vector sharding number',
        default=1,
    )

    TENCENT_VECTOR_DB_REPLICAS: PositiveInt = Field(
        description='Tencent Vector replicas',
        default=2,
    )
