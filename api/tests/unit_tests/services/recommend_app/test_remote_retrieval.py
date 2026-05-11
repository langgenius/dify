from unittest.mock import MagicMock, patch

import pytest

from services.recommend_app.recommend_app_type import RecommendAppType
from services.recommend_app.remote.remote_retrieval import RemoteRecommendAppRetrieval


class TestRemoteRecommendAppRetrieval:
    def test_get_type(self):
        assert RemoteRecommendAppRetrieval().get_type() == RecommendAppType.REMOTE

    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_recommended_app_detail_from_dify_official",
        return_value={"id": "app-1"},
    )
    def test_get_recommend_app_detail_success(self, mock_fetch):
        result = RemoteRecommendAppRetrieval().get_recommend_app_detail("app-1")
        assert result == {"id": "app-1"}
        mock_fetch.assert_called_once_with("app-1")

    @patch(
        "services.recommend_app.remote.remote_retrieval"
        ".BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin",
        return_value={"id": "fallback"},
    )
    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_recommended_app_detail_from_dify_official",
        side_effect=ConnectionError("timeout"),
    )
    def test_get_recommend_app_detail_falls_back_on_error(self, mock_fetch, mock_builtin):
        result = RemoteRecommendAppRetrieval().get_recommend_app_detail("app-1")
        assert result == {"id": "fallback"}
        mock_builtin.assert_called_once_with("app-1")

    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_recommended_apps_from_dify_official",
        return_value={"recommended_apps": [], "categories": []},
    )
    def test_get_recommended_apps_success(self, mock_fetch):
        result = RemoteRecommendAppRetrieval().get_recommended_apps_and_categories("en-US")
        assert result == {"recommended_apps": [], "categories": []}

    @patch(
        "services.recommend_app.remote.remote_retrieval"
        ".BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin",
        return_value={"recommended_apps": [{"id": "builtin"}]},
    )
    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_recommended_apps_from_dify_official",
        side_effect=ValueError("server error"),
    )
    def test_get_recommended_apps_falls_back_on_error(self, mock_fetch, mock_builtin):
        result = RemoteRecommendAppRetrieval().get_recommended_apps_and_categories("en-US")
        assert result == {"recommended_apps": [{"id": "builtin"}]}


class TestFetchFromDifyOfficial:
    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_detail_returns_json_on_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"id": "app-1", "name": "Test"}
        mock_get.return_value = mock_response

        result = RemoteRecommendAppRetrieval.fetch_recommended_app_detail_from_dify_official("app-1")

        assert result == {"id": "app-1", "name": "Test"}
        mock_get.assert_called_once()

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_detail_returns_none_on_non_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_get.return_value = MagicMock(status_code=404)

        result = RemoteRecommendAppRetrieval.fetch_recommended_app_detail_from_dify_official("app-1")

        assert result is None

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_returns_sorted_categories_on_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {
            "recommended_apps": [],
            "categories": ["writing", "agent", "chat"],
        }
        mock_get.return_value = mock_response

        result = RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert result["categories"] == ["agent", "chat", "writing"]

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_raises_on_non_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_get.return_value = MagicMock(status_code=500)

        with pytest.raises(ValueError, match="fetch recommended apps failed"):
            RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_without_categories_key(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": []}
        mock_get.return_value = mock_response

        result = RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert "categories" not in result
