from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

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
        result = RemoteRecommendAppRetrieval().get_recommend_app_detail("app-1", session=MagicMock())
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
        result = RemoteRecommendAppRetrieval().get_recommend_app_detail("app-1", session=MagicMock())
        assert result == {"id": "fallback"}
        mock_builtin.assert_called_once_with("app-1")

    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_recommended_apps_from_dify_official",
        return_value={"recommended_apps": [], "categories": []},
    )
    def test_get_recommended_apps_success(self, mock_fetch):
        result = RemoteRecommendAppRetrieval().get_recommended_apps_and_categories("en-US", session=MagicMock())
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
        result = RemoteRecommendAppRetrieval().get_recommended_apps_and_categories("en-US", session=MagicMock())
        assert result == {"recommended_apps": [{"id": "builtin"}]}

    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_learn_dify_apps_from_dify_official",
        return_value={"recommended_apps": [{"id": "learn-dify-app"}]},
    )
    def test_get_learn_dify_apps_success(self, mock_fetch):
        result = RemoteRecommendAppRetrieval().get_learn_dify_apps("en-US", session=MagicMock())

        assert result == {"recommended_apps": [{"id": "learn-dify-app"}]}
        mock_fetch.assert_called_once_with("en-US")

    @patch(
        "services.recommend_app.remote.remote_retrieval.DatabaseRecommendAppRetrieval.fetch_learn_dify_apps_from_db",
        return_value={"recommended_apps": [{"id": "db-fallback"}]},
    )
    @patch.object(
        RemoteRecommendAppRetrieval,
        "fetch_learn_dify_apps_from_dify_official",
        side_effect=ValueError("server error"),
    )
    def test_get_learn_dify_apps_falls_back_to_database_on_error(self, mock_fetch, mock_database):
        session = MagicMock()

        result = RemoteRecommendAppRetrieval().get_learn_dify_apps("en-US", session=session)

        assert result == {"recommended_apps": [{"id": "db-fallback"}]}
        mock_database.assert_called_once_with("en-US", session=session)


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
    def test_apps_preserves_remote_categories_order_on_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {
            "recommended_apps": [],
            "categories": ["writing", "agent", "chat"],
        }
        mock_get.return_value = mock_response

        result = RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert result["categories"] == ["writing", "agent", "chat"]

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
        assert mock_get.call_args.kwargs["headers"] == {}

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_forwards_request_origin_header(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_config.CONSOLE_WEB_URL = "https://saas.dify.dev"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": []}
        mock_get.return_value = mock_response

        flask_app = Flask(__name__)
        with flask_app.test_request_context(headers={"Origin": "https://cloud.example.com"}):
            RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert mock_get.call_args.kwargs["headers"] == {"Origin": "https://cloud.example.com"}

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_falls_back_to_console_web_url_origin(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_config.CONSOLE_WEB_URL = "https://saas.dify.dev/console"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": []}
        mock_get.return_value = mock_response

        flask_app = Flask(__name__)
        with flask_app.test_request_context():
            RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert mock_get.call_args.kwargs["headers"] == {"Origin": "https://saas.dify.dev/console"}

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_falls_back_to_console_web_url_without_request_context(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_config.CONSOLE_WEB_URL = "http://localhost:3000/console"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": []}
        mock_get.return_value = mock_response

        RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert mock_get.call_args.kwargs["headers"] == {"Origin": "http://localhost:3000/console"}

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_apps_uses_console_web_url_without_scheme(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_config.CONSOLE_WEB_URL = "saas.dify.dev"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": []}
        mock_get.return_value = mock_response

        flask_app = Flask(__name__)
        with flask_app.test_request_context():
            RemoteRecommendAppRetrieval.fetch_recommended_apps_from_dify_official("en-US")

        assert mock_get.call_args.kwargs["headers"] == {"Origin": "saas.dify.dev"}

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_learn_dify_apps_returns_json_on_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_response = MagicMock(status_code=200)
        mock_response.json.return_value = {"recommended_apps": [{"id": "learn-dify-app"}]}
        mock_get.return_value = mock_response

        result = RemoteRecommendAppRetrieval.fetch_learn_dify_apps_from_dify_official("en-US")

        assert result == {"recommended_apps": [{"id": "learn-dify-app"}]}
        assert mock_get.call_args.args[0] == "https://example.com/apps/learn-dify?language=en-US"

    @patch("services.recommend_app.remote.remote_retrieval.dify_config")
    @patch("services.recommend_app.remote.remote_retrieval.httpx.get")
    def test_learn_dify_apps_raises_on_non_200(self, mock_get, mock_config):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = "https://example.com"
        mock_get.return_value = MagicMock(status_code=500)

        with pytest.raises(ValueError, match="fetch learn dify apps failed"):
            RemoteRecommendAppRetrieval.fetch_learn_dify_apps_from_dify_official("en-US")
