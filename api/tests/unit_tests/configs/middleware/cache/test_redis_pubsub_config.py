"""Unit tests for the default pubsub URL builder in RedisPubSubConfig.

The tests drive ``RedisPubSubConfig._build_default_pubsub_url`` through a
duck-typed stand-in for the full pydantic-settings config so each branch
(standalone, cluster, error cases) can be exercised in isolation.
"""

from types import SimpleNamespace
from typing import cast

import pytest

from configs.middleware.cache.redis_pubsub_config import RedisPubSubConfig


def _make_config(**overrides: object) -> RedisPubSubConfig:
    """Return a RedisPubSubConfig wired to a stub that carries the Redis envs."""
    defaults: dict[str, object] = {
        "REDIS_HOST": "",
        "REDIS_PORT": 0,
        "REDIS_USERNAME": None,
        "REDIS_PASSWORD": None,
        "REDIS_DB": 0,
        "REDIS_USE_SSL": False,
        "REDIS_USE_SENTINEL": False,
        "REDIS_USE_CLUSTERS": False,
        "REDIS_CLUSTERS": None,
        "REDIS_CLUSTERS_PASSWORD": None,
    }
    defaults.update(overrides)
    # RedisPubSubConfig reads the Redis fields by casting ``self`` to
    # RedisConfigDefaults; attaching them to the instance via SimpleNamespace
    # plumbing would shadow the pydantic fields, so we build a bare instance
    # and bolt the attributes on directly.
    cfg = RedisPubSubConfig()
    for key, value in defaults.items():
        object.__setattr__(cfg, key, value)
    return cfg


