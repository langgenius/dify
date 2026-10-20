import pytest

from configs.extra.logstore_config import LogStoreConfig
from tests.unit_tests.configs._isolated_settings import InitSettingsOnly


class _IsolatedLogStoreConfig(InitSettingsOnly, LogStoreConfig):
    pass


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        pytest.param("true", True, id="enabled"),
        pytest.param("false", False, id="disabled"),
    ],
)
def test_logstore_migration_flags_parse_boolean_values(raw_value: str, expected: bool) -> None:
    config = _IsolatedLogStoreConfig(
        LOGSTORE_DUAL_WRITE_ENABLED=raw_value,
        LOGSTORE_ENABLE_PUT_GRAPH_FIELD=raw_value,
    )

    assert config.LOGSTORE_DUAL_WRITE_ENABLED is expected
    assert config.LOGSTORE_ENABLE_PUT_GRAPH_FIELD is expected
