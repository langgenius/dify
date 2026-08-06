import pytest

from enums.deployment_edition import DeploymentEdition
from services.feature_service import FeatureService, SystemFeatureModel


def test_system_feature_model_disables_knowledge_fs_by_default() -> None:
    assert SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY).knowledge_fs_enabled is False


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_knowledge_fs_flag(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.KNOWLEDGE_FS_ENABLED", enabled)

    result = FeatureService.get_system_features()

    assert result.knowledge_fs_enabled is enabled
