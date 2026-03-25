from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_type import RecommendAppType


class TestDatabaseRecommendAppRetrieval:
    def test_get_type(self):
        assert DatabaseRecommendAppRetrieval().get_type() == RecommendAppType.DATABASE

    def test_get_recommended_apps_delegates(self):
        with patch.object(
            DatabaseRecommendAppRetrieval,
            "fetch_recommended_apps_from_db",
            return_value={"recommended_apps": [], "categories": []},
        ) as mock_fetch:
            result = DatabaseRecommendAppRetrieval().get_recommended_apps_and_categories("en-US")
            mock_fetch.assert_called_once_with("en-US")
            assert result == {"recommended_apps": [], "categories": []}

    def test_get_recommend_app_detail_delegates(self):
        with patch.object(
            DatabaseRecommendAppRetrieval,
            "fetch_recommended_app_detail_from_db",
            return_value={"id": "app-1"},
        ) as mock_fetch:
            result = DatabaseRecommendAppRetrieval().get_recommend_app_detail("app-1")
            mock_fetch.assert_called_once_with("app-1")
            assert result == {"id": "app-1"}


class TestFetchRecommendedAppsFromDb:
    def _make_recommended_app(self, app_id, category, is_public=True, has_site=True):
        site = (
            SimpleNamespace(
                description="desc",
                copyright="copy",
                privacy_policy="pp",
                custom_disclaimer="cd",
            )
            if has_site
            else None
        )
        app = (
            SimpleNamespace(is_public=is_public, site=site)
            if is_public
            else SimpleNamespace(is_public=False, site=site)
        )
        return SimpleNamespace(
            id=f"rec-{app_id}",
            app=app,
            app_id=app_id,
            category=category,
            position=1,
            is_listed=True,
        )

    @patch("services.recommend_app.database.database_retrieval.db")
    def test_returns_apps_and_sorted_categories(self, mock_db):
        rec1 = self._make_recommended_app("a1", "writing")
        rec2 = self._make_recommended_app("a2", "assistant")
        mock_db.session.scalars.return_value.all.return_value = [rec1, rec2]

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        assert len(result["recommended_apps"]) == 2
        assert result["categories"] == ["assistant", "writing"]

    @patch("services.recommend_app.database.database_retrieval.db")
    def test_falls_back_to_default_language_when_empty(self, mock_db):
        mock_db.session.scalars.return_value.all.side_effect = [
            [],
            [self._make_recommended_app("a1", "chat")],
        ]

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("fr-FR")

        assert len(result["recommended_apps"]) == 1
        assert mock_db.session.scalars.call_count == 2

    @patch("services.recommend_app.database.database_retrieval.db")
    def test_skips_non_public_apps(self, mock_db):
        rec = self._make_recommended_app("a1", "chat", is_public=False)
        mock_db.session.scalars.return_value.all.return_value = [rec]

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        assert result["recommended_apps"] == []

    @patch("services.recommend_app.database.database_retrieval.db")
    def test_skips_apps_without_site(self, mock_db):
        rec = self._make_recommended_app("a1", "chat", has_site=False)
        mock_db.session.scalars.return_value.all.return_value = [rec]

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        assert result["recommended_apps"] == []


class TestFetchRecommendedAppDetailFromDb:
    @patch("services.recommend_app.database.database_retrieval.db")
    def test_returns_none_when_not_listed(self, mock_db):
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db("app-1")

        assert result is None

    @patch("services.recommend_app.database.database_retrieval.AppDslService")
    @patch("services.recommend_app.database.database_retrieval.db")
    def test_returns_none_when_app_not_public(self, mock_db, mock_dsl):
        rec_chain = MagicMock()
        rec_chain.where.return_value.first.return_value = SimpleNamespace(app_id="app-1")
        app_chain = MagicMock()
        app_chain.where.return_value.first.return_value = SimpleNamespace(id="app-1", is_public=False)
        mock_db.session.query.side_effect = [rec_chain, app_chain]

        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db("app-1")

        assert result is None

    @patch("services.recommend_app.database.database_retrieval.AppDslService")
    @patch("services.recommend_app.database.database_retrieval.db")
    def test_returns_detail_on_success(self, mock_db, mock_dsl):
        app_model = SimpleNamespace(
            id="app-1",
            name="My App",
            icon="icon.png",
            icon_background="#fff",
            mode="chat",
            is_public=True,
        )
        rec_chain = MagicMock()
        rec_chain.where.return_value.first.return_value = SimpleNamespace(app_id="app-1")
        app_chain = MagicMock()
        app_chain.where.return_value.first.return_value = app_model
        mock_db.session.query.side_effect = [rec_chain, app_chain]
        mock_dsl.export_dsl.return_value = "exported_yaml"

        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db("app-1")

        assert result["id"] == "app-1"
        assert result["name"] == "My App"
        assert result["export_data"] == "exported_yaml"
