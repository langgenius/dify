from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.app_run import AppRunTaskStopApi
from models import Account, App
from services.app_service import AppService, CreateAppParams
from tests.test_containers_integration_tests.controllers.openapi.conftest import auth_for


def _create_app(db_session: Session, account: Account, *, name: str = "Runner") -> App:
    tenant = account.current_tenant
    assert tenant is not None
    params = CreateAppParams(
        name=name,
        description="",
        mode="workflow",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FF6B6B",
    )
    app_model = AppService().create_app(tenant.id, params, account)
    db_session.commit()
    return app_model


class TestAppRunTaskStop:
    def test_task_stop_returns_success(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        app_model = _create_app(db_session_with_containers, account)
        task_id = str(uuid4())

        api = AppRunTaskStopApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}/tasks/{task_id}/stop", method="POST"):
            result = unwrap(api.post)(
                api,
                app_id=app_model.id,
                task_id=task_id,
                auth_data=auth_for(account, app_model=app_model, caller_kind="account"),
            )

        assert result.result == "success"
