from configs.middleware.vdb.tidb_on_qdrant_config import TidbOnQdrantConfig
from tests.unit_tests.configs._isolated_settings import InitSettingsOnly


class _IsolatedTidbOnQdrantConfig(InitSettingsOnly, TidbOnQdrantConfig):
    pass


def test_estimated_storage_limits_default() -> None:
    config = _IsolatedTidbOnQdrantConfig()

    assert config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB == "sandbox:60,professional:6400,team:25600"


def test_estimated_storage_limits_custom() -> None:
    config = _IsolatedTidbOnQdrantConfig(
        TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB="sandbox:61,professional:6500,team:26000"
    )

    assert config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB == "sandbox:61,professional:6500,team:26000"
