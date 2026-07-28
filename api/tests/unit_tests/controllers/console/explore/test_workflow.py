from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import InternalServerError

from controllers.console.explore.error import NotWorkflowAppError
from controllers.console.explore.workflow import (
    InstalledAppWorkflowRunApi,
    InstalledAppWorkflowTaskStopApi,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import AppMode
from services.errors.llm import InvokeRateLimitError


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def user():
    return MagicMock()


@pytest.fixture
def workflow_app():
    app = MagicMock()
    app.id = "app-1"
    app.tenant_id = "tenant-1"
    app.mode = AppMode.WORKFLOW
    return app


@pytest.fixture
def installed_workflow_app(workflow_app):
    installed_app = MagicMock(app=workflow_app)
    installed_app.app_with_session.return_value = workflow_app
    return installed_app


@pytest.fixture
def non_workflow_installed_app():
    app = MagicMock()
    app.mode = AppMode.CHAT
    installed_app = MagicMock(app=app)
    installed_app.app_with_session.return_value = app
    return installed_app


@pytest.fixture
def payload():
    return {"inputs": {"a": 1}}


class TestInstalledAppWorkflowRunApi:
    def test_not_workflow_app(self, app: Flask, non_workflow_installed_app):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(api, MagicMock(), MagicMock(), non_workflow_installed_app)

    def test_success(self, app: Flask, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                return_value=MagicMock(),
            ) as generate_mock,
        ):
            result = method(api, MagicMock(), user, installed_workflow_app)

            generate_mock.assert_called_once()
            assert generate_mock.call_args.kwargs["user"] is user
            assert result is not None

    def test_rate_limit_error(self, app: Flask, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=InvokeRateLimitError("rate limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, MagicMock(), user, installed_workflow_app)

    def test_unexpected_exception(self, app: Flask, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, MagicMock(), user, installed_workflow_app)


class TestInstalledAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, non_workflow_installed_app):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        with pytest.raises(NotWorkflowAppError):
            method(api, MagicMock(), MagicMock(id="account-1"), non_workflow_installed_app, "task-1")

    def test_success(self, installed_workflow_app):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        current_user = MagicMock(id="account-1")
        with patch("controllers.console.explore.workflow.AppTaskService.stop_task") as stop_task:
            result = method(api, MagicMock(), current_user, installed_workflow_app, "task-1")

            stop_task.assert_called_once_with(
                "task-1",
                InvokeFrom.EXPLORE,
                "account-1",
                AppMode.WORKFLOW,
                tenant_id="tenant-1",
                app_id="app-1",
            )
            assert result == {"result": "success"}
