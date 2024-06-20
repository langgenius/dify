from typing import Optional

from pydantic import BaseModel, Field, NonNegativeInt, PositiveInt


class RedisConfigs(BaseModel):
    """
    Redis configs
    """
    REDIS_HOST: str = Field(
        description='Redis host',
        default='localhost',
    )

    REDIS_PORT: PositiveInt = Field(
        description='Redis port',
        default=6379,
    )

    REDIS_USERNAME: Optional[str] = Field(
        description='Redis username',
        default=None,
    )

    REDIS_PASSWORD: Optional[str] = Field(
        description='Redis password',
        default=None,
    )

    REDIS_DB: NonNegativeInt = Field(
        description='Redis database id, default to 0',
        default=0,
    )

    REDIS_USE_SSL: bool = Field(
        description='whether to use SSL for Redis connection',
        default=False,
    )
