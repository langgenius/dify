"""Unit tests for RecommendedAppService.get_recommend_app_detail null handling.

Regression tests for #36096: accessing result['id'] when the retrieval
returns None causes a TypeError / KeyError in self-hosted mode.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.recommended_app_service import RecommendedAppService


class TestGetRecommendAppDetailNullCheck:
    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_returns_none_when_retrieval_returns_none_and_trial_disabled(
        self, mock_config, mock_factory_class, mock_feature_service
    ):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)
        mock_feature_service.get_system_features.return_value = SimpleNamespace(enable_trial_app=False)

        result = RecommendedAppService.get_recommend_app_detail("nonexistent")

        assert result is None

    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_returns_none_when_retrieval_returns_none_and_trial_enabled(
        self, mock_config, mock_factory_class, mock_feature_service
    ):
        """Regression for #36096: must not crash when result is None and enable_trial_app is True."""
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)
        mock_feature_service.get_system_features.return_value = SimpleNamespace(enable_trial_app=True)

        result = RecommendedAppService.get_recommend_app_detail("nonexistent")

        assert result is None
        mock_instance.get_recommend_app_detail.assert_called_once_with("nonexistent")
