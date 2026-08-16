import pytest

from configs.middleware.vdb.tidb_on_qdrant_config import TidbOnQdrantConfig


def test_estimated_storage_limits_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB", raising=False)

    config = TidbOnQdrantConfig()

    assert config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB == "sandbox:60,professional:6400,team:25600"


def test_estimated_storage_limits_custom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB", "sandbox:61,professional:6500,team:26000")

    config = TidbOnQdrantConfig()

    assert config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB == "sandbox:61,professional:6500,team:26000"
