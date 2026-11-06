from typing import override

import pytest
from aliyun.log import IndexConfig, IndexKeyConfig, IndexLineConfig

from extensions.logstore import aliyun_logstore
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG
from tests.helpers.unit.config_override import apply_config_overrides


class _IndexResponse:
    def __init__(self, config: IndexConfig) -> None:
        self._config = config

    def get_index_config(self) -> IndexConfig:
        return self._config


class _SDKClient:
    def __init__(self) -> None:
        self._user_agent = "test-sdk"
        self.logstore_error: Exception | None = None
        self.index_error: Exception | None = None
        self.index_config: IndexConfig | None = None
        self.created_logstores: list[tuple[str, str, int]] = []
        self.created_indexes: list[tuple[str, str, IndexConfig]] = []
        self.updated_indexes: list[tuple[str, str, IndexConfig]] = []
        self.index_requests: list[tuple[str, str]] = []

    def set_user_agent(self, value: str) -> None:
        self._user_agent = value

    def get_project(self, project_name: str) -> object:
        return project_name

    def get_logstore(self, project_name: str, logstore_name: str) -> object:
        if self.logstore_error is not None:
            raise self.logstore_error
        return project_name, logstore_name

    def get_index_config(self, project_name: str, logstore_name: str) -> _IndexResponse:
        self.index_requests.append((project_name, logstore_name))
        if self.index_error is not None:
            raise self.index_error
        assert self.index_config is not None
        return _IndexResponse(self.index_config)

    def create_logstore(self, *, project_name: str, logstore_name: str, ttl: int) -> None:
        self.created_logstores.append((project_name, logstore_name, ttl))

    def create_index(self, project_name: str, logstore_name: str, config: IndexConfig) -> None:
        self.created_indexes.append((project_name, logstore_name, config))

    def update_index(self, project_name: str, logstore_name: str, config: IndexConfig) -> None:
        self.updated_indexes.append((project_name, logstore_name, config))


class _PGClient(AliyunLogStorePG):
    def __init__(self) -> None:
        self.closed = False

    @override
    def init_connection(self) -> bool:
        return True

    @override
    def close(self) -> None:
        self.closed = True


@pytest.fixture
def sdk() -> _SDKClient:
    return _SDKClient()


@pytest.fixture
def logstore(sdk: _SDKClient, monkeypatch: pytest.MonkeyPatch) -> AliyunLogStore:
    """Construct an isolated client with connectivity and SDK effects replaced."""
    apply_config_overrides(
        monkeypatch,
        ALIYUN_SLS_PROJECT_NAME="project",
        ALIYUN_SLS_LOGSTORE_TTL=365,
        LOGSTORE_PG_MODE_ENABLED=False,
    )
    monkeypatch.setattr(AliyunLogStore, "_instance", None)
    monkeypatch.setattr(AliyunLogStore, "_initialized", False)
    monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", lambda *_: None)
    monkeypatch.setattr(aliyun_logstore, "LogClient", lambda *_args, **_kwargs: sdk)
    return AliyunLogStore()


def test_startup_creates_supplied_logstores_and_indexes(logstore: AliyunLogStore, sdk: _SDKClient) -> None:
    sdk.logstore_error = Exception("LogStoreNotExist")
    sdk.index_error = Exception("IndexConfigNotExist")
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=True)

    logstore.init_project_logstore({"custom_logs": config})

    assert sdk.created_logstores == [("project", "custom_logs", 365)]
    assert sdk.created_indexes == [("project", "custom_logs", config)]


def test_index_upgrade_preserves_custom_fields_and_scan_setting(logstore: AliyunLogStore, sdk: _SDKClient) -> None:
    line_config = IndexLineConfig(token_list=["|"])
    custom_field = IndexKeyConfig(index_type="text")
    json_as_text = IndexKeyConfig(index_type="text")
    sdk.index_config = IndexConfig(
        line_config=line_config,
        key_config_list={
            "custom_field": custom_field,
            "Status": IndexKeyConfig(index_type="text"),
            "version": IndexKeyConfig(index_type="text"),
            "payload": json_as_text,
        },
        scan_index=False,
    )
    required = IndexConfig(
        key_config_list={
            "status": IndexKeyConfig(index_type="text"),
            "version": IndexKeyConfig(index_type="long"),
            "owner": IndexKeyConfig(index_type="text"),
            "payload": IndexKeyConfig(index_type="json"),
        },
        scan_index=True,
    )

    logstore.ensure_index_config("custom_logs", required)

    assert len(sdk.updated_indexes) == 1
    project, name, merged = sdk.updated_indexes[0]
    assert (project, name) == ("project", "custom_logs")
    assert merged.line_config is line_config
    assert merged.scan_index is False
    assert merged.key_config_list == {**required.key_config_list, "custom_field": custom_field, "payload": json_as_text}
    assert sdk.created_indexes == []


def test_current_indexes_are_not_rewritten(logstore: AliyunLogStore, sdk: _SDKClient) -> None:
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=True)
    sdk.index_config = config

    logstore.ensure_index_config("custom_logs", config)

    assert sdk.updated_indexes == []
    assert sdk.created_indexes == []


def test_pg_scan_check_uses_supplied_logstore_names(logstore: AliyunLogStore, sdk: _SDKClient) -> None:
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=False)
    sdk.index_config = config
    logstore.init_project_logstore({"custom_logs": config})
    logstore.pg_mode_enabled = True
    pg_client = _PGClient()
    logstore._pg_client = pg_client

    logstore._attempt_pg_connection_init()

    assert logstore._use_pg_protocol is False
    assert pg_client.closed is True
    assert sdk.index_requests[-1] == ("project", "custom_logs")
