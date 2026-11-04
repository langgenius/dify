import pytest
import redis
from redis.cluster import RedisCluster

from configs import dify_config
from dify_app import DifyApp
from extensions import ext_redis


def _initialize_redis(
    monkeypatch: pytest.MonkeyPatch,
    *,
    use_sentinel: bool,
    pubsub_redis_url: str | None,
    pubsub_uses_clusters: bool = False,
    redis_host: str = "default-redis.example",
) -> tuple[DifyApp, redis.Redis | RedisCluster, list[tuple[str, bool]]]:
    """Initialize Redis without network I/O and record dedicated PubSub client creation."""
    monkeypatch.setattr(dify_config, "REDIS_USE_SENTINEL", use_sentinel)
    monkeypatch.setattr(dify_config, "REDIS_USE_CLUSTERS", False)
    monkeypatch.setattr(dify_config, "REDIS_SENTINELS", "sentinel.example:26379")
    monkeypatch.setattr(dify_config, "REDIS_SENTINEL_SERVICE_NAME", "redis-primary")
    monkeypatch.setattr(dify_config, "REDIS_SENTINEL_USERNAME", None)
    monkeypatch.setattr(dify_config, "REDIS_SENTINEL_PASSWORD", None)
    monkeypatch.setattr(dify_config, "REDIS_HOST", redis_host)
    monkeypatch.setattr(dify_config, "REDIS_PORT", 6379)
    monkeypatch.setattr(dify_config, "REDIS_USERNAME", None)
    monkeypatch.setattr(dify_config, "REDIS_PASSWORD", None)
    monkeypatch.setattr(dify_config, "REDIS_DB", 0)
    monkeypatch.setattr(dify_config, "REDIS_USE_SSL", False)
    monkeypatch.setattr(dify_config, "REDIS_ENABLE_CLIENT_SIDE_CACHE", False)
    monkeypatch.setattr(dify_config, "REDIS_MAX_CONNECTIONS", None)
    monkeypatch.setattr(dify_config, "PUBSUB_REDIS_URL", pubsub_redis_url)
    monkeypatch.setattr(dify_config, "PUBSUB_REDIS_USE_CLUSTERS", pubsub_uses_clusters)

    wrapper = ext_redis.RedisClientWrapper()
    monkeypatch.setattr(ext_redis, "redis_client", wrapper)
    monkeypatch.setattr(ext_redis, "_pubsub_redis_client", None)

    pubsub_calls: list[tuple[str, bool]] = []

    def create_pubsub_client(pubsub_url: str, use_clusters: bool) -> redis.Redis:
        pubsub_calls.append((pubsub_url, use_clusters))
        return redis.Redis.from_url(pubsub_url)

    monkeypatch.setattr(ext_redis, "_create_pubsub_client", create_pubsub_client)

    app = DifyApp("test-ext-redis")
    ext_redis.init_app(app)

    return app, wrapper._require_client(), pubsub_calls


@pytest.mark.parametrize(
    ("use_sentinel", "configured_url", "expected_dedicated_url"),
    [
        pytest.param(True, None, None, id="sentinel-default"),
        pytest.param(True, "", None, id="sentinel-empty"),
        pytest.param(True, " \t ", None, id="sentinel-whitespace"),
        pytest.param(
            True,
            "  redis://event-bus.example:6380/3  ",
            "redis://event-bus.example:6380/3",
            id="sentinel-explicit",
        ),
        pytest.param(False, None, "redis://default-redis.example:6379/0", id="standalone-default"),
        pytest.param(False, "", "redis://default-redis.example:6379/0", id="standalone-empty"),
        pytest.param(False, " \t ", "redis://default-redis.example:6379/0", id="standalone-whitespace"),
        pytest.param(
            False,
            "  redis://event-bus.example:6380/3  ",
            "redis://event-bus.example:6380/3",
            id="standalone-explicit",
        ),
    ],
)
def test_init_app_selects_pubsub_client_from_redis_mode_and_explicit_url(
    monkeypatch: pytest.MonkeyPatch,
    use_sentinel: bool,
    configured_url: str | None,
    expected_dedicated_url: str | None,
) -> None:
    app, primary_client, pubsub_calls = _initialize_redis(
        monkeypatch,
        use_sentinel=use_sentinel,
        pubsub_redis_url=configured_url,
    )

    assert app.extensions["redis"] is ext_redis.redis_client
    if expected_dedicated_url is None:
        assert pubsub_calls == []
        assert ext_redis._pubsub_redis_client is primary_client
    else:
        assert pubsub_calls == [(expected_dedicated_url, False)]
        assert isinstance(ext_redis._pubsub_redis_client, redis.Redis)
        assert ext_redis._pubsub_redis_client is not primary_client


@pytest.mark.parametrize("configured_url", [None, "", " \t "])
def test_sentinel_without_explicit_pubsub_url_does_not_build_default_url(
    monkeypatch: pytest.MonkeyPatch,
    configured_url: str | None,
) -> None:
    _, primary_client, pubsub_calls = _initialize_redis(
        monkeypatch,
        use_sentinel=True,
        pubsub_redis_url=configured_url,
        redis_host="",
    )

    assert pubsub_calls == []
    assert ext_redis._pubsub_redis_client is primary_client


@pytest.mark.parametrize("use_sentinel", [True, False], ids=["sentinel", "standalone"])
def test_init_app_forwards_pubsub_cluster_setting(
    monkeypatch: pytest.MonkeyPatch,
    use_sentinel: bool,
) -> None:
    _, primary_client, pubsub_calls = _initialize_redis(
        monkeypatch,
        use_sentinel=use_sentinel,
        pubsub_redis_url=" redis://event-bus.example:6380/3 ",
        pubsub_uses_clusters=True,
    )

    assert pubsub_calls == [("redis://event-bus.example:6380/3", True)]
    assert ext_redis._pubsub_redis_client is not primary_client
