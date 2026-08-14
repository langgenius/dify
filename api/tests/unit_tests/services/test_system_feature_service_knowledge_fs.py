"""Tests for the SystemFeatureService knowledge-filesystem policy."""

import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.system_feature_service import SystemFeatureService


def test_system_feature_model_disables_knowledge_fs_by_default() -> None:
    assert SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY).knowledge_fs_enabled is False


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_knowledge_fs_flag(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.KNOWLEDGE_FS_ENABLED", enabled)

    result = SystemFeatureService.get_public_system_features()

    assert result.knowledge_fs_enabled is enabled
