"""Unit coverage for ClickZetta configuration and path generation."""

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
    with pytest.raises(ValueError):
        ClickZettaVolumeConfig(username="", password="pass", instance="instance")

    with pytest.raises(ValueError):
        ClickZettaVolumeConfig(username="user", password="pass", instance="instance", volume_type="invalid_type")

    with pytest.raises(ValueError):
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
