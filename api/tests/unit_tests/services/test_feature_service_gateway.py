from pytest_mock import MockerFixture

from enums import DeploymentEdition
from services.entities.feature_entities import FeatureModel, SystemFeatureModel
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway
from services.system_feature_service import SystemFeatureService


def test_public_system_features_delegate_to_existing_service(mocker: MockerFixture) -> None:
    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    get_system_features = mocker.patch.object(
        SystemFeatureService,
        "get_public_system_features",
        return_value=system_features,
    )

    result = FeatureServiceGateway().get_public_system_features()

    assert result is system_features
    get_system_features.assert_called_once_with()


def test_workspace_features_exclude_independently_queried_vector_space(mocker: MockerFixture) -> None:
    features = FeatureModel(vector_space=None)
    get_features = mocker.patch.object(FeatureService, "get_features", return_value=features)

    result = FeatureServiceGateway().get_workspace_features("workspace_123")

    assert result is features
    get_features.assert_called_once_with("workspace_123", exclude_vector_space=True)


def test_trial_models_delegate_to_workspace_aware_feature_service(mocker: MockerFixture) -> None:
    trial_models = ["langgenius/openai/openai"]
    get_trial_models = mocker.patch.object(FeatureService, "get_trial_models", return_value=trial_models)

    result = FeatureServiceGateway().get_trial_models("workspace_123")

    assert result == trial_models
    get_trial_models.assert_called_once_with("workspace_123")
