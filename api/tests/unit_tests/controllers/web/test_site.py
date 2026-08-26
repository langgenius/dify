from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.web import site as site_module
from services.app_definition_query_service import AppSiteConfiguration
from services.web_app_runtime_query_service import WebAppBootstrap, WebAppRuntimeUnavailableError


def _bootstrap() -> WebAppBootstrap:
    site = AppSiteConfiguration(
        title="Test Site",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        icon_type="image",
        icon="file-1",
        icon_background="#ffffff",
        description="Description",
        copyright="Copyright",
        privacy_policy="Privacy",
        input_placeholder="Ask anything",
        custom_disclaimer="Disclaimer",
        default_language="en-US",
        prompt_public=True,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )
    return WebAppBootstrap(
        app_id="app-id",
        mode="agent-chat",
        enable_site=True,
        site={**site._asdict(), "icon_url": "https://files.example.com/icon.png"},
        plan="pro",
        can_replace_logo=True,
        custom_config={
            "remove_webapp_brand": True,
            "replace_webapp_logo": "https://files.example.com/files/workspaces/tenant-id/webapp-logo",
        },
    )


def test_app_site_api_queries_the_admitted_app_runtime() -> None:
    app_model = MagicMock(id="app-id")
    end_user = MagicMock(id="end-user-id")
    web_app_runtime = MagicMock()
    web_app_runtime.get_bootstrap.return_value = _bootstrap()

    with patch.object(
        site_module,
        "application_services",
        return_value=SimpleNamespace(web_app_runtime=web_app_runtime),
    ):
        result = site_module.AppSiteApi().get(app_model, end_user)

    assert result["app_id"] == "app-id"
    assert result["mode"] == "agent-chat"
    assert result["end_user_id"] == "end-user-id"
    assert result["site"]["prompt_public"] is True
    assert result["site"]["icon_url"] == "https://files.example.com/icon.png"
    assert result["model_config"] is None
    assert result["custom_config"] == {
        "remove_webapp_brand": True,
        "replace_webapp_logo": "https://files.example.com/files/workspaces/tenant-id/webapp-logo",
    }
    web_app_runtime.get_bootstrap.assert_called_once_with("app-id")


def test_app_site_api_maps_unavailable_runtime_to_forbidden() -> None:
    web_app_runtime = MagicMock()
    web_app_runtime.get_bootstrap.side_effect = WebAppRuntimeUnavailableError

    with (
        patch.object(
            site_module,
            "application_services",
            return_value=SimpleNamespace(web_app_runtime=web_app_runtime),
        ),
        pytest.raises(Forbidden),
    ):
        site_module.AppSiteApi().get(MagicMock(id="app-id"), MagicMock(id="end-user-id"))
