"""Unit tests for RecommendedAppService.get_recommend_app_detail null handling."""

from unittest.mock import MagicMock, patch

from services.recommended_app_service import RecommendedAppService


class TestGetRecommendAppDetailNullCheck:
    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_returns_none_when_retrieval_returns_none_and_trial_enabled(
        self, mock_config: MagicMock, mock_factory_class: MagicMock, mock_feature_service: MagicMock
    ) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = RecommendedAppService.get_recommend_app_detail("nonexistent")

        assert result is None
        mock_instance.get_recommend_app_detail.assert_called_once_with("nonexistent")
        mock_feature_service.get_system_features.assert_not_called()
