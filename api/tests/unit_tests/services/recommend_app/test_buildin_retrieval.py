import json
from unittest.mock import MagicMock, patch

import pytest

from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.recommend_app_type import RecommendAppType

SAMPLE_BUILTIN_DATA = {
    "recommended_apps": {
        "en-US": {"categories": ["writing"], "apps": [{"id": "app-1"}]},
        "zh-Hans": {"categories": ["search"], "apps": [{"id": "app-2"}]},
    },
    "app_details": {
        "app-1": {"id": "app-1", "name": "Writer", "mode": "chat"},
        "app-2": {"id": "app-2", "name": "Searcher", "mode": "workflow"},
    },
}


@pytest.fixture(autouse=True)
def _reset_cache():
    BuildInRecommendAppRetrieval.builtin_data = None
    yield
    BuildInRecommendAppRetrieval.builtin_data = None


class TestBuildInRecommendAppRetrieval:
    def test_get_type(self):
        retrieval = BuildInRecommendAppRetrieval()
        assert retrieval.get_type() == RecommendAppType.BUILDIN

    def test_get_recommended_apps_and_categories_delegates(self):
        with patch.object(
            BuildInRecommendAppRetrieval,
            "fetch_recommended_apps_from_builtin",
            return_value={"apps": []},
        ) as mock_fetch:
            retrieval = BuildInRecommendAppRetrieval()
            result = retrieval.get_recommended_apps_and_categories("en-US")
            mock_fetch.assert_called_once_with("en-US")
            assert result == {"apps": []}

    def test_get_recommend_app_detail_delegates(self):
        with patch.object(
            BuildInRecommendAppRetrieval,
            "fetch_recommended_app_detail_from_builtin",
            return_value={"id": "app-1"},
        ) as mock_fetch:
            retrieval = BuildInRecommendAppRetrieval()
            result = retrieval.get_recommend_app_detail("app-1")
            mock_fetch.assert_called_once_with("app-1")
            assert result == {"id": "app-1"}

    def test_get_builtin_data_reads_json_and_caches(self, tmp_path):
        json_file = tmp_path / "constants" / "recommended_apps.json"
        json_file.parent.mkdir(parents=True)
        json_file.write_text(json.dumps(SAMPLE_BUILTIN_DATA))

        mock_app = MagicMock()
        mock_app.root_path = str(tmp_path)

        with patch(
            "services.recommend_app.buildin.buildin_retrieval.current_app",
            mock_app,
        ):
            first = BuildInRecommendAppRetrieval._get_builtin_data()
            second = BuildInRecommendAppRetrieval._get_builtin_data()

        assert first == SAMPLE_BUILTIN_DATA
        assert first is second

    def test_fetch_recommended_apps_from_builtin(self):
        BuildInRecommendAppRetrieval.builtin_data = SAMPLE_BUILTIN_DATA
        result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin("en-US")
        assert result == SAMPLE_BUILTIN_DATA["recommended_apps"]["en-US"]

    def test_fetch_recommended_apps_from_builtin_missing_language(self):
        BuildInRecommendAppRetrieval.builtin_data = SAMPLE_BUILTIN_DATA
        result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin("fr-FR")
        assert result == {}

    def test_fetch_recommended_app_detail_from_builtin(self):
        BuildInRecommendAppRetrieval.builtin_data = SAMPLE_BUILTIN_DATA
        result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin("app-1")
        assert result == {"id": "app-1", "name": "Writer", "mode": "chat"}

    def test_fetch_recommended_app_detail_from_builtin_missing(self):
        BuildInRecommendAppRetrieval.builtin_data = SAMPLE_BUILTIN_DATA
        result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin("nonexistent")
        assert result is None
