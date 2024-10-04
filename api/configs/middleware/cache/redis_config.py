from typing import Optional

from pydantic import Field, NonNegativeInt, PositiveFloat, PositiveInt
from pydantic_settings import BaseSettings


class RedisConfig(BaseSettings):
    """
    Redis configs
    """

    REDIS_HOST: str = Field(
        description="Redis host",
        default="localhost",
    )

    REDIS_PORT: PositiveInt = Field(
        description="Redis port",
        default=6379,
    )

    REDIS_USERNAME: Optional[str] = Field(
        description="Redis username",
        default=None,
    )

    REDIS_PASSWORD: Optional[str] = Field(
        description="Redis password",
        default=None,
    )

    REDIS_DB: NonNegativeInt = Field(
        description="Redis database id, default to 0",
        default=0,
    )

    REDIS_USE_SSL: bool = Field(
        description="whether to use SSL for Redis connection",
        default=False,
    )

    REDIS_USE_SENTINEL: Optional[bool] = Field(
        description="Whether to use Redis Sentinel mode",
        default=False,
    )

    REDIS_SENTINELS: Optional[str] = Field(
        description="Redis Sentinel nodes",
        default=None,
    )

    REDIS_SENTINEL_SERVICE_NAME: Optional[str] = Field(
        description="Redis Sentinel service name",
        default=None,
    )

    REDIS_SENTINEL_USERNAME: Optional[str] = Field(
        description="Redis Sentinel username",
        default=None,
    )

    REDIS_SENTINEL_PASSWORD: Optional[str] = Field(
        description="Redis Sentinel password",
        default=None,
    )

    REDIS_SENTINEL_SOCKET_TIMEOUT: Optional[PositiveFloat] = Field(
        description="Redis Sentinel socket timeout",
        default=0.1,
    )
