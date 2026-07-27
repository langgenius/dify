import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("enabled", "direct_origin", "direct_upload_ready", "upload_enabled"),
    [
        (True, "https://uploads.knowledge-fs.test", True, True),
        (True, "https://uploads.knowledge-fs.test", False, False),
        (True, None, True, False),
        (False, "https://uploads.knowledge-fs.test", True, False),
    ],
)
def test_get_system_features_reads_knowledge_fs_availability(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    direct_origin: str | None,
    direct_upload_ready: bool,
    upload_enabled: bool,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "KNOWLEDGE_FS_ENABLED", enabled)
    monkeypatch.setattr(feature_service_module.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", direct_origin)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_FS_DIRECT_UPLOAD_READY",
        direct_upload_ready,
    )

    result = FeatureService.get_system_features()

    assert result.knowledge_fs_enabled is enabled
    assert result.knowledge_fs_upload_enabled is upload_enabled
    assert result.model_dump()["knowledge_fs_enabled"] is enabled
    assert result.model_dump()["knowledge_fs_upload_enabled"] is upload_enabled
