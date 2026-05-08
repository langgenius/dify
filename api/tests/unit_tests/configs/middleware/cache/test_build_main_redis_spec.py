"""Unit tests for ``build_main_redis_spec``.

The builder translates the flat ``REDIS_*`` env fields into a mode-specific
``RedisConnectionSpec``. It must:

- pick ``mode`` from ``REDIS_USE_SENTINEL`` / ``REDIS_USE_CLUSTERS`` flags
- reject the invalid "sentinel + cluster both enabled" combination at the
  config layer (so it never reaches the client construction path)
- propagate SSL fields uniformly across modes
- respect the ``REDIS_CLUSTERS_PASSWORD`` > ``REDIS_PASSWORD`` precedence
- report the 1-based position (never the raw content) for malformed
  ``REDIS_SENTINELS`` / ``REDIS_CLUSTERS`` entries, so a password
  accidentally pasted there never leaks into startup logs
"""

from types import SimpleNamespace
from typing import Any

import pytest

from configs.middleware.cache.redis_connection_spec import (
    RedisConnectionSpec,
    build_main_redis_spec,
)


def _make_config(**overrides: Any) -> SimpleNamespace:
    """Build a duck-typed stand-in for the real RedisConfig.

    The builder reads the env via a Protocol, so a SimpleNamespace with
    the right attribute set behaves identically for tests.
    """
    defaults: dict[str, Any] = {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": 6379,
        "REDIS_USERNAME": None,
        "REDIS_PASSWORD": None,
        "REDIS_DB": 0,
        "REDIS_USE_SSL": False,
        "REDIS_SSL_CERT_REQS": "CERT_NONE",
        "REDIS_SSL_CA_CERTS": None,
        "REDIS_SSL_CERTFILE": None,
        "REDIS_SSL_KEYFILE": None,
        "REDIS_USE_SENTINEL": False,
        "REDIS_SENTINELS": None,
        "REDIS_SENTINEL_SERVICE_NAME": None,
        "REDIS_SENTINEL_USERNAME": None,
        "REDIS_SENTINEL_PASSWORD": None,
        "REDIS_SENTINEL_SOCKET_TIMEOUT": 0.1,
        "REDIS_USE_CLUSTERS": False,
        "REDIS_CLUSTERS": None,
        "REDIS_CLUSTERS_PASSWORD": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestStandaloneMode:
    def test_default_builds_standalone_spec(self) -> None:
        cfg = _make_config(
            REDIS_HOST="redis.example",
            REDIS_PORT=6379,
            REDIS_PASSWORD="pw",
            REDIS_DB=2,
        )

        spec = build_main_redis_spec(cfg)

        assert spec.mode == "standalone"
        assert spec.host == "redis.example"
        assert spec.port == 6379
        assert spec.password == "pw"
        assert spec.db == 2

    def test_empty_password_is_normalised_to_none(self) -> None:
        cfg = _make_config(REDIS_PASSWORD="")

        spec = build_main_redis_spec(cfg)

        assert spec.password is None


class TestSentinelMode:
    def test_builds_sentinel_spec_with_parsed_nodes(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS="s1:26379,s2:26379,s3:26379",
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
            REDIS_SENTINEL_PASSWORD="sp",
        )

        spec = build_main_redis_spec(cfg)

        assert spec.mode == "sentinel"
        assert spec.sentinel_nodes == (("s1", 26379), ("s2", 26379), ("s3", 26379))
        assert spec.sentinel_service_name == "mymaster"
        assert spec.sentinel_password == "sp"

    def test_sentinel_mode_requires_sentinels_env(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS=None,
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
        )

        with pytest.raises(ValueError, match="REDIS_SENTINELS"):
            build_main_redis_spec(cfg)

    def test_sentinel_mode_requires_service_name(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS="s1:26379",
            REDIS_SENTINEL_SERVICE_NAME=None,
        )

        with pytest.raises(ValueError, match="REDIS_SENTINEL_SERVICE_NAME"):
            build_main_redis_spec(cfg)

    def test_sentinel_nodes_tolerate_whitespace(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS=" s1:26379 , s2:26379 ",
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
        )

        spec = build_main_redis_spec(cfg)

        assert spec.sentinel_nodes == (("s1", 26379), ("s2", 26379))

    def test_malformed_sentinels_entry_reports_position_not_content(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS="leaked-password@host,s2:26379",
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
        )

        with pytest.raises(ValueError) as exc:
            build_main_redis_spec(cfg)

        msg = str(exc.value)
        assert "position 1" in msg
        assert "leaked-password" not in msg


class TestClusterMode:
    def test_builds_cluster_spec_with_parsed_nodes(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="n1:7001,n2:7002,n3:7003",
        )

        spec = build_main_redis_spec(cfg)

        assert spec.mode == "cluster"
        assert spec.cluster_nodes == (("n1", 7001), ("n2", 7002), ("n3", 7003))

    def test_cluster_requires_clusters_env(self) -> None:
        cfg = _make_config(REDIS_USE_CLUSTERS=True, REDIS_CLUSTERS=None)

        with pytest.raises(ValueError, match="REDIS_CLUSTERS"):
            build_main_redis_spec(cfg)

    def test_cluster_password_takes_precedence(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="n1:7001",
            REDIS_PASSWORD="main-pw",
            REDIS_CLUSTERS_PASSWORD="cluster-pw",
        )

        spec = build_main_redis_spec(cfg)

        assert spec.password == "cluster-pw"

    def test_cluster_falls_back_to_redis_password(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="n1:7001",
            REDIS_PASSWORD="main-pw",
            REDIS_CLUSTERS_PASSWORD=None,
        )

        spec = build_main_redis_spec(cfg)

        assert spec.password == "main-pw"

    def test_malformed_clusters_entry_reports_position_not_content(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="super-secret-pw@lonely-host,good:7001",
        )

        with pytest.raises(ValueError) as exc:
            build_main_redis_spec(cfg)

        msg = str(exc.value)
        assert "position 1" in msg
        assert "super-secret-pw" not in msg


class TestCrossValidation:
    def test_rejects_sentinel_and_cluster_both_enabled(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_USE_CLUSTERS=True,
            REDIS_SENTINELS="s1:26379",
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
            REDIS_CLUSTERS="n1:7001",
        )

        with pytest.raises(ValueError, match="both enabled"):
            build_main_redis_spec(cfg)


class TestSSLPropagation:
    def test_ssl_fields_propagate_to_standalone(self) -> None:
        cfg = _make_config(
            REDIS_USE_SSL=True,
            REDIS_SSL_CERT_REQS="CERT_REQUIRED",
            REDIS_SSL_CA_CERTS="/etc/ca.pem",
            REDIS_SSL_CERTFILE="/etc/cert.pem",
            REDIS_SSL_KEYFILE="/etc/key.pem",
        )

        spec = build_main_redis_spec(cfg)

        assert spec.use_ssl is True
        assert spec.ssl_cert_reqs == "CERT_REQUIRED"
        assert spec.ssl_ca_certs == "/etc/ca.pem"
        assert spec.ssl_certfile == "/etc/cert.pem"
        assert spec.ssl_keyfile == "/etc/key.pem"

    def test_ssl_fields_propagate_to_sentinel(self) -> None:
        cfg = _make_config(
            REDIS_USE_SENTINEL=True,
            REDIS_SENTINELS="s1:26379",
            REDIS_SENTINEL_SERVICE_NAME="mymaster",
            REDIS_USE_SSL=True,
        )

        spec = build_main_redis_spec(cfg)

        assert spec.use_ssl is True

    def test_ssl_fields_propagate_to_cluster(self) -> None:
        cfg = _make_config(
            REDIS_USE_CLUSTERS=True,
            REDIS_CLUSTERS="n1:7001",
            REDIS_USE_SSL=True,
        )

        spec = build_main_redis_spec(cfg)

        assert spec.use_ssl is True


class TestReturnType:
    def test_result_is_frozen_spec(self) -> None:
        cfg = _make_config()

        spec = build_main_redis_spec(cfg)

        assert isinstance(spec, RedisConnectionSpec)
