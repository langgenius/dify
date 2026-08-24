from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

import controllers.console.explore.recommended_app as module
from models import Account
from models.model import AppMode, IconType
from services.recommended_app_query_service import (
    LearnDifyAppListResult,
    RecommendedAppDetailSummary,
    RecommendedAppInfoRecord,
    RecommendedAppListResult,
    RecommendedAppSummary,
)
from services.recommended_app_query_service import (
    RecommendedAppNotFoundError as RecommendedAppQueryNotFoundError,
)


def make_account(interface_language: str | None) -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "account-1"
    account.interface_language = interface_language
    return account


class TestRecommendedAppListApi:
    def test_get_with_language_param(self, app: Flask) -> None:
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        queries = MagicMock()
        queries.list_recommended.return_value = RecommendedAppListResult(recommended_apps=(), categories=())

        with (
            app.test_request_context("/", query_string={"language": "en-US"}),
            patch.object(
                module,
                "application_services",
                return_value=SimpleNamespace(recommended_app_queries=queries),
            ),
        ):
            result = method(api, module.RecommendedAppsQuery(language="en-US"), make_account("fr-FR"))

        queries.list_recommended.assert_called_once_with(
            requested_language="en-US",
            interface_language="fr-FR",
        )
        assert result == {"recommended_apps": [], "categories": []}


class TestLearnDifyAppListApi:
    def test_get_with_language_param(self, app: Flask) -> None:
        api = module.LearnDifyAppListApi()
        method = unwrap(api.get)

        queries = MagicMock()
        queries.list_learn_dify.return_value = LearnDifyAppListResult(recommended_apps=())

        with (
            app.test_request_context("/", query_string={"language": "en-US"}),
            patch.object(
                module,
                "application_services",
                return_value=SimpleNamespace(recommended_app_queries=queries),
            ),
        ):
            result = method(api, module.RecommendedAppsQuery(language="en-US"), make_account("fr-FR"))

        queries.list_learn_dify.assert_called_once_with(
            requested_language="en-US",
            interface_language="fr-FR",
        )
        assert result == {"recommended_apps": []}


class TestRecommendedAppApi:
    def test_get_success(self, app: Flask) -> None:
        api = module.RecommendedAppApi()
        method = unwrap(api.get)

        queries = MagicMock()
        queries.get_detail.return_value = RecommendedAppDetailSummary(
            id="app1",
            name="App",
            icon=None,
            icon_background=None,
            mode="chat",
            export_data="{}",
            can_trial=False,
        )

        with (
            app.test_request_context("/"),
            patch.object(
                module,
                "application_services",
                return_value=SimpleNamespace(recommended_app_queries=queries),
            ),
        ):
            result = method(api, "11111111-1111-1111-1111-111111111111")

        queries.get_detail.assert_called_once_with("11111111-1111-1111-1111-111111111111")
        assert result == {
            "id": "app1",
            "name": "App",
            "icon": None,
            "icon_background": None,
            "mode": "chat",
            "export_data": "{}",
            "can_trial": False,
        }

    def test_get_missing_raises_stable_not_found_error(self, app: Flask) -> None:
        api = module.RecommendedAppApi()
        method = unwrap(api.get)
        queries = MagicMock()
        queries.get_detail.side_effect = RecommendedAppQueryNotFoundError

        with (
            app.test_request_context("/"),
            patch.object(
                module,
                "application_services",
                return_value=SimpleNamespace(recommended_app_queries=queries),
            ),
        ):
            with pytest.raises(module.RecommendedAppNotFoundError) as exc_info:
                method(api, "11111111-1111-1111-1111-111111111111")

        assert exc_info.value.data == {
            "code": "recommended_app_not_found",
            "message": "Recommended app not found.",
            "status": 404,
        }


class TestRecommendedAppResponseModels:
    def test_query_service_records_serialize_through_controller_contract(self) -> None:
        result = RecommendedAppListResult(
            recommended_apps=(
                RecommendedAppSummary(
                    app=RecommendedAppInfoRecord(
                        id="app-1",
                        name="App",
                        mode="chat",
                        icon=None,
                        icon_type=None,
                        icon_background=None,
                    ),
                    app_id="app-1",
                    description=None,
                    copyright=None,
                    privacy_policy=None,
                    custom_disclaimer=None,
                    categories=("Workflow",),
                    position=1,
                    is_listed=True,
                    can_trial=False,
                ),
            ),
            categories=("Workflow",),
        )

        response = module.dump_response(module.RecommendedAppListResponse, result)

        assert response["recommended_apps"][0]["app"]["id"] == "app-1"
        assert response["recommended_apps"][0]["categories"] == ["Workflow"]

    def test_recommended_app_info_response_computes_icon_url(self) -> None:
        with patch.object(module, "build_icon_url", return_value="https://signed/icon.png"):
            payload = module.RecommendedAppInfoResponse.model_validate(
                {
                    "id": "app-1",
                    "name": "App",
                    "mode": AppMode.CHAT,
                    "icon": "icon.png",
                    "icon_type": IconType.IMAGE,
                    "icon_background": "#fff",
                }
            ).model_dump(mode="json")

        assert payload["icon_url"] == "https://signed/icon.png"

    def test_recommended_app_list_response_serialization(self) -> None:
        response = module.RecommendedAppListResponse.model_validate(
            {
                "recommended_apps": [
                    {
                        "app": {
                            "id": "app-1",
                            "name": "App",
                            "mode": "chat",
                            "icon": "icon.png",
                            "icon_type": "emoji",
                            "icon_background": "#fff",
                        },
                        "app_id": "app-1",
                        "description": "desc",
                        "categories": ["cat", "other"],
                        "position": 1,
                        "is_listed": True,
                        "can_trial": False,
                    }
                ],
                "categories": ["cat"],
            }
        ).model_dump(mode="json")

        assert response["recommended_apps"][0]["app_id"] == "app-1"
        assert response["recommended_apps"][0]["categories"] == ["cat", "other"]
        assert response["categories"] == ["cat"]

    def test_learn_dify_app_list_response_serialization(self) -> None:
        response = module.LearnDifyAppListResponse.model_validate(
            {
                "recommended_apps": [
                    {
                        "app": {
                            "id": "app-1",
                            "name": "App",
                            "mode": "chat",
                            "icon": "icon.png",
                            "icon_type": "emoji",
                            "icon_background": "#fff",
                        },
                        "app_id": "app-1",
                        "description": "desc",
                        "categories": ["Workflow"],
                        "position": 1,
                        "is_listed": True,
                        "can_trial": False,
                    }
                ],
            }
        ).model_dump(mode="json")

        assert response["recommended_apps"][0]["app_id"] == "app-1"
        assert response["recommended_apps"][0]["categories"] == ["Workflow"]

    def test_recommended_app_response_requires_can_trial(self) -> None:
        with pytest.raises(ValidationError):
            module.RecommendedAppResponse.model_validate({"app_id": "app-1"})
