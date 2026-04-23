"""Unit tests for ``build_pubsub_spec``.

The pub/sub spec builder determines how the Event Bus client is constructed:

- **Default (``PUBSUB_REDIS_MODE`` unset)**: inherit ``main_spec`` as-is.
  This lets Dify reuse the main client object — essential for Sentinel,
  where the ``master_for`` handle already provides failover.
- **Explicit (``PUBSUB_REDIS_MODE`` set)**: construct a spec from the
  structured ``PUBSUB_REDIS_*`` field set. Supports all three topologies,
  including independent Sentinel — a capability the old URL contract
  could not express.
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


class TestInvalidMode:
    def test_unknown_pubsub_mode_raises(self) -> None:
        main = _main_standalone()
        cfg = _make_pubsub_config(PUBSUB_REDIS_MODE="foo")

        with pytest.raises(ValueError, match="Unknown"):
            build_pubsub_spec(main, cfg)
