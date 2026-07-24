import pytest
from pydantic import ValidationError

from enums.deployment_edition import DeploymentEdition
from services.feature_service import FeatureService, SystemFeatureModel


def test_system_feature_model_requires_deployment_edition() -> None:
    with pytest.raises(ValidationError):
        SystemFeatureModel.model_validate({})


@pytest.mark.parametrize(
    ("edition", "enterprise_enabled", "expected"),
    [
        ("SELF_HOSTED", False, DeploymentEdition.COMMUNITY),
        ("SELF_HOSTED", True, DeploymentEdition.ENTERPRISE),
        ("CLOUD", False, DeploymentEdition.CLOUD),
        ("CLOUD", True, DeploymentEdition.CLOUD),
    ],
)
def test_get_system_features_resolves_deployment_edition(
    monkeypatch: pytest.MonkeyPatch,
    edition: str,
    enterprise_enabled: bool,
    expected: DeploymentEdition,
) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.EDITION", edition)
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", enterprise_enabled)
    monkeypatch.setattr("services.feature_service.FeatureService._fulfill_params_from_enterprise", lambda *_: None)

    result = FeatureService.get_system_features()

    assert result.deployment_edition is expected
    assert result.model_dump(mode="json")["deployment_edition"] == expected.value
