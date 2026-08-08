from pytest_mock import MockerFixture

from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway


def test_workspace_features_exclude_independently_queried_vector_space(mocker: MockerFixture) -> None:
    features = FeatureModel(vector_space=None)
    get_features = mocker.patch.object(FeatureService, "get_features", return_value=features)

    result = FeatureServiceGateway().get_workspace_features("workspace_123")

    assert result is features
    get_features.assert_called_once_with("workspace_123", exclude_vector_space=True)
