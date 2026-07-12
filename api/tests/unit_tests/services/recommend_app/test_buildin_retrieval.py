import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml

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
            result = retrieval.get_recommended_apps_and_categories("en-US", session=MagicMock())
            mock_fetch.assert_called_once_with("en-US")
            assert result == {"apps": []}

    @patch("services.recommend_app.buildin.buildin_retrieval.DatabaseRecommendAppRetrieval")
    def test_get_learn_dify_apps_delegates_to_database(self, mock_database_retrieval):
        expected = {"recommended_apps": [{"id": "learn-dify-app"}]}
        mock_database_retrieval.fetch_learn_dify_apps_from_db.return_value = expected
        session = MagicMock()

        result = BuildInRecommendAppRetrieval().get_learn_dify_apps("en-US", session=session)

        assert result == expected
        mock_database_retrieval.fetch_learn_dify_apps_from_db.assert_called_once_with("en-US", session=session)

    def test_get_recommend_app_detail_delegates(self):
        with patch.object(
            BuildInRecommendAppRetrieval,
            "fetch_recommended_app_detail_from_builtin",
            return_value={"id": "app-1"},
        ) as mock_fetch:
            retrieval = BuildInRecommendAppRetrieval()
            result = retrieval.get_recommend_app_detail("app-1", session=MagicMock())
            mock_fetch.assert_called_once_with("app-1")
            assert result == {"id": "app-1"}

    def test_get_builtin_data_reads_json_and_caches(self, tmp_path: Path):
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


def test_builtin_workflow_templates_have_unique_end_output_variables():
    """Workflow publish validation rejects duplicate End output variable names, so the bundled
    templates must not ship with duplicates or users cannot publish them (see issue #38278)."""
    data_path = Path(__file__).resolve().parents[4] / "constants" / "recommended_apps.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))

    offenders: dict[str, list[str]] = {}
    for app_id, detail in data.get("app_details", {}).items():
        export_data = detail.get("export_data")
        if not export_data:
            continue
        dsl = yaml.safe_load(export_data)
        nodes = (dsl or {}).get("workflow", {}).get("graph", {}).get("nodes", [])
        output_names = [
            output.get("variable")
            for node in nodes
            if node.get("data", {}).get("type") == "end"
            for output in (node.get("data", {}).get("outputs") or [])
        ]
        duplicates = sorted({name for name in output_names if output_names.count(name) > 1})
        if duplicates:
            offenders[detail.get("name", app_id).strip()] = duplicates

    assert offenders == {}, f"templates with duplicate End output variable names: {offenders}"
