from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import AccountTrialAppRecord, TrialApp
from services import recommended_app_service as service_module
from services.recommended_app_service import RecommendedAppService

# ── Helpers ────────────────────────────────────────────────────────────


def _apps_response(
    recommended_apps: list[dict] | None = None,
    categories: list[str] | None = None,
) -> dict:
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
    **kwargs: Any,
) -> dict:
    detail: dict[str, Any] = {
        "id": app_id,
        "name": name,
        "description": description,
        "category": kwargs.get("category", "productivity"),
        "icon": kwargs.get("icon", "🚀"),
        "model_config": kwargs.get("model_config", {}),
    }
    detail.update(kwargs)
    return detail


def _recommendation_detail(result: dict[str, Any] | None) -> dict[str, Any] | None:
    return cast("dict[str, Any] | None", result)


def _mock_factory_for_apps(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mode: str,
    result: dict[str, Any],
    fallback_result: dict[str, Any] | None = None,
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


# ── Pure logic tests: get_recommended_apps_and_categories ──────────────


class TestRecommendedAppServiceGetApps:
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_success_with_apps(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        expected = _apps_response()

        mock_instance = MagicMock()
        mock_instance.get_recommended_apps_and_categories.return_value = expected
        mock_factory = MagicMock(return_value=mock_instance)
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        result = RecommendedAppService.get_recommended_apps_and_categories("en-US")

        assert result == expected
        assert len(result["recommended_apps"]) == 2
        assert len(result["categories"]) == 3
        mock_factory_class.get_recommend_app_factory.assert_called_once_with("remote")
        mock_instance.get_recommended_apps_and_categories.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_fallback_to_builtin_when_empty(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        empty_response = {"recommended_apps": [], "categories": []}
        builtin_response = _apps_response(
            recommended_apps=[{"id": "builtin-1", "name": "Builtin App", "category": "default"}]
        )

        mock_remote_instance = MagicMock()
        mock_remote_instance.get_recommended_apps_and_categories.return_value = empty_response
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_remote_instance)

        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        result = RecommendedAppService.get_recommended_apps_and_categories("zh-CN")

        assert result == builtin_response
        assert result["recommended_apps"][0]["id"] == "builtin-1"
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_fallback_when_none_recommended_apps(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "db"
        none_response = {"recommended_apps": None, "categories": ["test"]}
        builtin_response = _apps_response()

        mock_db_instance = MagicMock()
        mock_db_instance.get_recommended_apps_and_categories.return_value = none_response
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_db_instance)

        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        result = RecommendedAppService.get_recommended_apps_and_categories("en-US")

        assert result == builtin_response
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once()

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_different_languages(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "builtin"

        for language in ["en-US", "zh-CN", "ja-JP", "fr-FR"]:
            lang_response = _apps_response(
                recommended_apps=[{"id": f"app-{language}", "name": f"App {language}", "category": "test"}]
            )
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = lang_response
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            result = RecommendedAppService.get_recommended_apps_and_categories(language)

            assert result["recommended_apps"][0]["id"] == f"app-{language}"
            mock_instance.get_recommended_apps_and_categories.assert_called_with(language)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_uses_correct_factory_mode(self, mock_config, mock_factory_class):
        for mode in ["remote", "builtin", "db"]:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode
            response = _apps_response()
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = response
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            RecommendedAppService.get_recommended_apps_and_categories("en-US")

            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)


# ── Pure logic tests: get_recommend_app_detail ─────────────────────────


class TestRecommendedAppServiceGetDetail:
    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_success(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        expected = _app_detail(app_id="app-123", name="Productivity App", description="A great app")

        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = expected
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = _recommendation_detail(RecommendedAppService.get_recommend_app_detail("app-123"))

        assert result == expected
        assert result["id"] == "app-123"
        mock_instance.get_recommend_app_detail.assert_called_once_with("app-123")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_different_modes(self, mock_config, mock_factory_class):
        for mode in ["remote", "builtin", "db"]:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode
            detail = _app_detail(app_id="test-app", name=f"App from {mode}")
            mock_instance = MagicMock()
            mock_instance.get_recommend_app_detail.return_value = detail
            mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

            result = _recommendation_detail(RecommendedAppService.get_recommend_app_detail("test-app"))

            assert result["name"] == f"App from {mode}"
            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_returns_none_when_not_found(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = _recommendation_detail(RecommendedAppService.get_recommend_app_detail("nonexistent"))

        assert result is None
        mock_instance.get_recommend_app_detail.assert_called_once_with("nonexistent")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_returns_empty_dict(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "builtin"
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = {}
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = _recommendation_detail(RecommendedAppService.get_recommend_app_detail("app-empty"))

        assert result == {}

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory", autospec=True)
    @patch("services.recommended_app_service.dify_config", autospec=True)
    def test_complex_model_config(self, mock_config, mock_factory_class):
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        complex_config = {
            "provider": "openai",
            "model": "gpt-4",
            "parameters": {"temperature": 0.7, "max_tokens": 2000, "top_p": 1.0},
        }
        expected = _app_detail(
            app_id="complex-app",
            name="Complex App",
            model_config=complex_config,
            workflows=["workflow-1", "workflow-2"],
            tools=["tool-1", "tool-2", "tool-3"],
        )
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = expected
        mock_factory_class.get_recommend_app_factory.return_value = MagicMock(return_value=mock_instance)

        result = _recommendation_detail(RecommendedAppService.get_recommend_app_detail("complex-app"))

        assert result["model_config"] == complex_config
        assert len(result["workflows"]) == 2
        assert len(result["tools"]) == 3


# ── Integration tests: trial app features (real DB) ────────────────────


class TestRecommendedAppServiceTrialFeatures:
    def test_get_apps_should_not_query_trial_table_when_disabled(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        expected = {"recommended_apps": [{"app_id": "app-1"}], "categories": ["all"]}
        retrieval_instance, builtin_instance = _mock_factory_for_apps(monkeypatch, mode="remote", result=expected)
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=False)),
        )

        result = RecommendedAppService.get_recommended_apps_and_categories("en-US")

        assert result == expected
        retrieval_instance.get_recommended_apps_and_categories.assert_called_once_with("en-US")
        builtin_instance.fetch_recommended_apps_from_builtin.assert_not_called()

    def test_get_apps_should_enrich_can_trial_when_enabled(
        self, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
    ):
        app_id_1 = str(uuid.uuid4())
        app_id_2 = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        # app_id_1 has a TrialApp record; app_id_2 does not
        db_session_with_containers.add(TrialApp(app_id=app_id_1, tenant_id=tenant_id))
        db_session_with_containers.commit()

        remote_result = {"recommended_apps": [], "categories": []}
        fallback_result = {
            "recommended_apps": [{"app_id": app_id_1}, {"app_id": app_id_2}],
            "categories": ["all"],
        }
        _, builtin_instance = _mock_factory_for_apps(
            monkeypatch, mode="remote", result=remote_result, fallback_result=fallback_result
        )
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_system_features",
            MagicMock(return_value=SimpleNamespace(enable_trial_app=True)),
        )

        result = RecommendedAppService.get_recommended_apps_and_categories("ja-JP")

        builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")
        assert result["recommended_apps"][0]["can_trial"] is True
        assert result["recommended_apps"][1]["can_trial"] is False

    @pytest.mark.parametrize("has_trial_app", [True, False])
    def test_get_detail_should_set_can_trial_when_enabled(
        self,
        db_session_with_containers: Session,
        monkeypatch: pytest.MonkeyPatch,
        has_trial_app: bool,
    ):
        app_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        if has_trial_app:
            db_session_with_containers.add(TrialApp(app_id=app_id, tenant_id=tenant_id))
            db_session_with_containers.commit()

        detail = {"id": app_id, "name": "Test App"}
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

        result = cast(dict[str, Any], RecommendedAppService.get_recommend_app_detail(app_id))

        assert result["id"] == app_id
        assert result["can_trial"] is has_trial_app

    def test_get_detail_returns_none_when_not_found_and_trial_enabled(
        self,
        db_session_with_containers: Session,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Regression: accessing result['id'] when result is None must not crash."""
        retrieval_instance = MagicMock()
        retrieval_instance.get_recommend_app_detail.return_value = None
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

        result = RecommendedAppService.get_recommend_app_detail("nonexistent")

        assert result is None
        retrieval_instance.get_recommend_app_detail.assert_called_once_with("nonexistent")

    def test_add_trial_app_record_increments_count_for_existing(self, db_session_with_containers: Session):
        app_id = str(uuid.uuid4())
        account_id = str(uuid.uuid4())

        db_session_with_containers.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=3))
        db_session_with_containers.commit()

        RecommendedAppService.add_trial_app_record(app_id, account_id)

        db_session_with_containers.expire_all()
        record = db_session_with_containers.scalar(
            select(AccountTrialAppRecord)
            .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
            .limit(1)
        )
        assert record is not None
        assert record.count == 4

    def test_add_trial_app_record_creates_new_record(self, db_session_with_containers: Session):
        app_id = str(uuid.uuid4())
        account_id = str(uuid.uuid4())

        RecommendedAppService.add_trial_app_record(app_id, account_id)

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
