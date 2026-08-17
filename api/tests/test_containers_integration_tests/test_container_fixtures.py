from __future__ import annotations

import inspect
import os
from types import TracebackType
from typing import Self

import pytest

from tests.test_containers_integration_tests import conftest as container_conftest


class _FakePostgresContainer:
    username = "postgres"
    password = "postgres"
    dbname = "test"

    def __init__(self) -> None:
        self.events: list[str] = []

    def with_network(self, _network: object) -> Self:
        return self

    def waiting_for(self, _strategy: object) -> Self:
        return self

    def __enter__(self) -> Self:
        self.events.append("enter")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.events.append("exit")

    def get_container_host_ip(self) -> str:
        return "127.0.0.1"

    def get_exposed_port(self, port: int) -> int:
        return port


def test_postgres_fixture_stops_container_when_database_initialization_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    postgres = _FakePostgresContainer()
    monkeypatch.setattr(container_conftest, "PostgresContainer", lambda **_: postgres)

    def raise_initialization_error(**_: object) -> None:
        raise RuntimeError("database initialization failed")

    monkeypatch.setattr(container_conftest.psycopg2, "connect", raise_initialization_error)

    fixture_function = inspect.unwrap(container_conftest.postgres_container)
    fixture_iterator = fixture_function(object())

    with pytest.raises(RuntimeError, match="database initialization failed"):
        next(fixture_iterator)

    assert postgres.events == ["enter", "exit"]


def test_redis_fixture_restores_connection_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = _FakePostgresContainer()
    monkeypatch.setattr(container_conftest, "RedisContainer", lambda **_: redis)
    monkeypatch.setenv("REDIS_USERNAME", "caller-user")
    monkeypatch.setenv("REDIS_PASSWORD", "caller-password")

    fixture_function = inspect.unwrap(container_conftest.redis_container)
    fixture_iterator = fixture_function(object())
    assert next(fixture_iterator) is redis

    assert os.environ["REDIS_USERNAME"] == ""
    assert os.environ["REDIS_PASSWORD"] == ""

    with pytest.raises(StopIteration):
        next(fixture_iterator)

    assert os.environ["REDIS_USERNAME"] == "caller-user"
    assert os.environ["REDIS_PASSWORD"] == "caller-password"


def test_container_environment_fixture_composes_resource_fixtures() -> None:
    fixture_function = inspect.unwrap(container_conftest.set_up_containers_and_env)
    fixture_parameters = inspect.signature(fixture_function).parameters

    assert set(fixture_parameters) == {
        "postgres_container",
        "redis_container",
        "dify_sandbox_container",
        "dify_plugin_daemon_container",
        "storage_environment",
    }
