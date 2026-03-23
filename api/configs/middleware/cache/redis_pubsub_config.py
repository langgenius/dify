from typing import Literal, Protocol
from urllib.parse import quote_plus, urlunparse

from pydantic import AliasChoices, Field
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
    Configuration settings for event transport between API and workers.

    Supported transports:
    - pubsub: Redis PUBLISH/SUBSCRIBE (at-most-once)
    - sharded: Redis 7+ Sharded Pub/Sub (at-most-once, better scaling)
    - streams: Redis Streams (at-least-once, supports late subscribers)
    """

    PUBSUB_REDIS_URL: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_URL", "PUBSUB_REDIS_URL"),
        description=(
            "Redis connection URL for streaming events between API and celery worker; "
            "defaults to URL constructed from `REDIS_*` configurations. Also accepts ENV: EVENT_BUS_REDIS_URL."
        ),
        default=None,
    )

    PUBSUB_REDIS_USE_CLUSTERS: bool = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_CLUSTERS", "PUBSUB_REDIS_USE_CLUSTERS"),
        description=(
            "Enable Redis Cluster mode for pub/sub or streams transport. Recommended for large deployments. "
            "Also accepts ENV: EVENT_BUS_REDIS_CLUSTERS."
        ),
        default=False,
    )

    PUBSUB_REDIS_CHANNEL_TYPE: Literal["pubsub", "sharded", "streams"] = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_CHANNEL_TYPE", "PUBSUB_REDIS_CHANNEL_TYPE"),
        description=(
            "Event transport type. Options are:\n\n"
            " - pubsub: normal Pub/Sub (at-most-once)\n"
            " - sharded: sharded Pub/Sub (at-most-once)\n"
            " - streams: Redis Streams (at-least-once, recommended to avoid subscriber races)\n\n"
            "Note: Before enabling 'streams' in production, estimate your expected event volume and retention needs.\n"
            "Configure Redis memory limits and stream trimming appropriately (e.g., MAXLEN and key expiry) to reduce\n"
            "the risk of data loss from Redis auto-eviction under memory pressure.\n"
            "Also accepts ENV: EVENT_BUS_REDIS_CHANNEL_TYPE."
        ),
        default="pubsub",
    )

    PUBSUB_STREAMS_RETENTION_SECONDS: int = Field(
        validation_alias=AliasChoices("EVENT_BUS_STREAMS_RETENTION_SECONDS", "PUBSUB_STREAMS_RETENTION_SECONDS"),
        description=(
            "When using 'streams', expire each stream key this many seconds after the last event is published. "
            "Also accepts ENV: EVENT_BUS_STREAMS_RETENTION_SECONDS."
        ),
        default=600,
    )

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

    @property
    def normalized_pubsub_redis_url(self) -> str:
        pubsub_redis_url = self.PUBSUB_REDIS_URL
        if pubsub_redis_url:
            cleaned = pubsub_redis_url.strip()
            pubsub_redis_url = cleaned or None

        if pubsub_redis_url:
            return pubsub_redis_url

        return self._build_default_pubsub_url()
