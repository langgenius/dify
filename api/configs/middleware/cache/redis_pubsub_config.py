from typing import Literal, Protocol
from urllib.parse import quote_plus, urlunparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings


class RedisConfigDefaults(Protocol):
    REDIS_HOST: str
    REDIS_PORT: int
    REDIS_USERNAME: str | None
    REDIS_PASSWORD: str | None
    REDIS_DB: int
    REDIS_USE_SSL: bool
    REDIS_USE_SENTINEL: bool | None
    REDIS_USE_CLUSTERS: bool


class RedisConfigDefaultsMixin:
    def _redis_defaults(self: RedisConfigDefaults) -> RedisConfigDefaults:
        return self


class RedisPubSubConfig(BaseSettings, RedisConfigDefaultsMixin):
    """
    Configuration settings for Redis pub/sub streaming.
    """

    PUBSUB_REDIS_URL: str | None = Field(
        description=(
            "Redis connection URL for pub/sub streaming events between API "
            "and celery worker, defaults to url constructed from "
            "`REDIS_*` configurations"
        ),
        default=None,
    )

    PUBSUB_REDIS_USE_CLUSTERS: bool = Field(
        description=(
            "Enable Redis Cluster mode for pub/sub streaming. It's highly "
            "recommended to enable this for large deployments."
        ),
        default=False,
    )

    PUBSUB_REDIS_CHANNEL_TYPE: Literal["pubsub", "sharded"] = Field(
        description=(
            "Pub/sub channel type for streaming events. "
            "Valid options are:\n"
            "\n"
            " - pubsub: for normal Pub/Sub\n"
            " - sharded: for sharded Pub/Sub\n"
            "\n"
            "It's highly recommended to use sharded Pub/Sub AND redis cluster "
            "for large deployments."
        ),
        default="pubsub",
    )

    @model_validator(mode="after")
    def apply_pubsub_defaults(self) -> "RedisPubSubConfig":
        if self.PUBSUB_REDIS_URL:
            cleaned = self.PUBSUB_REDIS_URL.strip()
            self.PUBSUB_REDIS_URL = cleaned or None

        if self.PUBSUB_REDIS_URL:
            return self

        defaults = self._redis_defaults()
        self.PUBSUB_REDIS_URL = self._build_default_pubsub_url()
        return self

    def _build_default_pubsub_url(self) -> str:
        defaults = self._redis_defaults()
        if not defaults.REDIS_HOST or not defaults.REDIS_PORT:
            raise ValueError("PUBSUB_REDIS_URL must be set when default Redis URL cannot be constructed")

        scheme = "rediss" if defaults.REDIS_USE_SSL else "redis"
        username = defaults.REDIS_USERNAME or None
        password = defaults.REDIS_PASSWORD or None

        userinfo = ""
        if username:
            userinfo = quote_plus(username)
        if password:
            password_part = quote_plus(password)
            userinfo = f"{userinfo}:{password_part}" if userinfo else f":{password_part}"
        if userinfo:
            userinfo = f"{userinfo}@"

        host = defaults.REDIS_HOST
        port = defaults.REDIS_PORT
        db = defaults.REDIS_DB

        netloc = f"{userinfo}{host}:{port}"
        return urlunparse((scheme, netloc, f"/{db}", "", "", ""))