class TestStandaloneURL:
    def test_builds_default_url_from_host_and_port(self) -> None:
        cfg = _make_config(
            REDIS_HOST="redis.example.com",
            REDIS_PORT=6379,
            REDIS_DB=2,
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://redis.example.com:6379/2"

    def test_encodes_userinfo(self) -> None:
        cfg = _make_config(
            REDIS_HOST="r.example",
            REDIS_PORT=6379,
            REDIS_USERNAME="user name",
            REDIS_PASSWORD="p@ss:word/",
            REDIS_DB=0,
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://user+name:p%40ss%3Aword%2F@r.example:6379/0"

    def test_ssl_switches_scheme_to_rediss(self) -> None:
        cfg = _make_config(
            REDIS_HOST="r.example",
            REDIS_PORT=6379,
            REDIS_USE_SSL=True,
        )

        url = cfg._build_default_pubsub_url()

        assert url.startswith("rediss://")

    def test_raises_when_host_and_cluster_both_empty(self) -> None:
        cfg = _make_config()

        with pytest.raises(ValueError, match="PUBSUB_REDIS_URL must be set"):
            cfg._build_default_pubsub_url()

    def test_db_zero_still_included_in_path_component(self) -> None:
        # REDIS_DB=0 is the common default; verify the URL path is "/0" and
        # not an empty path or bare host:port. urlunparse has path-vs-empty
        # quirks; this guards against an accidental regression there.
        cfg = _make_config(
            REDIS_HOST="r.example",
            REDIS_PORT=6379,
            REDIS_DB=0,
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://r.example:6379/0"


class TestClusterURL:
    def test_builds_seed_url_from_first_cluster_node(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001,node2:7002,node3:7003",
        )

        url = cfg._build_default_pubsub_url()

        # No /db path component, matching Redis Cluster's single-DB semantics.
        assert url == "redis://node1:7001"

    def test_cluster_respects_dedicated_password(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
            REDIS_PASSWORD="main-pw",
            REDIS_CLUSTERS_PASSWORD="cluster-pw",
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://:cluster-pw@node1:7001"

    def test_cluster_falls_back_to_redis_password_when_cluster_password_missing(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
            REDIS_PASSWORD="main-pw",
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://:main-pw@node1:7001"

    def test_cluster_tolerates_whitespace_and_skips_blank_entries(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS=" , node1:7001 , node2:7002",
        )

        url = cfg._build_default_pubsub_url()

        assert url == "redis://node1:7001"

    def test_cluster_with_ssl(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
            REDIS_USE_SSL=True,
        )

        url = cfg._build_default_pubsub_url()

        assert url.startswith("rediss://")

    def test_cluster_unset_nodes_raises(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS=None,
        )

        with pytest.raises(ValueError, match="REDIS_CLUSTERS is unset"):
            cfg._build_default_pubsub_url()

    def test_cluster_blank_string_raises(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="   ,   ",
        )

        with pytest.raises(ValueError, match="no valid host:port entries"):
            cfg._build_default_pubsub_url()

    def test_cluster_malformed_entry_raises(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="host-without-port",
        )

        with pytest.raises(ValueError, match="position 1.*malformed"):
            cfg._build_default_pubsub_url()

    def test_cluster_malformed_entry_reports_position_not_raw_value(self) -> None:
        # A misuser pasting a DSN with credentials into REDIS_CLUSTERS would
        # leak the password if the error echoed the raw entry. The error must
        # reference the position instead so startup logs stay clean. The
        # malformed entry must be the first non-empty one — the parser
        # returns on the first valid host:port, so only leading malformed
        # entries reach the error path.
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="super-secret-password@lonely-host,good-node:7001",
        )

        with pytest.raises(ValueError) as exc_info:
            cfg._build_default_pubsub_url()

        message = str(exc_info.value)
        assert "position 1" in message
        assert "super-secret-password" not in message

    def test_cluster_malformed_entry_skips_blank_leading_segments(self) -> None:
        # The 1-based position counts every comma-separated segment, including
        # blank ones. "  ,bad@entry,good:7001" reports position 2 because the
        # blank leading segment is position 1 (skipped, not errored on).
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="  ,password-leak@host,good:7001",
        )

        with pytest.raises(ValueError) as exc_info:
            cfg._build_default_pubsub_url()

        message = str(exc_info.value)
        assert "position 2" in message
        assert "password-leak" not in message

    def test_cluster_ignores_legacy_redis_host(self) -> None:
        # Operator migrating from standalone to cluster forgot to clear
        # REDIS_HOST. Cluster branch takes precedence; REDIS_HOST is ignored.
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
            REDIS_HOST="legacy.example",
            REDIS_PORT=6379,
        )

        assert cfg._build_default_pubsub_url() == "redis://node1:7001"

    def test_cluster_with_sentinel_requires_explicit_pubsub_url(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_USE_SENTINEL=True,
            REDIS_CLUSTERS="node1:7001",
        )

        with pytest.raises(ValueError, match="PUBSUB_REDIS_URL must be set explicitly"):
            cfg._build_default_pubsub_url()


class TestSentinelURL:
    """Sentinel mode returns None so the Event Bus reuses the main Sentinel
    client — which already handles master discovery and failover. Encoding
    Sentinel topology into a single seed URL would lose failover."""

    def test_sentinel_mode_returns_none_so_main_client_is_reused(self) -> None:
        cfg = _make_config(REDIS_USE_SENTINEL=True)

        assert cfg._build_default_pubsub_url() is None

    def test_sentinel_mode_ignores_incidental_redis_host(self) -> None:
        # Helm Chart renders REDIS_HOST unconditionally even in Sentinel mode
        # (it may point at the Sentinel service or a placeholder). The Sentinel
        # early-return must NOT fall through to the standalone URL builder,
        # which would silently construct a URL pointing at the Sentinel
        # address as if it were a plain Redis.
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_HOST="sentinel-master-placeholder",
            REDIS_PORT=26379,
        )

        assert cfg._build_default_pubsub_url() is None

    def test_sentinel_mode_ignores_ssl_flag(self) -> None:
        # SSL is a property of the real connection, which is resolved via the
        # main Sentinel client — not via a pubsub URL. Sentinel branch still
        # returns None regardless of useSSL.
        cfg = _make_config(REDIS_USE_SENTINEL=True, REDIS_USE_SSL=True)

        assert cfg._build_default_pubsub_url() is None

    def test_normalized_returns_none_in_sentinel_mode(self) -> None:
        cfg = _make_config(REDIS_USE_SENTINEL=True)

        assert cfg.normalized_pubsub_redis_url is None


class TestNormalizedPubSubURL:
    def test_explicit_pubsub_url_wins_over_mode_flags(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
        )
        # PUBSUB_REDIS_URL is a real pydantic field on RedisPubSubConfig, so
        # cast through the attribute setter.
        object.__setattr__(cfg, "PUBSUB_REDIS_URL", "redis://override.example:6379/0")

        assert cfg.normalized_pubsub_redis_url == "redis://override.example:6379/0"

    def test_empty_explicit_pubsub_url_falls_back_to_default_builder(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="node1:7001",
        )
        object.__setattr__(cfg, "PUBSUB_REDIS_URL", "   ")

        assert cast(str, cfg.normalized_pubsub_redis_url) == "redis://node1:7001"

    def test_whitespace_wrapped_explicit_pubsub_url_is_stripped(self) -> None:
        # A valid URL that happens to carry incidental leading / trailing
        # whitespace (YAML quoting slip, etc.) must be returned as the
        # cleaned URL, not cause a fallback to the default builder.
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="cluster-seed:7001",  # would "win" if stripping failed
        )
        object.__setattr__(cfg, "PUBSUB_REDIS_URL", "  redis://override.example:6379/0  ")

        assert cfg.normalized_pubsub_redis_url == "redis://override.example:6379/0"
