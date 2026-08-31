from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.feature_service import FeatureService


def test_system_feature_model_disables_knowledge_fs_by_default() -> None:
    assert SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY).knowledge_fs_enabled is False


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_knowledge_fs_flag(
    config_overrides: Callable[..., None],
    enabled: bool,
) -> None:
    config_overrides(KNOWLEDGE_FS_ENABLED=enabled)

    result = FeatureService.get_system_features()

    assert result.knowledge_fs_enabled is enabled
