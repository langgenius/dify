"""Unit coverage for ClickZetta configuration and path generation."""

from unittest.mock import MagicMock

import pytest

from extensions.storage.clickzetta_volume.clickzetta_volume_storage import (
    ClickZettaVolumeConfig,
    ClickZettaVolumeStorage,
)


def _table_storage() -> ClickZettaVolumeStorage:
    config = ClickZettaVolumeConfig(
        username="test_user",
        password="test_pass",
        instance="test_instance",
        service="uat-api.clickzetta.com",
        workspace="quick_start",
        vcluster="default_ap",
        schema_name="dify",
        volume_type="table",
        table_prefix="test_dataset_",
    )
    storage = ClickZettaVolumeStorage.__new__(ClickZettaVolumeStorage)
    storage._config = config
    return storage


def test_config_validation() -> None:
    with pytest.raises(
        ValueError,
        match=(
            "1 validation error for ClickZettaVolumeConfig\\\n  Value error, "
            "CLICKZETTA_VOLUME_USERNAME or CLICKZETTA_USERNAME is required"
        ),
    ):
        ClickZettaVolumeConfig(username="", password="pass", instance="instance")

    with pytest.raises(
        ValueError,
        match=(
            "1 validation error for ClickZettaVolumeConfig\\\n  Value error, "
            "CLICKZETTA_VOLUME_TYPE must be one of: table, user, external"
        ),
    ):
        ClickZettaVolumeConfig(username="user", password="pass", instance="instance", volume_type="invalid_type")

    with pytest.raises(
        ValueError,
        match=(
            "1 validation error for ClickZettaVolumeConfig\\\n  Value error, "
            "CLICKZETTA_VOLUME_NAME is required for external volume type"
        ),
    ):
        ClickZettaVolumeConfig(
            username="user",
            password="pass",
            instance="instance",
            volume_type="external",
        )


def test_volume_path_generation() -> None:
    storage = _table_storage()

    assert storage._get_volume_path("test.txt", "12345") == "test_dataset_12345/test.txt"
    assert storage._get_volume_path("12345/test.txt") == "12345/test.txt"

    storage._config.volume_type = "user"
    assert storage._get_volume_path("test.txt") == "dify_km/test.txt"


def test_sql_prefix_generation() -> None:
    storage = _table_storage()

    assert storage._get_volume_sql_prefix("12345") == "TABLE VOLUME test_dataset_12345"

    storage._config.volume_type = "user"
    assert storage._get_volume_sql_prefix() == "USER VOLUME"

    storage._config.volume_type = "external"
    storage._config.volume_name = "my_external_volume"
    assert storage._get_volume_sql_prefix() == "VOLUME my_external_volume"


def test_scan_table_prefix_matches_file_storage_path(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    execute = MagicMock(return_value=[("app/trace.json",), ("another-app/trace.json",)])
    monkeypatch.setattr(storage, "_execute_sql", execute)
    assert storage.scan("ops_trace/app/") == ["ops_trace/app/trace.json"]
    execute.assert_called_once_with("LIST TABLE VOLUME test_dataset_ops_trace SUBDIRECTORY 'app/'", fetch=True)


def test_scan_special_table_prefix_restores_logical_root(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    execute = MagicMock(return_value=[("dify_km/tenant/file.txt",)])
    monkeypatch.setattr(storage, "_execute_sql", execute)
    assert storage.scan("upload_files/tenant/") == ["upload_files/tenant/file.txt"]
    execute.assert_called_once_with("LIST USER VOLUME SUBDIRECTORY 'dify_km/tenant/'", fetch=True)


def test_scan_preserves_bare_dataset_root_behavior(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    execute = MagicMock(return_value=[("file.txt",)])
    monkeypatch.setattr(storage, "_execute_sql", execute)
    assert storage.scan("12345") == ["file.txt"]
    execute.assert_called_once_with("LIST TABLE VOLUME test_dataset_12345", fetch=True)


def test_scan_propagates_backend_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    monkeypatch.setattr(storage, "_execute_sql", MagicMock(side_effect=RuntimeError("backend unavailable")))
    with pytest.raises(RuntimeError, match="backend unavailable"):
        storage.scan("ops_trace/app/")


def test_delete_propagates_failed_existence_check(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    execute = MagicMock(side_effect=RuntimeError("backend unavailable"))
    monkeypatch.setattr(storage, "_execute_sql", execute)
    with pytest.raises(RuntimeError, match="backend unavailable"):
        storage.delete("ops_trace/app/trace.json")
    assert execute.call_count == 1


def test_delete_absent_file_remains_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _table_storage()
    execute = MagicMock(return_value=[])
    monkeypatch.setattr(storage, "_execute_sql", execute)
    storage.delete("ops_trace/app/trace.json")
    assert execute.call_count == 1
