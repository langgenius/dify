"""Unit tests for convert-to-workflow endpoint."""

from __future__ import annotations

from inspect import unwrap

import pytest
from flask import Flask

from controllers.console.app import workflow as workflow_module
from controllers.console.app.workflow import ConvertToWorkflowApi
from models import Account, App, AppMode
from models.model import IconType


def _app(app_id: str) -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name=f"App {app_id}",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


class TestConvertToWorkflowApi:
    @pytest.fixture
    def api(self):
        return workflow_module.ConvertToWorkflowApi()

    def test_convert_to_workflow_attaches_permission_keys_when_rbac_enabled(
        self, api: ConvertToWorkflowApi, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = unwrap(api.post)
        new_app = _app("new-app-1")

        monkeypatch.setattr(
            workflow_module,
            "WorkflowService",
            lambda: type("WorkflowServiceStub", (), {"convert_to_workflow": lambda self, **_kwargs: new_app})(),
        )
        monkeypatch.setattr(
            workflow_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context(
            "/console/api/apps/app-1/convert-to-workflow",
            method="POST",
            json={},
        ):
            current_user = Account(name="Current user", email="user@example.com")
            current_user.id = "u1"
            response = method(
                api,
                current_tenant_id="tenant-1",
                current_user=current_user,
                app_model=_app("app-1"),
            )

        assert response["new_app_id"] == "new-app-1"
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
