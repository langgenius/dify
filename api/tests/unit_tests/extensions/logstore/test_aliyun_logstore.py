from unittest.mock import MagicMock

import pytest
from aliyun.log import IndexConfig, IndexKeyConfig, IndexLineConfig

from extensions.logstore.aliyun_logstore import AliyunLogStore


@pytest.fixture
def sdk() -> MagicMock:
    return MagicMock()


@pytest.fixture
def logstore(sdk: MagicMock) -> AliyunLogStore:
    # Use the real index management code with only the external SDK replaced.
    store = object.__new__(AliyunLogStore)
    store.client = sdk
    store.project_name = "project"
    store.logstore_ttl = 365
    store.pg_mode_enabled = False
    return store


def test_startup_creates_supplied_logstores_and_indexes(logstore: AliyunLogStore, sdk: MagicMock) -> None:
    sdk.get_logstore.side_effect = Exception("LogStoreNotExist")
    sdk.get_index_config.side_effect = Exception("IndexConfigNotExist")
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=True)

    logstore.init_project_logstore({"custom_logs": config})

    sdk.create_logstore.assert_called_once_with(project_name="project", logstore_name="custom_logs", ttl=365)
    sdk.create_index.assert_called_once_with("project", "custom_logs", config)


def test_index_upgrade_preserves_custom_fields_and_scan_setting(logstore: AliyunLogStore, sdk: MagicMock) -> None:
    line_config = IndexLineConfig(token_list=["|"])
    custom_field = IndexKeyConfig(index_type="text")
    json_as_text = IndexKeyConfig(index_type="text")
    sdk.get_index_config.return_value.get_index_config.return_value = IndexConfig(
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

    sdk.update_index.assert_called_once()
    project, name, merged = sdk.update_index.call_args.args
    assert (project, name) == ("project", "custom_logs")
    assert merged.line_config is line_config
    assert merged.scan_index is False
    assert merged.key_config_list == {**required.key_config_list, "custom_field": custom_field, "payload": json_as_text}
    sdk.create_index.assert_not_called()


def test_current_indexes_are_not_rewritten(logstore: AliyunLogStore, sdk: MagicMock) -> None:
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=True)
    sdk.get_index_config.return_value.get_index_config.return_value = config

    logstore.ensure_index_config("custom_logs", config)

    sdk.update_index.assert_not_called()
    sdk.create_index.assert_not_called()


def test_pg_scan_check_uses_supplied_logstore_names(logstore: AliyunLogStore, sdk: MagicMock) -> None:
    config = IndexConfig(key_config_list={"version": IndexKeyConfig(index_type="long")}, scan_index=False)
    sdk.get_index_config.return_value.get_index_config.return_value = config
    logstore.init_project_logstore({"custom_logs": config})
    logstore.pg_mode_enabled = True
    pg_client = MagicMock()
    pg_client.init_connection.return_value = True
    logstore._pg_client = pg_client

    logstore._attempt_pg_connection_init()

    assert logstore._use_pg_protocol is False
    pg_client.close.assert_called_once()
    sdk.get_index_config.assert_called_with("project", "custom_logs")
