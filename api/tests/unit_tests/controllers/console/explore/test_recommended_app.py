from inspect import unwrap
from unittest.mock import ANY, patch

from flask import Flask

import controllers.console.explore.recommended_app as module
from models import Account
from models.model import AppMode, IconType


def make_account(interface_language: str | None) -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "account-1"
    account.interface_language = interface_language
    return account


class TestRecommendedAppListApi:
    def test_get_with_language_param(self, app: Flask):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/", query_string={"language": "en-US"}),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, make_account("fr-FR"))

        service_mock.assert_called_once_with("en-US", session=ANY)
        assert result == result_data

    def test_get_fallback_to_user_language(self, app: Flask):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/", query_string={"language": "invalid"}),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, make_account("fr-FR"))

        service_mock.assert_called_once_with("fr-FR", session=ANY)
        assert result == result_data

    def test_get_fallback_to_default_language(self, app: Flask):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/"),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, make_account(None))

        service_mock.assert_called_once_with(module.languages[0], session=ANY)
        assert result == result_data


class TestLearnDifyAppListApi:
    def test_get_with_language_param(self, app: Flask):
        api = module.LearnDifyAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": []}

        with (
            app.test_request_context("/", query_string={"language": "en-US"}),
            patch.object(
                module.RecommendedAppService,
                "get_learn_dify_apps",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, make_account("fr-FR"))

        service_mock.assert_called_once_with("en-US", session=ANY)
        assert result == result_data

    def test_get_fallback_to_user_language(self, app: Flask):
        api = module.LearnDifyAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": []}

        with (
            app.test_request_context("/", query_string={"language": "invalid"}),
            patch.object(
                module.RecommendedAppService,
                "get_learn_dify_apps",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, make_account("fr-FR"))

        service_mock.assert_called_once_with("fr-FR", session=ANY)
        assert result == result_data


class TestRecommendedAppApi:
    def test_get_success(self, app: Flask):
        api = module.RecommendedAppApi()
        method = unwrap(api.get)

        result_data = {"id": "app1"}

        with (
            app.test_request_context("/"),
            patch.object(
                module.RecommendedAppService,
                "get_recommend_app_detail",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api, "11111111-1111-1111-1111-111111111111")

        service_mock.assert_called_once_with("11111111-1111-1111-1111-111111111111", session=ANY)
        assert result == result_data


class TestRecommendedAppResponseModels:
    def test_recommended_app_info_response_computes_icon_url(self):
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

    def test_recommended_app_list_response_serialization(self):
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

    def test_learn_dify_app_list_response_serialization(self):
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
                    }
                ],
            }
        ).model_dump(mode="json")

        assert response["recommended_apps"][0]["app_id"] == "app-1"
        assert response["recommended_apps"][0]["categories"] == ["Workflow"]
