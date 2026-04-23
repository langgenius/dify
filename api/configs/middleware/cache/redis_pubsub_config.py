from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class RedisPubSubConfig(BaseSettings):
    """
    Configuration settings for event transport between API and workers.

    Supported transports:
    - pubsub: Redis PUBLISH/SUBSCRIBE (at-most-once)
    - sharded: Redis 7+ Sharded Pub/Sub (at-most-once, better scaling)
    - streams: Redis Streams (at-least-once, supports late subscribers)

    Connection-topology resolution (see ``build_pubsub_spec`` in
    ``redis_connection_spec.py``):

    1. ``PUBSUB_REDIS_MODE`` set → build a dedicated spec from the
       structured ``PUBSUB_REDIS_*`` fields (all three topologies,
       including independent Sentinel).
    2. Otherwise → inherit the main Redis spec so the pub/sub client
       reuses the main client object and its failover-aware handle.
    """

    # ------------------------------------------------------------------
    # Structured mode selector
    # ------------------------------------------------------------------

    PUBSUB_REDIS_MODE: Literal["standalone", "sentinel", "cluster"] | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_MODE", "PUBSUB_REDIS_MODE"),
        description=(
            "Topology mode for the Event Bus. When set, the Event Bus builds a dedicated "
            "client from PUBSUB_REDIS_* fields instead of inheriting the main Redis spec. "
            "Set to 'sentinel' to route pub/sub through a Sentinel-quorum-aware client "
            "independent from the main Redis. "
            "Also accepts ENV: EVENT_BUS_REDIS_MODE."
        ),
        default=None,
    )

    # ------------------------------------------------------------------
    # Structured standalone fields (used when PUBSUB_REDIS_MODE=standalone)
    # ------------------------------------------------------------------

    PUBSUB_REDIS_HOST: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_HOST", "PUBSUB_REDIS_HOST"),
        description="Event Bus Redis host (PUBSUB_REDIS_MODE=standalone).",
        default=None,
    )
    PUBSUB_REDIS_PORT: int | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_PORT", "PUBSUB_REDIS_PORT"),
        description="Event Bus Redis port (PUBSUB_REDIS_MODE=standalone).",
        default=None,
    )
    PUBSUB_REDIS_DB: int | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_DB", "PUBSUB_REDIS_DB"),
        description="Event Bus Redis database number (standalone / sentinel).",
        default=None,
    )

    # ------------------------------------------------------------------
    # Structured sentinel fields (used when PUBSUB_REDIS_MODE=sentinel)
    # ------------------------------------------------------------------

    PUBSUB_REDIS_SENTINELS: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_SENTINELS", "PUBSUB_REDIS_SENTINELS"),
        description="Comma-separated 'host:port' list of Sentinel nodes for the Event Bus.",
        default=None,
    )
    PUBSUB_REDIS_SENTINEL_SERVICE_NAME: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_SENTINEL_SERVICE_NAME", "PUBSUB_REDIS_SENTINEL_SERVICE_NAME"),
        description="Sentinel service (master) name to resolve for the Event Bus.",
        default=None,
    )
    PUBSUB_REDIS_SENTINEL_USERNAME: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_SENTINEL_USERNAME", "PUBSUB_REDIS_SENTINEL_USERNAME"),
        description="Username for authenticating to the Event Bus Sentinel quorum.",
        default=None,
    )
    PUBSUB_REDIS_SENTINEL_PASSWORD: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_SENTINEL_PASSWORD", "PUBSUB_REDIS_SENTINEL_PASSWORD"),
        description="Password for authenticating to the Event Bus Sentinel quorum.",
        default=None,
    )
    PUBSUB_REDIS_SENTINEL_SOCKET_TIMEOUT: float | None = Field(
        validation_alias=AliasChoices(
            "EVENT_BUS_REDIS_SENTINEL_SOCKET_TIMEOUT", "PUBSUB_REDIS_SENTINEL_SOCKET_TIMEOUT"
        ),
        description="Socket timeout (seconds) for the Event Bus Sentinel connection.",
        default=None,
    )

    # ------------------------------------------------------------------
    # Structured cluster fields (used when PUBSUB_REDIS_MODE=cluster)
    # ------------------------------------------------------------------

    PUBSUB_REDIS_CLUSTERS: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_CLUSTERS", "PUBSUB_REDIS_CLUSTERS"),
        description="Comma-separated 'host:port' list of Cluster nodes for the Event Bus.",
        default=None,
    )

    # ------------------------------------------------------------------
    # Common credentials / SSL (used by all three structured modes)
    # ------------------------------------------------------------------

    PUBSUB_REDIS_USERNAME: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_USERNAME", "PUBSUB_REDIS_USERNAME"),
        description="Event Bus Redis username (structured-mode credential; not inherited from main).",
        default=None,
    )
    PUBSUB_REDIS_PASSWORD: str | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_PASSWORD", "PUBSUB_REDIS_PASSWORD"),
        description="Event Bus Redis password (structured-mode credential; not inherited from main).",
        default=None,
    )
    PUBSUB_REDIS_USE_SSL: bool | None = Field(
        validation_alias=AliasChoices("EVENT_BUS_REDIS_USE_SSL", "PUBSUB_REDIS_USE_SSL"),
        description="Enable SSL/TLS for the Event Bus connection (structured-mode only).",
        default=None,
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
