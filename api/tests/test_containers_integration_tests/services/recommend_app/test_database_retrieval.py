from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from models.model import App, RecommendedApp, Site
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_type import RecommendAppType


def _create_app(db_session, *, tenant_id: str, is_public: bool = True) -> App:
    app = App(
        tenant_id=tenant_id,
        name=f"app-{uuid4()}",
        mode="chat",
        enable_site=True,
        enable_api=True,
        is_public=is_public,
    )
    app.id = str(uuid4())
    db_session.add(app)
    db_session.commit()
    return app


def _create_site(db_session, *, app_id: str) -> Site:
    site = Site(
        app_id=app_id,
        title=f"site-{uuid4()}",
        default_language="en-US",
        customize_token_strategy="not_allow",
        description="desc",
        copyright="copy",
        privacy_policy="pp",
        custom_disclaimer="cd",
    )
    site.id = str(uuid4())
    db_session.add(site)
    db_session.commit()
    return site


def _create_recommended_app(
    db_session,
    *,
    app_id: str,
    category: str = "chat",
    language: str = "en-US",
    is_listed: bool = True,
    position: int = 1,
) -> RecommendedApp:
    rec = RecommendedApp(
        app_id=app_id,
        description={"en-US": "test"},
        copyright="copy",
        privacy_policy="pp",
        category=category,
        language=language,
        is_listed=is_listed,
        position=position,
    )
    rec.id = str(uuid4())
    db_session.add(rec)
    db_session.commit()
    return rec


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
    def test_returns_apps_and_sorted_categories(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id)
        _create_site(db_session_with_containers, app_id=app1.id)
        _create_recommended_app(db_session_with_containers, app_id=app1.id, category="writing")

        app2 = _create_app(db_session_with_containers, tenant_id=tenant_id)
        _create_site(db_session_with_containers, app_id=app2.id)
        _create_recommended_app(db_session_with_containers, app_id=app2.id, category="assistant")

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        app_ids = {r["app_id"] for r in result["recommended_apps"]}
        assert app1.id in app_ids
        assert app2.id in app_ids
        assert "assistant" in result["categories"]
        assert "writing" in result["categories"]

    def test_falls_back_to_default_language_when_empty(
        self, flask_app_with_containers, db_session_with_containers: Session
    ):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id)
        _create_site(db_session_with_containers, app_id=app1.id)
        _create_recommended_app(db_session_with_containers, app_id=app1.id, language="en-US")

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("fr-FR")

        app_ids = {r["app_id"] for r in result["recommended_apps"]}
        assert app1.id in app_ids

    def test_skips_non_public_apps(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id, is_public=False)
        _create_site(db_session_with_containers, app_id=app1.id)
        _create_recommended_app(db_session_with_containers, app_id=app1.id)

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        app_ids = {r["app_id"] for r in result["recommended_apps"]}
        assert app1.id not in app_ids

    def test_skips_apps_without_site(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id)
        _create_recommended_app(db_session_with_containers, app_id=app1.id)

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_apps_from_db("en-US")

        app_ids = {r["app_id"] for r in result["recommended_apps"]}
        assert app1.id not in app_ids


class TestFetchRecommendedAppDetailFromDb:
    def test_returns_none_when_not_listed(self, flask_app_with_containers, db_session_with_containers: Session):
        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db(str(uuid4()))

        assert result is None

    def test_returns_none_when_app_not_public(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id, is_public=False)
        _create_recommended_app(db_session_with_containers, app_id=app1.id)

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db(app1.id)

        assert result is None

    @patch("services.recommend_app.database.database_retrieval.AppDslService")
    def test_returns_detail_on_success(self, mock_dsl, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        app1 = _create_app(db_session_with_containers, tenant_id=tenant_id)
        _create_site(db_session_with_containers, app_id=app1.id)
        _create_recommended_app(db_session_with_containers, app_id=app1.id)
        mock_dsl.export_dsl.return_value = "exported_yaml"

        db_session_with_containers.expire_all()

        result = DatabaseRecommendAppRetrieval.fetch_recommended_app_detail_from_db(app1.id)

        assert result is not None
        assert result["id"] == app1.id
        assert result["export_data"] == "exported_yaml"
