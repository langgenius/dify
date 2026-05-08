"""Unit tests for RedisConnectionSpec.

The spec replaces URL strings as the connection contract for both the main
Redis client and the Event Bus pub/sub client, so it must:

- validate mode-specific required fields at construction time (standalone
  needs host/port; sentinel needs nodes + service_name; cluster needs nodes)
- mask credentials in its __repr__ so startup logs / exception tracebacks
  cannot surface passwords
- be immutable and hashable so callers can compare specs with ``==`` to
  detect "pub/sub spec equals main spec → reuse main client"
"""

from dataclasses import FrozenInstanceError

import pytest

from configs.middleware.cache.redis_connection_spec import RedisConnectionSpec


class TestStandaloneSpec:
    def test_happy_path(self) -> None:
        spec = RedisConnectionSpec(
            mode="standalone",
            host="redis.example.com",
            port=6379,
            password="secret",
            db=3,
        )

        assert spec.mode == "standalone"
        assert spec.host == "redis.example.com"
        assert spec.port == 6379
        assert spec.db == 3

    def test_requires_host(self) -> None:
        with pytest.raises(ValueError, match="host"):
            RedisConnectionSpec(mode="standalone", port=6379)

    def test_requires_port(self) -> None:
        with pytest.raises(ValueError, match="port"):
            RedisConnectionSpec(mode="standalone", host="r.example")


class TestSentinelSpec:
    def test_happy_path(self) -> None:
        spec = RedisConnectionSpec(
            mode="sentinel",
            sentinel_nodes=(("s1", 26379), ("s2", 26379), ("s3", 26379)),
            sentinel_service_name="mymaster",
            sentinel_password="sentinel-pw",
            password="redis-pw",
        )

        assert spec.mode == "sentinel"
        assert len(spec.sentinel_nodes) == 3
        assert spec.sentinel_service_name == "mymaster"

    def test_requires_sentinel_nodes(self) -> None:
        with pytest.raises(ValueError, match="sentinel_nodes"):
            RedisConnectionSpec(
                mode="sentinel",
                sentinel_service_name="mymaster",
            )

    def test_requires_service_name(self) -> None:
        with pytest.raises(ValueError, match="sentinel_service_name"):
            RedisConnectionSpec(
                mode="sentinel",
                sentinel_nodes=(("s1", 26379),),
            )


class TestClusterSpec:
    def test_happy_path(self) -> None:
        spec = RedisConnectionSpec(
            mode="cluster",
            cluster_nodes=(("n1", 7001), ("n2", 7002)),
            password="cluster-pw",
        )

        assert spec.mode == "cluster"
        assert len(spec.cluster_nodes) == 2

    def test_requires_cluster_nodes(self) -> None:
        with pytest.raises(ValueError, match="cluster_nodes"):
            RedisConnectionSpec(mode="cluster")


class TestInvalidMode:
    def test_unknown_mode_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown mode"):
            # type: ignore[arg-type] — deliberately passing invalid mode
            RedisConnectionSpec(mode="foo", host="x", port=1)  # type: ignore[arg-type]


class TestReprSecurity:
    def test_repr_masks_password(self) -> None:
        spec = RedisConnectionSpec(
            mode="standalone",
            host="r.example",
            port=6379,
            password="super-secret-do-not-leak",
        )

        text = repr(spec)

        assert "super-secret-do-not-leak" not in text
        assert "***" in text

    def test_repr_masks_sentinel_password(self) -> None:
        spec = RedisConnectionSpec(
            mode="sentinel",
            sentinel_nodes=(("s1", 26379),),
            sentinel_service_name="mymaster",
            sentinel_password="sentinel-secret-do-not-leak",
        )

        text = repr(spec)

        assert "sentinel-secret-do-not-leak" not in text

    def test_repr_shows_none_for_unset_password(self) -> None:
        spec = RedisConnectionSpec(
            mode="standalone",
            host="r.example",
            port=6379,
        )

        text = repr(spec)

        assert "password=None" in text

    def test_repr_does_not_mask_non_secret_fields(self) -> None:
        # Topology fields (host, port, service name) must remain visible —
        # they are essential for debugging startup misconfigurations.
        spec = RedisConnectionSpec(
            mode="sentinel",
            sentinel_nodes=(("s1", 26379),),
            sentinel_service_name="mymaster",
            sentinel_password="leak",
        )

        text = repr(spec)

        assert "s1" in text
        assert "26379" in text
        assert "mymaster" in text


class TestStrForLogs:
    def test_str_standalone(self) -> None:
        spec = RedisConnectionSpec(
            mode="standalone",
            host="r.example",
            port=6379,
            db=2,
            password="leak",
        )

        text = str(spec)

        assert "standalone" in text
        assert "r.example" in text
        assert "6379" in text
        assert "db=2" in text
        assert "leak" not in text

    def test_str_sentinel_shows_service_and_first_nodes(self) -> None:
        spec = RedisConnectionSpec(
            mode="sentinel",
            sentinel_nodes=(("s1", 26379), ("s2", 26379)),
            sentinel_service_name="mymaster",
            sentinel_password="leak",
        )

        text = str(spec)

        assert "sentinel" in text
        assert "mymaster" in text
        assert "s1:26379" in text
        assert "leak" not in text

    def test_str_cluster_truncates_long_node_list(self) -> None:
        nodes = tuple((f"n{i}", 7000 + i) for i in range(10))
        spec = RedisConnectionSpec(mode="cluster", cluster_nodes=nodes)

        text = str(spec)

        assert "cluster" in text
        # First 3 nodes present
        assert "n0:7000" in text
        assert "n2:7002" in text
        # Later nodes truncated with ellipsis
        assert "n9:7009" not in text
        assert "..." in text


class TestImmutability:
    def test_spec_is_frozen(self) -> None:
        spec = RedisConnectionSpec(mode="standalone", host="r", port=6379)

        with pytest.raises(FrozenInstanceError):
            spec.host = "other"  # type: ignore[misc]

    def test_spec_is_hashable(self) -> None:
        spec = RedisConnectionSpec(mode="standalone", host="r", port=6379)

        # Should not raise — required so callers can stash specs in sets /
        # dict keys or compare with is-identity-after-hash semantics.
        _ = hash(spec)
        _ = {spec}


class TestEquality:
    def test_same_fields_compare_equal(self) -> None:
        a = RedisConnectionSpec(mode="standalone", host="r", port=6379, db=1, password="pw")
        b = RedisConnectionSpec(mode="standalone", host="r", port=6379, db=1, password="pw")

        assert a == b

    def test_differing_fields_compare_unequal(self) -> None:
        a = RedisConnectionSpec(mode="standalone", host="r", port=6379, db=1)
        b = RedisConnectionSpec(mode="standalone", host="r", port=6379, db=2)

        assert a != b

    def test_different_modes_compare_unequal(self) -> None:
        a = RedisConnectionSpec(mode="standalone", host="r", port=6379)
        b = RedisConnectionSpec(
            mode="sentinel",
            sentinel_nodes=(("s1", 26379),),
            sentinel_service_name="mymaster",
        )

        assert a != b
