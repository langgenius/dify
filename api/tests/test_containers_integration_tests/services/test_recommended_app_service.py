from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import TypedDict, Unpack, cast
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import AccountTrialAppRecord, App, AppMode, TrialApp
from services import recommended_app_service as service_module
from services.recommended_app_service import RecommendedAppService

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(TrialApp, AccountTrialAppRecord, App)],
    indirect=True,
)


class RecommendedAppPayload(TypedDict, total=False):
    id: str
    app_id: str
    name: str
    description: str
    category: str
    icon: str
    model_config: object
    workflows: list[str]
    tools: list[str]
    can_trial: bool


class AppsResponse(TypedDict):
    recommended_apps: list[RecommendedAppPayload] | None
    categories: list[str]


class AppDetailKwargs(TypedDict, total=False):
    category: str
    icon: str
    model_config: object
    workflows: list[str]
    tools: list[str]


# ── Helpers ────────────────────────────────────────────────────────────


def _apps_response(
    recommended_apps: list[RecommendedAppPayload] | None = None,
    categories: list[str] | None = None,
) -> AppsResponse:
    if recommended_apps is None:
        recommended_apps = [
            {"id": "app-1", "name": "Test App 1", "description": "d1", "category": "productivity"},
            {"id": "app-2", "name": "Test App 2", "description": "d2", "category": "communication"},
        ]
    if categories is None:
        categories = ["productivity", "communication", "utilities"]
    return {"recommended_apps": recommended_apps, "categories": categories}


def _app_detail(
    app_id: str = "app-123",
    name: str = "Test App",
    description: str = "Test description",
    **kwargs: Unpack[AppDetailKwargs],
) -> RecommendedAppPayload:
    detail = RecommendedAppPayload(
        id=app_id,
        name=name,
        description=description,
        category=kwargs.get("category", "productivity"),
        icon=kwargs.get("icon", "🚀"),
        model_config=kwargs.get("model_config", {}),
    )
    detail.update(**kwargs)
    return detail


