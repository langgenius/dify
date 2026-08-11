from pytest_mock import MockerFixture

from enums import DeploymentEdition
from services.entities.feature_entities import FeatureModel, SystemFeatureModel
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway


def test_public_system_features_delegate_to_existing_service(mocker: MockerFixture) -> None:
    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    get_system_features = mocker.patch.object(FeatureService, "get_system_features", return_value=system_features)

    result = FeatureServiceGateway().get_public_system_features()

    assert result is system_features
    get_system_features.assert_called_once_with()


def test_workspace_features_exclude_independently_queried_vector_space(mocker: MockerFixture) -> None:
    features = FeatureModel(vector_space=None)
    get_features = mocker.patch.object(FeatureService, "get_features", return_value=features)

    result = FeatureServiceGateway().get_workspace_features("workspace_123")

    assert result is features
    get_features.assert_called_once_with("workspace_123", exclude_vector_space=True)
