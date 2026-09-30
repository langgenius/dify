"""The live SLS fixture selects each transport without provisioning resources."""

from collections.abc import Iterator
from typing import override

import pytest
from aliyun.log import IndexConfig

from configs import dify_config
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG
from tests.integration_tests.repositories.workflow import test_logstore_dialect as dialect
from tests.unit_tests.config_override import apply_config_overrides

logstore = dialect.logstore


class ReadOnlyPG(AliyunLogStorePG):
    connected = False
    closed = False

    @override
    def init_connection(self) -> bool:
        self.connected = True
        return True

    @override
    def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def configured_transport(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    apply_config_overrides(
        monkeypatch,
        ALIYUN_SLS_ACCESS_KEY_ID="test-key",
        ALIYUN_SLS_ACCESS_KEY_SECRET="test-secret",
        ALIYUN_SLS_ENDPOINT="sls.example.com",
        ALIYUN_SLS_REGION="test-region",
        ALIYUN_SLS_PROJECT_NAME="test-project",
    )
    clients: list[ReadOnlyPG] = []

    def initialize(client: AliyunLogStore) -> None:
        client.pg_mode_enabled = dify_config.LOGSTORE_PG_MODE_ENABLED
        client.access_key_id = "test-key"
        client.access_key_secret = "test-secret"
        client.endpoint = "sls.example.com"
        client.project_name = "test-project"
        client._pg_client = None
        client._use_pg_protocol = False

    def connect(key: str, secret: str, endpoint: str, project: str) -> ReadOnlyPG:
        client = ReadOnlyPG(key, secret, endpoint, project)
        clients.append(client)
        return client

    def forbid_provisioning(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Dialect checks must not provision or alter SLS resources")

    monkeypatch.setattr(AliyunLogStore, "__init__", initialize)
    monkeypatch.setattr(AliyunLogStore, "get_existing_index_config", lambda *_: IndexConfig(scan_index=True))
    monkeypatch.setattr(AliyunLogStore, "init_project_logstore", forbid_provisioning)
    monkeypatch.setattr(dialect, "AliyunLogStorePG", connect)
    yield
    assert all(client.closed for client in clients)


def test_live_fixture_initializes_requested_transport_without_writes(logstore: AliyunLogStore) -> None:
    assert logstore._use_pg_protocol == dify_config.LOGSTORE_PG_MODE_ENABLED
    if dify_config.LOGSTORE_PG_MODE_ENABLED:
        assert isinstance(logstore._pg_client, ReadOnlyPG)
        assert logstore._pg_client.connected
    else:
        assert logstore._pg_client is None