def _mock_factory_for_apps(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mode: str,
    result: AppsResponse,
    fallback_result: AppsResponse | None = None,
) -> tuple[MagicMock, MagicMock]:
    retrieval_instance = MagicMock()
    retrieval_instance.get_recommended_apps_and_categories.return_value = result
    retrieval_factory = MagicMock(return_value=retrieval_instance)
    monkeypatch.setattr(service_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", mode, raising=False)
    monkeypatch.setattr(
        service_module.RecommendAppRetrievalFactory,
        "get_recommend_app_factory",
        MagicMock(return_value=retrieval_factory),
    )
    builtin_instance = MagicMock()
    if fallback_result is not None:
        builtin_instance.fetch_recommended_apps_from_builtin.return_value = fallback_result
    monkeypatch.setattr(
        service_module.RecommendAppRetrievalFactory,
        "get_buildin_recommend_app_retrieval",
        MagicMock(return_value=builtin_instance),
    )
    return retrieval_instance, builtin_instance


def _mock_factory_for_app_detail(
    monkeypatch: pytest.MonkeyPatch,
    *,
    result: RecommendedAppPayload | None,
) -> MagicMock:
    retrieval_instance = MagicMock()
    retrieval_instance.get_recommend_app_detail.return_value = result
    retrieval_factory = MagicMock(return_value=retrieval_instance)
    monkeypatch.setattr(service_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote", raising=False)
    monkeypatch.setattr(
        service_module.RecommendAppRetrievalFactory,
        "get_recommend_app_factory",
        MagicMock(return_value=retrieval_factory),
    )
    return retrieval_instance


def _persist_app(session: Session, *, name: str) -> App:
    app = App(
        tenant_id=str(uuid.uuid4()),
        name=name,
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    app.id = str(uuid.uuid4())
    session.add(app)
    session.commit()
    return app


# ── Pure logic tests: get_recommended_apps_and_categories ──────────────


class TestRecommendedAppServiceGetApps:
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_success_with_apps(self, mock_config: MagicMock, mock_factory_class: MagicMock) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        expected = _apps_response()

        mock_instance = MagicMock()
        mock_instance.get_recommended_apps_and_categories.return_value = expected
        mock_factory = MagicMock(return_value=mock_instance)
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        result = RecommendedAppService.get_recommended_apps_and_categories(db.session, "en-US")

        assert result == expected
        assert len(result["recommended_apps"]) == 2
        assert len(result["categories"]) == 3
        mock_factory_class.get_recommend_app_factory.assert_called_once_with("remote")
        mock_instance.get_recommended_apps_and_categories.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_fallback_to_builtin_when_empty(self, mock_config: MagicMock, mock_factory_class: MagicMock) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        empty_response = AppsResponse(recommended_apps=[], categories=[])
        builtin_response = _apps_response(
            recommended_apps=[{"id": "builtin-1", "name": "Builtin App", "category": "default"}]
        )

        mock_remote_instance = MagicMock()
        mock_remote_instance.get_recommended_apps_and_categories.return_value = empty_response
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_remote_instance)

        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        result = RecommendedAppService.get_recommended_apps_and_categories(db.session, "zh-CN")

        assert result == builtin_response
        assert result["recommended_apps"][0]["id"] == "builtin-1"
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_fallback_when_none_recommended_apps(self, mock_config: MagicMock, mock_factory_class: MagicMock) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "db"
        none_response = AppsResponse(recommended_apps=None, categories=["test"])
        builtin_response = _apps_response()

        mock_db_instance = MagicMock()
        mock_db_instance.get_recommended_apps_and_categories.return_value = none_response
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_db_instance)

        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        result = RecommendedAppService.get_recommended_apps_and_categories(db.session, "en-US")

        assert result == builtin_response
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once()

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_different_languages(self, mock_config: MagicMock, mock_factory_class: MagicMock) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "builtin"

        for language in ["en-US", "zh-CN", "ja-JP", "fr-FR"]:
            lang_response = _apps_response(
                recommended_apps=[{"id": f"app-{language}", "name": f"App {language}", "category": "test"}]
            )
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = lang_response
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            result = RecommendedAppService.get_recommended_apps_and_categories(db.session, language)

            assert result["recommended_apps"][0]["id"] == f"app-{language}"
            mock_instance.get_recommended_apps_and_categories.assert_called_with(language)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_uses_correct_factory_mode(self, mock_config: MagicMock, mock_factory_class: MagicMock) -> None:
        for mode in ["remote", "builtin", "db"]:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode
            response = _apps_response()
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = response
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            RecommendedAppService.get_recommended_apps_and_categories(db.session, "en-US")

            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)


# ── Database-backed tests: get_app ─────────────────────────────────────


