from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi._errors import RunNotFound
from controllers.openapi.app_run import AppRunStopApi
from models import Account, App
from services.app_service import AppService, CreateAppParams
from tests.test_containers_integration_tests.controllers.openapi.conftest import context_for


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
    app_model = AppService().create_app(tenant.id, params, account, session=db_session)
    db_session.commit()
    return app_model


class TestAppRunStop:
    def test_run_stop_rejects_an_unknown_run(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        app_model = _create_app(db_session_with_containers, account)
        run_id = str(uuid4())

        api = AppRunStopApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}/runs/{run_id}:stop", method="POST"):
            with pytest.raises(RunNotFound):
                api.post.__handler__(
                    api,
                    context_for(
                        account,
                        session=db_session_with_containers,
                        view_args={"app_id": app_model.id, "run_id": run_id},
                    ),
                    app_model.id,
                    run_id,
                )
