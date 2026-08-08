import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.inner_api.app import site as module


def test_app_deploy_site_returns_dify_signed_icon_url(app: Flask) -> None:
    api = module.EnterpriseAppDeploySite()
    handler = inspect.unwrap(api.get)
    session = MagicMock()
    session.scalar.side_effect = [SimpleNamespace(id="app-1", tenant_id="tenant-1"), _site()]

    with patch.object(module, "db") as db, patch.object(module, "build_site_icon_url", return_value="signed-icon-url"):
        db.session = session
        with app.test_request_context(headers={"X-AppDeploy-Tenant-ID": "tenant-1"}):
            body, status_code = handler(api, "app-1")

    assert status_code == 200
    assert body["app_id"] == "app-1"
    assert body["icon_url"] == "signed-icon-url"
    assert "apps.tenant_id" in str(session.scalar.call_args_list[0].args[0])
    assert "sites.app_id" in str(session.scalar.call_args_list[1].args[0])


def test_app_deploy_site_rejects_app_outside_tenant(app: Flask) -> None:
    api = module.EnterpriseAppDeploySite()
    handler = inspect.unwrap(api.get)
    session = MagicMock()
    session.scalar.return_value = None

    with patch.object(module, "db") as db:
        db.session = session
        with app.test_request_context(headers={"X-AppDeploy-Tenant-ID": "tenant-1"}):
            with pytest.raises(NotFound):
                handler(api, "another-tenant-app")


def _site() -> SimpleNamespace:
    return SimpleNamespace(
        title="Site title",
        icon_type="image",
        icon="file-id",
        icon_background="#ffffff",
        description="Description",
        copyright="Copyright",
        privacy_policy="Privacy",
        custom_disclaimer="Disclaimer",
        default_language="en-US",
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )
