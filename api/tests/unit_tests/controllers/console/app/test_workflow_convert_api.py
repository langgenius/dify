"""Unit tests for convert-to-workflow endpoint."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import Flask

from controllers.console.app import workflow as workflow_module


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


class TestConvertToWorkflowApi:
    @pytest.fixture
    def api(self):
        return workflow_module.ConvertToWorkflowApi()

    def test_convert_to_workflow_attaches_permission_keys_when_rbac_enabled(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = _unwrap(api.post)

        monkeypatch.setattr(
            workflow_module,
            "WorkflowService",
            lambda: SimpleNamespace(convert_to_workflow=lambda **_kwargs: SimpleNamespace(id="new-app-1")),
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
            response = method(
                current_tenant_id="tenant-1",
                current_user=SimpleNamespace(id="u1"),
                app_model=SimpleNamespace(id="app-1"),
            )

        assert response["new_app_id"] == "new-app-1"
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
