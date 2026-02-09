from unittest.mock import MagicMock, patch

import controllers.console.explore.recommended_app as module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestRecommendedAppListApi:
    def test_get_with_language_param(self, app):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/", query_string={"language": "en-US"}),
            patch.object(module, "current_user", MagicMock(interface_language="fr-FR")),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api)

        service_mock.assert_called_once_with("en-US")
        assert result == result_data

    def test_get_fallback_to_user_language(self, app):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/", query_string={"language": "invalid"}),
            patch.object(module, "current_user", MagicMock(interface_language="fr-FR")),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api)

        service_mock.assert_called_once_with("fr-FR")
        assert result == result_data

    def test_get_fallback_to_default_language(self, app):
        api = module.RecommendedAppListApi()
        method = unwrap(api.get)

        result_data = {"recommended_apps": [], "categories": []}

        with (
            app.test_request_context("/"),
            patch.object(module, "current_user", MagicMock(interface_language=None)),
            patch.object(
                module.RecommendedAppService,
                "get_recommended_apps_and_categories",
                return_value=result_data,
            ) as service_mock,
        ):
            result = method(api)

        service_mock.assert_called_once_with(module.languages[0])
        assert result == result_data


class TestRecommendedAppApi:
    def test_get_success(self, app):
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

        service_mock.assert_called_once_with("11111111-1111-1111-1111-111111111111")
        assert result == result_data
