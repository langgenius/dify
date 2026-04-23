"""Unit tests for ``build_pubsub_spec``.

The pub/sub spec builder determines how the Event Bus client is constructed:

- **Default (no pub/sub config set)**: inherit ``main_spec`` as-is. This
  lets Dify reuse the main client object, which is essential for Sentinel
  topology — the returned ``master_for`` handle already provides failover.
- **Backward-compat (``PUBSUB_REDIS_URL`` set)**: parse the URL into a
  standalone spec (or cluster when ``PUBSUB_REDIS_USE_CLUSTERS=True``).
  This path retains the pre-refactor URL-based escape hatch.
- **Explicit (``PUBSUB_REDIS_MODE`` set)**: construct a spec from the
  ``PUBSUB_REDIS_*`` field set. Supports all three topologies —
  including Sentinel, which the URL form could never express.

Priority: ``PUBSUB_REDIS_MODE > PUBSUB_REDIS_URL > inherit``.
"""

from types import SimpleNamespace
from typing import Any

import pytest

from configs.middleware.cache.redis_connection_spec import (
    RedisConnectionSpec,
    build_pubsub_spec,
)


def _main_standalone() -> RedisConnectionSpec:
    return RedisConnectionSpec(
        mode="standalone",
        host="main.example",
        port=6379,
        db=0,
        username="main-user",
        password="main-pw",
    )


def _main_sentinel() -> RedisConnectionSpec:
    return RedisConnectionSpec(
        mode="sentinel",
        sentinel_nodes=(("s1", 26379), ("s2", 26379)),
        sentinel_service_name="mymaster",
        sentinel_password="sentinel-pw",
        password="redis-pw",
    )


def _main_cluster() -> RedisConnectionSpec:
    return RedisConnectionSpec(
        mode="cluster",
        cluster_nodes=(("n1", 7001), ("n2", 7002)),
        password="cluster-pw",
    )


