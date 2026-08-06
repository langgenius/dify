"""Unit tests for database recommendation retrieval delegation."""

import uuid
from unittest.mock import MagicMock, patch

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from models import model as model_module
from models.model import App, AppMode, RecommendedApp, Site
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

    def test_fetch_recommended_apps_uses_only_injected_session(self, sqlite_session: Session) -> None:
        app = App(
            id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            name="Recommended App",
            description="description",
            mode=AppMode.CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=True,
            enable_api=True,
            is_public=True,
            max_active_requests=None,
        )
        site = Site(
            app_id=app.id,
            title="Recommended App",
            description="site description",
            default_language="en-US",
            customize_token_strategy="uuid",
        )
        recommended = RecommendedApp(
            app_id=app.id,
            description={},
            copyright="copyright",
            privacy_policy="privacy",
            category="Workflow",
            categories=["Workflow"],
            language="en-US",
        )
        sqlite_session.add_all([app, site, recommended])
        sqlite_session.commit()
        global_session = MagicMock()
        global_session.scalar.side_effect = AssertionError("database retrieval must use the injected session")

        with patch.object(model_module.db, "session", global_session):
            result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db(
                "en-US",
                session=sqlite_session,
            )

        assert result["recommended_apps"][0]["app"] is app
        assert result["recommended_apps"][0]["description"] == "site description"
        assert result["categories"] == ["Workflow"]
        global_session.scalar.assert_not_called()
