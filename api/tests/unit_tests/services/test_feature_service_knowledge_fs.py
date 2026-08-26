import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import SystemFeatureModel
from services.feature_service import FeatureService


def test_system_feature_model_disables_knowledge_fs_by_default() -> None:
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)

    assert features.knowledge_fs_enabled is False
    assert features.knowledge_fs_upload_enabled is False


@pytest.mark.parametrize(
    ("enabled", "base_url", "capability_enabled", "signing_ready", "upload_enabled"),
    [
        (True, "https://knowledge-fs.test", True, True, True),
        (True, None, True, True, False),
        (True, "https://knowledge-fs.test", False, True, False),
        (True, "https://knowledge-fs.test", True, False, False),
        (False, "https://knowledge-fs.test", True, True, False),
    ],
)
def test_get_system_features_reads_knowledge_fs_availability(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    base_url: str | None,
    capability_enabled: bool,
    signing_ready: bool,
    upload_enabled: bool,
) -> None:
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "DEPLOYMENT_EDITION",
        DeploymentEdition.CLOUD,
    )
    monkeypatch.setattr(feature_service_module.dify_config, "KNOWLEDGE_FS_ENABLED", enabled)
    monkeypatch.setattr(feature_service_module.dify_config, "KNOWLEDGE_FS_BASE_URL", base_url)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED",
        capability_enabled,
    )
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID",
        "signing-key" if signing_ready else None,
    )
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM",
        object() if signing_ready else None,
    )
    result = FeatureService.get_system_features()

    assert result.knowledge_fs_enabled is enabled
    assert result.knowledge_fs_upload_enabled is upload_enabled
    assert result.model_dump()["knowledge_fs_enabled"] is enabled
    assert result.model_dump()["knowledge_fs_upload_enabled"] is upload_enabled


@pytest.mark.parametrize(
    ("edition", "expected"),
    [(DeploymentEdition.ENTERPRISE, True), (DeploymentEdition.COMMUNITY, False)],
)
def test_get_system_features_controls_knowledge_fs_by_edition(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
    expected: bool,
) -> None:
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "DEPLOYMENT_EDITION",
        edition,
    )
    monkeypatch.setattr(feature_service_module.dify_config, "KNOWLEDGE_FS_ENABLED", True)
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_enterprise", lambda _: None)

    result = FeatureService.get_system_features()

    assert result.knowledge_fs_enabled is expected
