"""Unit tests for database recommendation retrieval delegation."""

from unittest.mock import patch

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_type import RecommendAppType


class TestDatabaseRecommendAppRetrieval:
    def test_get_type(self) -> None:
        assert DatabaseRecommendAppRetrieval().get_type() == RecommendAppType.DATABASE

    def test_get_recommended_apps_delegates(self, sqlite_engine: Engine) -> None:
        with (
            Session(sqlite_engine) as session,
            patch.object(
                DatabaseRecommendAppRetrieval,
                "fetch_recommended_apps_from_db",
                return_value={"recommended_apps": [], "categories": []},
            ) as mock_fetch,
        ):
            result = DatabaseRecommendAppRetrieval().get_recommended_apps_and_categories("en-US", session=session)

        mock_fetch.assert_called_once_with("en-US", session=session)
        assert result == {"recommended_apps": [], "categories": []}

    def test_get_recommend_app_detail_delegates(self, sqlite_engine: Engine) -> None:
        with (
            Session(sqlite_engine) as session,
            patch.object(
                DatabaseRecommendAppRetrieval,
                "fetch_recommended_app_detail_from_db",
                return_value={"id": "app-1"},
            ) as mock_fetch,
        ):
            result = DatabaseRecommendAppRetrieval().get_recommend_app_detail("app-1", session=session)

        mock_fetch.assert_called_once_with("app-1", session=session)
        assert result == {"id": "app-1"}