def _make_pubsub_config(**overrides: Any) -> SimpleNamespace:
    defaults: dict[str, Any] = {
        "PUBSUB_REDIS_MODE": None,
        "PUBSUB_REDIS_URL": None,
        "PUBSUB_REDIS_USE_CLUSTERS": False,
        "PUBSUB_REDIS_HOST": None,
        "PUBSUB_REDIS_PORT": None,
        "PUBSUB_REDIS_DB": None,
        "PUBSUB_REDIS_SENTINELS": None,
        "PUBSUB_REDIS_SENTINEL_SERVICE_NAME": None,
        "PUBSUB_REDIS_SENTINEL_USERNAME": None,
        "PUBSUB_REDIS_SENTINEL_PASSWORD": None,
        "PUBSUB_REDIS_SENTINEL_SOCKET_TIMEOUT": None,
        "PUBSUB_REDIS_CLUSTERS": None,
        "PUBSUB_REDIS_USERNAME": None,
        "PUBSUB_REDIS_PASSWORD": None,
        "PUBSUB_REDIS_USE_SSL": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestDefaultInheritance:
    """No pub/sub config set → full spec inheritance from main."""

    def test_inherits_standalone_main(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config()

        spec = build_pubsub_spec(main, cfg)

        assert spec == main

    def test_inherits_sentinel_main(self) -> None:
        # This is the key case that the URL-based contract couldn't handle
        # before the refactor — pub/sub inherits a Sentinel spec so the
        # caller can compare "pubsub_spec == main_spec" and reuse the
        # failover-aware master_for handle.
        main = _main_sentinel()
        cfg = _make_pubsub_config()

        spec = build_pubsub_spec(main, cfg)

        assert spec == main
        assert spec.mode == "sentinel"

    def test_inherits_cluster_main(self) -> None:
        main = _main_cluster()
        cfg = _make_pubsub_config()

        spec = build_pubsub_spec(main, cfg)

        assert spec == main

    def test_whitespace_only_url_is_treated_as_unset(self) -> None:
        main = _main_sentinel()
        cfg = _make_pubsub_config(PUBSUB_REDIS_URL="   ")

        spec = build_pubsub_spec(main, cfg)

        assert spec == main


class TestBackwardCompatURL:
    """PUBSUB_REDIS_URL (legacy) should still work for standalone and cluster."""

    def test_standalone_url(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_URL="redis://bus-user:bus-pw@bus.example:6380/3",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "standalone"
        assert spec.host == "bus.example"
        assert spec.port == 6380
        assert spec.db == 3
        assert spec.username == "bus-user"
        assert spec.password == "bus-pw"
        assert spec.use_ssl is False

    def test_rediss_url_enables_ssl(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_URL="rediss://bus.example:6380/0",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.use_ssl is True

    def test_cluster_url_with_use_clusters_flag(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_URL="redis://:pw@n1:7001,n2:7002,n3:7003",
            PUBSUB_REDIS_USE_CLUSTERS=True,
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "cluster"
        assert spec.cluster_nodes == (("n1", 7001), ("n2", 7002), ("n3", 7003))
        assert spec.password == "pw"

    def test_url_with_no_db_path_defaults_to_zero(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(PUBSUB_REDIS_URL="redis://bus.example:6380")

        spec = build_pubsub_spec(main, cfg)

        assert spec.db == 0

    def test_url_strips_whitespace(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_URL="   redis://bus.example:6380   ",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "standalone"
        assert spec.host == "bus.example"


class TestExplicitStandaloneMode:
    def test_builds_standalone_from_fields(self) -> None:
        main = _main_sentinel()  # main is sentinel but pubsub explicitly overrides
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="standalone",
            PUBSUB_REDIS_HOST="bus.example",
            PUBSUB_REDIS_PORT=6380,
            PUBSUB_REDIS_DB=2,
            PUBSUB_REDIS_PASSWORD="bus-pw",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "standalone"
        assert spec.host == "bus.example"
        assert spec.port == 6380
        assert spec.db == 2
        assert spec.password == "bus-pw"

    def test_standalone_requires_host(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="standalone",
            PUBSUB_REDIS_PORT=6380,
        )

        with pytest.raises(ValueError, match="PUBSUB_REDIS_HOST"):
            build_pubsub_spec(main, cfg)


class TestExplicitSentinelMode:
    """The headline capability unlocked by the refactor — pub/sub can
    now declare its own Sentinel topology, which was impossible under
    the URL contract."""

    def test_builds_sentinel_from_fields(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="sentinel",
            PUBSUB_REDIS_SENTINELS="ps1:26379,ps2:26379",
            PUBSUB_REDIS_SENTINEL_SERVICE_NAME="pubsub-master",
            PUBSUB_REDIS_SENTINEL_PASSWORD="ps-pw",
            PUBSUB_REDIS_PASSWORD="bus-pw",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "sentinel"
        assert spec.sentinel_nodes == (("ps1", 26379), ("ps2", 26379))
        assert spec.sentinel_service_name == "pubsub-master"
        assert spec.sentinel_password == "ps-pw"
        assert spec.password == "bus-pw"

    def test_sentinel_requires_sentinels_env(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="sentinel",
            PUBSUB_REDIS_SENTINEL_SERVICE_NAME="pubsub-master",
        )

        with pytest.raises(ValueError, match="PUBSUB_REDIS_SENTINELS"):
            build_pubsub_spec(main, cfg)

    def test_sentinel_requires_service_name(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="sentinel",
            PUBSUB_REDIS_SENTINELS="ps1:26379",
        )

        with pytest.raises(ValueError, match="PUBSUB_REDIS_SENTINEL_SERVICE_NAME"):
            build_pubsub_spec(main, cfg)


class TestExplicitClusterMode:
    def test_builds_cluster_from_fields(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="cluster",
            PUBSUB_REDIS_CLUSTERS="n1:7001,n2:7002",
            PUBSUB_REDIS_PASSWORD="cluster-pw",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "cluster"
        assert spec.cluster_nodes == (("n1", 7001), ("n2", 7002))
        assert spec.password == "cluster-pw"

    def test_cluster_requires_clusters_env(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(PUBSUB_REDIS_MODE="cluster")

        with pytest.raises(ValueError, match="PUBSUB_REDIS_CLUSTERS"):
            build_pubsub_spec(main, cfg)


class TestPriority:
    def test_explicit_mode_wins_over_url(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_MODE="sentinel",
            PUBSUB_REDIS_SENTINELS="ps1:26379",
            PUBSUB_REDIS_SENTINEL_SERVICE_NAME="pubsub-master",
            # URL is set but should be ignored
            PUBSUB_REDIS_URL="redis://legacy.example:6379/0",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "sentinel"

    def test_url_wins_over_inheritance(self) -> None:
        main = _main_sentinel()  # main is sentinel
        cfg = _make_pubsub_config(
            PUBSUB_REDIS_URL="redis://legacy.example:6379/0",
        )

        spec = build_pubsub_spec(main, cfg)

        assert spec.mode == "standalone"  # URL took precedence, not inheritance
        assert spec.host == "legacy.example"


class TestInvalidMode:
    def test_unknown_pubsub_mode_raises(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(PUBSUB_REDIS_MODE="foo")

        with pytest.raises(ValueError, match="Unknown"):
            build_pubsub_spec(main, cfg)