class TestRecommendedAppServiceGetApp:
    def test_returns_normal_recommended_app(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
        app = _persist_app(sqlite_session, name="Recommended App")

        retrieval_instance = _mock_factory_for_app_detail(
            monkeypatch,
            result=RecommendedAppPayload(id=app.id),
        )
        feature_lookup = MagicMock(side_effect=AssertionError("get_app must not inspect trial features"))
        monkeypatch.setattr(service_module.FeatureService, "get_system_features", feature_lookup)

        result = RecommendedAppService.get_app(app.id, session=sqlite_session)

        assert result is app
        retrieval_instance.get_recommend_app_detail.assert_called_once_with(app.id, session=sqlite_session)
        feature_lookup.assert_not_called()

    def test_returns_none_when_app_is_not_recommended(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        app = _persist_app(sqlite_session, name="Private App")

        retrieval_instance = _mock_factory_for_app_detail(monkeypatch, result=None)

        result = RecommendedAppService.get_app(app.id, session=sqlite_session)

        assert result is None
        retrieval_instance.get_recommend_app_detail.assert_called_once_with(app.id, session=sqlite_session)


# ── Pure logic tests: get_recommend_app_detail ─────────────────────────


class TestRecommendedAppServiceGetDetail:
    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_returns_retrieval_detail_when_trial_disabled(
        self, mock_config: MagicMock, mock_factory_class: MagicMock, mock_feature_service: MagicMock
    ) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_feature_service.get_system_features.return_value = SimpleNamespace(enable_trial_app=False)
        cases: list[tuple[str, RecommendedAppPayload]] = [
            (
                "complex-app",
                _app_detail(
                    app_id="complex-app",
                    name="Complex App",
                    model_config={
                        "provider": "openai",
                        "model": "gpt-4",
                        "parameters": {"temperature": 0.7, "max_tokens": 2000, "top_p": 1.0},
                    },
                    workflows=["workflow-1", "workflow-2"],
                    tools=["tool-1", "tool-2", "tool-3"],
                ),
            ),
            ("app-empty", RecommendedAppPayload()),
        ]

        for app_id, expected in cases:
            mock_instance = MagicMock()
            mock_instance.get_recommend_app_detail.return_value = expected
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            result = RecommendedAppService.get_recommend_app_detail(db.session, app_id)

            assert result == expected
            mock_instance.get_recommend_app_detail.assert_called_once_with(app_id)

    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_different_modes(
        self, mock_config: MagicMock, mock_factory_class: MagicMock, mock_feature_service: MagicMock
    ) -> None:
        mock_feature_service.get_system_features.return_value = SimpleNamespace(enable_trial_app=False)
        for mode in ["remote", "builtin", "db"]:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode
            detail = _app_detail(app_id="test-app", name=f"App from {mode}")
            mock_instance = MagicMock()
            mock_instance.get_recommend_app_detail.return_value = detail
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            result = RecommendedAppService.get_recommend_app_detail(db.session, "test-app")

            assert result is not None
            mock_instance.get_recommend_app_detail.assert_called_with("test-app")
            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)


# ── Pure logic tests: get_learn_dify_apps ──────────────────────────────


class TestRecommendedAppServiceGetLearnDifyApps:
    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_uses_configured_retrieval_source(
        self, mock_config: MagicMock, mock_factory_class: MagicMock, mock_feature_service: MagicMock
    ) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_feature_service.get_system_features.return_value = SimpleNamespace(enable_trial_app=False)
        expected_app = RecommendedAppPayload(app_id="app-1", category="Workflow")
        mock_instance = MagicMock()
        mock_instance.get_learn_dify_apps.return_value = {
            "recommended_apps": [expected_app],
            "categories": ["Workflow"],
        }
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = RecommendedAppService.get_learn_dify_apps(db.session, "en-US")

        assert result == {"recommended_apps": [expected_app]}
        mock_factory_class.get_recommend_app_factory.assert_called_once_with("remote")
        mock_instance.get_learn_dify_apps.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.dify_config")
    def test_sets_can_trial_when_trial_feature_enabled(
        self, mock_config: MagicMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "db"
        app = RecommendedAppPayload(app_id="app-1", category="Workflow")
        mock_retrieval_instance = MagicMock()
        mock_retrieval_instance.get_learn_dify_apps.return_value = {
            "recommended_apps": [app],
            "categories": ["Workflow"],
        }
        mock_retrieval_factory = MagicMock(return_value=mock_retrieval_instance)
        monkeypatch.setattr(
            service_module.RecommendAppRetrievalFactory,
            "get_recommend_app_factory",
            MagicMock(return_value=mock_retrieval_factory),
        )
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=True)),
        )
        can_trial_mock = MagicMock(return_value=True)
        monkeypatch.setattr(RecommendedAppService, "_can_trial_app", can_trial_mock)

        result = RecommendedAppService.get_learn_dify_apps(db.session, "en-US")

        assert result["recommended_apps"][0]["can_trial"] is True
        can_trial_mock.assert_called_once_with(db.session, "app-1")


# ── Integration tests: trial app features (real DB) ────────────────────


class TestRecommendedAppServiceTrialFeatures:
    def test_get_apps_should_not_query_trial_table_when_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        expected = AppsResponse(recommended_apps=[RecommendedAppPayload(app_id="app-1")], categories=["all"])
        retrieval_instance, builtin_instance = _mock_factory_for_apps(monkeypatch, mode="remote", result=expected)
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=False)),
        )

        result = RecommendedAppService.get_recommended_apps_and_categories(db.session, "en-US")

        assert result == expected
        retrieval_instance.get_recommended_apps_and_categories.assert_called_once_with("en-US")
        builtin_instance.fetch_recommended_apps_from_builtin.assert_not_called()

    def test_get_apps_should_enrich_can_trial_when_enabled(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_id_1 = str(uuid.uuid4())
        app_id_2 = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        # app_id_1 has a TrialApp record; app_id_2 does not
        db_session_with_containers.add(TrialApp(app_id=app_id_1, tenant_id=tenant_id))
        db_session_with_containers.commit()

        remote_result = AppsResponse(recommended_apps=[], categories=[])
        fallback_result = AppsResponse(
            recommended_apps=[RecommendedAppPayload(app_id=app_id_1), RecommendedAppPayload(app_id=app_id_2)],
            categories=["all"],
        )
        _, builtin_instance = _mock_factory_for_apps(
            monkeypatch, mode="remote", result=remote_result, fallback_result=fallback_result
        )
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=True)),
        )

        result = RecommendedAppService.get_recommended_apps_and_categories(db.session, "ja-JP")

        builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")
        assert result["recommended_apps"][0]["can_trial"] is True
        assert result["recommended_apps"][1]["can_trial"] is False

    @pytest.mark.parametrize("has_trial_app", [True, False])
    def test_get_detail_should_set_can_trial_when_enabled(
        self,
        db_session_with_containers: Session,
        monkeypatch: pytest.MonkeyPatch,
        has_trial_app: bool,
    ) -> None:
        app_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        if has_trial_app:
            db_session_with_containers.add(TrialApp(app_id=app_id, tenant_id=tenant_id))
            db_session_with_containers.commit()

        detail = RecommendedAppPayload(id=app_id, name="Test App")
        retrieval_instance = MagicMock()
        retrieval_instance.get_recommend_app_detail.return_value = detail
        retrieval_factory = MagicMock(return_value=retrieval_instance)
        monkeypatch.setattr(service_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote", raising=False)
        monkeypatch.setattr(
            service_module.RecommendAppRetrievalFactory,
            "get_recommend_app_factory",
            MagicMock(return_value=retrieval_factory),
        )
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=True)),
        )

        result = RecommendedAppService.get_recommend_app_detail(db.session, app_id)
        assert result is not None
        detail_result = cast(RecommendedAppPayload, result)

        assert detail_result["id"] == app_id
        assert detail_result["can_trial"] is has_trial_app

    @patch("services.recommended_app_service.FeatureService", autospec=True)
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config")
    def test_get_detail_returns_none_before_reading_trial_flag(
        self,
        mock_config: MagicMock,
        mock_factory_class: MagicMock,
        mock_feature_service: MagicMock,
    ) -> None:
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = RecommendedAppService.get_recommend_app_detail(db.session, "nonexistent")

        assert result is None
        mock_instance.get_recommend_app_detail.assert_called_once_with("nonexistent")
        mock_feature_service.get_system_features.assert_not_called()

    def test_add_trial_app_record_increments_count_for_existing(self, db_session_with_containers: Session) -> None:
        app_id = str(uuid.uuid4())
        account_id = str(uuid.uuid4())

        db_session_with_containers.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=3))
        db_session_with_containers.commit()

        RecommendedAppService.add_trial_app_record(db.session, app_id, account_id)

        db_session_with_containers.expire_all()
        record = db_session_with_containers.scalar(
            select(AccountTrialAppRecord)
            .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
            .limit(1)
        )
        assert record is not None
        assert record.count == 4

    def test_add_trial_app_record_creates_new_record(self, db_session_with_containers: Session) -> None:
        app_id = str(uuid.uuid4())
        account_id = str(uuid.uuid4())

        RecommendedAppService.add_trial_app_record(db.session, app_id, account_id)

        db_session_with_containers.expire_all()
        record = db_session_with_containers.scalar(
            select(AccountTrialAppRecord)
            .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
            .limit(1)
        )
        assert record is not None
        assert record.app_id == app_id
        assert record.account_id == account_id
        assert record.count == 1
