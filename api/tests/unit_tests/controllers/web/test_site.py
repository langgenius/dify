from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Blueprint, Flask
from werkzeug.exceptions import Forbidden, ServiceUnavailable

from controllers.common.app_access_error import register_app_access_error_metadata
from controllers.web import site as site_module
from controllers.web.error import WebAppNotFoundError
from libs.external_api import ExternalApi
from services.app_definition_query_service import AppSiteConfiguration
from services.web_app_runtime_query_service import (
    WebAppBootstrap,
    WebAppRuntimeUnavailableError,
)


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


def test_app_site_api_maps_unavailable_runtime_to_app_not_found() -> None:
    web_app_runtime = MagicMock()
    web_app_runtime.get_bootstrap.side_effect = WebAppRuntimeUnavailableError

    with (
        patch.object(
            site_module,
            "application_services",
            return_value=SimpleNamespace(web_app_runtime=web_app_runtime),
        ),
        pytest.raises(WebAppNotFoundError),
    ):
        site_module.AppSiteApi().get(MagicMock(id="app-id"), MagicMock(id="end-user-id"))


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (WebAppRuntimeUnavailableError("Site not found"), 404),
        (ServiceUnavailable("dependency unavailable"), 503),
        (Forbidden("business permission denied"), 403),
        (RuntimeError("programming bug"), 500),
    ],
)
def test_site_final_response_only_reclassifies_terminal_runtime_failure(
    failure: Exception, status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    from configs import dify_config
    from controllers.web import wraps

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    bp = Blueprint("site_fixture", __name__, url_prefix="/api")
    register_app_access_error_metadata(bp, surface="web")
    api = ExternalApi(bp)
    api.add_resource(site_module.AppSiteApi, "/site")
    app.register_blueprint(bp)
    runtime = MagicMock()
    runtime.get_bootstrap.side_effect = failure
    monkeypatch.setattr(site_module, "application_services", lambda: SimpleNamespace(web_app_runtime=runtime))
    monkeypatch.setattr(
        wraps,
        "decode_jwt_token",
        lambda: (
            SimpleNamespace(id="fixture-app"),
            SimpleNamespace(id="fixture-user", tenant_id="fixture-tenant", type="browser"),
        ),
    )
    monkeypatch.setattr(dify_config, "NETWORK_ACCESS_TRUSTED_PROXY_CIDRS", "172.18.0.0/16")
    response = app.test_client().get("/api/site", environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    assert response.status_code == status
    if status == 404:
        assert (
            response.data
            == b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
        )
        assert response.headers["Content-Type"] == "application/json"
        assert response.headers["Cache-Control"] == "no-store"
    else:
        assert response.get_json()["code"] != "app_not_found"
        assert "client_ip" not in response.get_json()
