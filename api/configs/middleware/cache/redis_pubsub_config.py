from typing import Literal, Protocol, cast
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
    # Sentinel mode — the main Redis client uses Sentinel topology. The pubsub
    # URL builder can't encode Sentinel into a single seed URL, so Sentinel
    # combined with Cluster is rejected unless PUBSUB_REDIS_URL is explicit.
    REDIS_USE_SENTINEL: bool | None
    # Cluster mode — when REDIS_USE_CLUSTERS is True the default pubsub URL
    # is built from the first entry in REDIS_CLUSTERS instead of REDIS_HOST.
    REDIS_USE_CLUSTERS: bool
    REDIS_CLUSTERS: str | None
    REDIS_CLUSTERS_PASSWORD: str | None


def _redis_defaults(config: object) -> RedisConfigDefaults:
    return cast(RedisConfigDefaults, config)


class RedisPubSubConfig(BaseSettings):
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
        validation_alias=AliasChoices("EVENT_BUS_REDIS_USE_CLUSTERS", "PUBSUB_REDIS_USE_CLUSTERS"),
        description=(
            "Enable Redis Cluster mode for the Event Bus (pub/sub / streams) transport. "
            "Advanced option: only turn this on when the Event Bus traffic is the bottleneck "
            "and you want horizontal fan-out across multiple Redis nodes. Most deployments "
            "should leave this False and let the Event Bus reuse the main Sentinel / standalone "
            "Redis client. "
            "Also accepts ENV: EVENT_BUS_REDIS_USE_CLUSTERS."
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

    def _build_default_pubsub_url(self) -> str | None:
        """Build the default Event Bus Redis URL from REDIS_* config.

        Returns None to signal that the Event Bus client should reuse the main
        Redis client (the caller in ``ext_redis.init_app`` already initialises
        ``_pubsub_redis_client = client`` before consulting this URL, and only
        overrides it when a non-empty URL is returned).

        - Sentinel mode (without Cluster): returns None. The main Redis client
          is a Sentinel ``master_for`` handle that already does master discovery
          and automatic failover, so the Event Bus gets HA for free by reusing
          it. Encoding Sentinel topology into a single seed URL would lose that
          failover.
        - Cluster mode (without Sentinel): builds a seed URL from the first
          ``REDIS_CLUSTERS`` node; ``RedisCluster.from_url`` uses it only for
          bootstrap discovery and then talks to every shard directly.
        - Sentinel + Cluster both enabled: ambiguous — raises so the operator
          must set PUBSUB_REDIS_URL explicitly.
        - Standalone fallback: builds a URL from REDIS_HOST / REDIS_PORT.
        """
        defaults = _redis_defaults(self)
        scheme = "rediss" if defaults.REDIS_USE_SSL else "redis"
        username = defaults.REDIS_USERNAME or None

        # Sentinel-only: let the caller reuse the main Sentinel client.
        # Important: Helm renders REDIS_HOST unconditionally (to the Sentinel
        # service host or a placeholder), so without this early return the
        # standalone fallback below would silently build a URL pointing at a
        # Sentinel-address-treated-as-Redis — which either fails or talks to
        # the wrong backend. Returning None is the deliberate "no default URL
        # needed; the main client already handles Sentinel" signal.
        if defaults.REDIS_USE_SENTINEL and not defaults.REDIS_USE_CLUSTERS:
            return None

        # Cluster mode: the address list lives in REDIS_CLUSTERS, not REDIS_HOST.
        # We pick the first node as a seed; RedisCluster.from_url uses it only
        # for bootstrap discovery and then talks to every shard directly.
        if defaults.REDIS_USE_CLUSTERS:
            # The main Redis client routes Sentinel before Cluster in
            # ext_redis.init_app, so if both flags are on the pubsub client
            # would silently talk to a different backend than the main client.
            # Force the operator to set PUBSUB_REDIS_URL explicitly instead.
            if defaults.REDIS_USE_SENTINEL:
                raise ValueError(
                    "REDIS_USE_SENTINEL and REDIS_USE_CLUSTERS are both enabled; "
                    "PUBSUB_REDIS_URL must be set explicitly because the default "
                    "builder cannot pick a single backend for pubsub."
                )
            host, port = self._first_cluster_node(defaults.REDIS_CLUSTERS)
            password = defaults.REDIS_CLUSTERS_PASSWORD or defaults.REDIS_PASSWORD or None
            netloc = self._format_netloc(username, password, host, port)
            # Redis Cluster disables SELECT DB, so no "/<db>" path component.
            return urlunparse((scheme, netloc, "", "", "", ""))

        if not defaults.REDIS_HOST or not defaults.REDIS_PORT:
            raise ValueError("PUBSUB_REDIS_URL must be set when default Redis URL cannot be constructed")

        password = defaults.REDIS_PASSWORD or None
        netloc = self._format_netloc(username, password, defaults.REDIS_HOST, defaults.REDIS_PORT)
        return urlunparse((scheme, netloc, f"/{defaults.REDIS_DB}", "", "", ""))

    @staticmethod
    def _first_cluster_node(clusters: str | None) -> tuple[str, int]:
        if not clusters:
            raise ValueError("REDIS_USE_CLUSTERS is true but REDIS_CLUSTERS is unset")
        # IPv6 addresses must use bracketed form (e.g. "[fe80::1]:7001"); the
        # rpartition(":") below is ambiguous for bare-colon IPv6 literals.
        for index, raw in enumerate(clusters.split(","), start=1):
            node = raw.strip()
            if not node:
                continue
            host, sep, port_str = node.rpartition(":")
            if not sep or not host or not port_str.isdigit():
                # Deliberately do not echo the raw entry — an operator who
                # misused REDIS_CLUSTERS by pasting a full DSN like
                # "pw@host" would leak the password into startup logs. The
                # 1-based position is enough to locate the offending entry.
                raise ValueError(
                    f"REDIS_CLUSTERS entry at position {index} is malformed; "
                    "expected 'host:port' format"
                )
            return host, int(port_str)
        # REDIS_CLUSTERS was set but contained only whitespace / empty segments
        # (e.g. "   ,   "). Distinct from the unset case so operators can tell
        # which env var they need to fix.
        raise ValueError("REDIS_CLUSTERS contains no valid host:port entries")

    @staticmethod
    def _format_netloc(username: str | None, password: str | None, host: str, port: int) -> str:
        userinfo = ""
        if username:
            userinfo = quote_plus(username)
        if password:
            password_part = quote_plus(password)
            userinfo = f"{userinfo}:{password_part}" if userinfo else f":{password_part}"
        if userinfo:
            userinfo = f"{userinfo}@"
        return f"{userinfo}{host}:{port}"

    @property
    def normalized_pubsub_redis_url(self) -> str | None:
        """Resolve the Event Bus Redis URL.

        Returns None when the Event Bus should reuse the main Redis client
        (no explicit ``PUBSUB_REDIS_URL`` override AND the main client mode is
        Sentinel). Callers are expected to treat ``None`` / empty as "no
        standalone pubsub client needed" and fall back to the main client.
        """
        pubsub_redis_url = self.PUBSUB_REDIS_URL
        if pubsub_redis_url:
            cleaned = pubsub_redis_url.strip()
            pubsub_redis_url = cleaned or None

        if pubsub_redis_url:
            return pubsub_redis_url

        return self._build_default_pubsub_url()
