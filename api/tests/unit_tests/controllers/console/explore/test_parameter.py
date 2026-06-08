from unittest.mock import MagicMock, patch

import pytest

import controllers.console.explore.parameter as module
from controllers.console.app.error import AppUnavailableError
from models.model import AppMode


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestAppParameterApi:
    def test_get_app_none(self):
        api = module.AppParameterApi()
        method = unwrap(api.get)

        installed_app = MagicMock(app=None)

        with pytest.raises(AppUnavailableError):
            method(installed_app)

    def test_get_advanced_chat_workflow(self):
        api = module.AppParameterApi()
        method = unwrap(api.get)

        workflow = MagicMock()
        workflow.features_dict = {"f": "v"}
        workflow.user_input_form.return_value = [{"name": "x"}]

        app = MagicMock(
            mode=AppMode.ADVANCED_CHAT,
            workflow=workflow,
        )

        installed_app = MagicMock(app=app)

        with (
            patch.object(
                module,
                "get_parameters_from_feature_dict",
                return_value={"any": "thing"},
            ),
            patch.object(
                module.fields.Parameters,
                "model_validate",
                return_value=MagicMock(model_dump=lambda **_: {"ok": True}),
            ),
        ):
            result = method(installed_app)

        assert result == {"ok": True}

    def test_get_advanced_chat_workflow_missing(self):
        api = module.AppParameterApi()
        method = unwrap(api.get)

        app = MagicMock(
            mode=AppMode.ADVANCED_CHAT,
            workflow=None,
        )

        installed_app = MagicMock(app=app)

        with pytest.raises(AppUnavailableError):
            method(installed_app)

    def test_get_non_workflow_app(self):
        api = module.AppParameterApi()
        method = unwrap(api.get)

        app_model_config = MagicMock()
        app_model_config.to_dict.return_value = {"user_input_form": [{"name": "y"}]}

        app = MagicMock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        installed_app = MagicMock(app=app)

        with (
            patch.object(
                module,
                "get_parameters_from_feature_dict",
                return_value={"whatever": 123},
            ),
            patch.object(
                module.fields.Parameters,
                "model_validate",
                return_value=MagicMock(model_dump=lambda **_: {"ok": True}),
            ),
        ):
            result = method(installed_app)

        assert result == {"ok": True}

    def test_get_non_workflow_missing_config(self):
        api = module.AppParameterApi()
        method = unwrap(api.get)

        app = MagicMock(
            mode=AppMode.CHAT,
            app_model_config=None,
        )

        installed_app = MagicMock(app=app)

        with pytest.raises(AppUnavailableError):
            method(installed_app)


class TestExploreAppMetaApi:
    def test_get_meta_success(self):
        api = module.ExploreAppMetaApi()
        method = unwrap(api.get)

        app = MagicMock()
        installed_app = MagicMock(app=app)

        with patch.object(
            module.AppService,
            "get_app_meta",
            return_value={"meta": "ok"},
        ):
            result = method(installed_app)

        assert result == {"meta": "ok"}

    def test_get_meta_app_missing(self):
        api = module.ExploreAppMetaApi()
        method = unwrap(api.get)

        installed_app = MagicMock(app=None)

        with pytest.raises(ValueError):
            method(installed_app)
