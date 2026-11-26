import pytest
from redis.connection import parse_url

from configs.middleware import MiddlewareConfig


@pytest.mark.parametrize("use_ssl", [False, True])
@pytest.mark.parametrize("username", [None, "user with spaces", "user+/@:%?#"])
def test_default_pubsub_url_preserves_credentials(use_ssl: bool, username: str | None) -> None:
    """A generated event-bus URL preserves credentials when redis-py decodes userinfo."""
    password = "pass word+/@:%?#"
    config = MiddlewareConfig(
        REDIS_HOST="localhost",
        REDIS_PORT=6379,
        REDIS_DB=2,
        REDIS_USE_SSL=use_ssl,
        REDIS_USERNAME=username,
        REDIS_PASSWORD=password,
    )

    parsed = parse_url(config.normalized_pubsub_redis_url)

    assert parsed.get("username") == username
    assert parsed["password"] == password
    assert parsed["db"] == 2


@pytest.mark.parametrize("use_ssl", [False, True])
@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "2001:db8::10", "[2001:db8::10]"])
def test_default_pubsub_url_preserves_host_and_port(use_ssl: bool, host: str) -> None:
    """An IPv6 Redis host is delimited independently of the port in the generated URL."""
    config = MiddlewareConfig(REDIS_HOST=host, REDIS_PORT=6380, REDIS_USE_SSL=use_ssl)

    parsed = parse_url(config.normalized_pubsub_redis_url)

    assert parsed["host"] == host.strip("[]")
    assert parsed["port"] == 6380
