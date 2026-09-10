from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError

from controllers.common.controller_schemas import WorkflowRunPayload
from controllers.console.explore.error import NotWorkflowAppError
from controllers.console.explore.workflow import (
    InstalledAppWorkflowRunApi,
    InstalledAppWorkflowTaskStopApi,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models import Account
from models.model import App, AppMode, InstalledApp
from services.errors.llm import InvokeRateLimitError


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def make_installed_app(session: Session, *, mode: AppMode) -> InstalledApp:
    app = App(
        tenant_id="owner-tenant",
        name="Explore App",
        mode=mode,
        enable_site=True,
        enable_api=False,
    )
    session.add(app)
    session.flush()
    installed_app = InstalledApp(
        tenant_id="viewer-tenant",
        app_id=app.id,
        app_owner_tenant_id=app.tenant_id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.commit()
    return installed_app


@pytest.fixture
def payload():
    return {"inputs": {"a": 1}}


class TestInstalledAppWorkflowRunApi:
    def test_not_workflow_app(self, app: Flask, sqlite_session: Session):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.CHAT)
        user = Account(name="User", email="user@example.com")

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(
                    api,
                    WorkflowRunPayload.model_validate({"inputs": {}}),
                    sqlite_session,
                    user,
                    installed_app,
                )

    def test_success(self, app: Flask, sqlite_session: Session, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)
        req_data = WorkflowRunPayload.model_validate(payload)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.WORKFLOW)
        user = Account(name="User", email="user@example.com")

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                return_value=MagicMock(),
            ) as generate_mock,
        ):
            result = method(api, req_data, sqlite_session, user, installed_app)

            generate_mock.assert_called_once()
            assert generate_mock.call_args.kwargs["user"] is user
            assert result is not None

    def test_rate_limit_error(self, app: Flask, sqlite_session: Session, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)
        req_data = WorkflowRunPayload.model_validate(payload)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.WORKFLOW)
        user = Account(name="User", email="user@example.com")

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=InvokeRateLimitError("rate limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, req_data, sqlite_session, user, installed_app)

    def test_unexpected_exception(self, app: Flask, sqlite_session: Session, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)
        req_data = WorkflowRunPayload.model_validate(payload)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.WORKFLOW)
        user = Account(name="User", email="user@example.com")

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, req_data, sqlite_session, user, installed_app)


class TestInstalledAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, sqlite_session: Session):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.CHAT)

        with pytest.raises(NotWorkflowAppError):
            method(api, sqlite_session, installed_app, "task-1")

    def test_success(self, sqlite_session: Session):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)
        installed_app = make_installed_app(sqlite_session, mode=AppMode.WORKFLOW)

        with (
            patch("controllers.console.explore.workflow.AppQueueManager.set_stop_flag_no_user_check") as stop_flag,
            patch("controllers.console.explore.workflow.GraphEngineManager.send_stop_command") as send_stop,
        ):
            result = method(api, sqlite_session, installed_app, "task-1")

            stop_flag.assert_called_once_with("task-1")
            send_stop.assert_called_once_with("task-1")
            assert result == {"result": "success"}
