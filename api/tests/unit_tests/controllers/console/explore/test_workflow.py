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
from models.model import AppMode
from services.errors.llm import InvokeRateLimitError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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
    app.mode = AppMode.WORKFLOW
    return app


@pytest.fixture
def installed_workflow_app(workflow_app):
    return MagicMock(app=workflow_app)


@pytest.fixture
def non_workflow_installed_app():
    app = MagicMock()
    app.mode = AppMode.CHAT
    return MagicMock(app=app)


@pytest.fixture
def payload():
    return {"inputs": {"a": 1}}


class TestInstalledAppWorkflowRunApi:
    def test_not_workflow_app(self, app, non_workflow_installed_app):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.explore.workflow.current_account_with_tenant",
                return_value=(MagicMock(), None),
            ),
        ):
            with pytest.raises(NotWorkflowAppError):
                method(non_workflow_installed_app)

    def test_success(self, app, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.current_account_with_tenant",
                return_value=(user, None),
            ),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                return_value=MagicMock(),
            ) as generate_mock,
        ):
            result = method(installed_workflow_app)

            generate_mock.assert_called_once()
            assert result is not None

    def test_rate_limit_error(self, app, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.current_account_with_tenant",
                return_value=(user, None),
            ),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=InvokeRateLimitError("rate limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(installed_workflow_app)

    def test_unexpected_exception(self, app, installed_workflow_app, user, payload):
        api = InstalledAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.explore.workflow.current_account_with_tenant",
                return_value=(user, None),
            ),
            patch(
                "controllers.console.explore.workflow.AppGenerateService.generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(installed_workflow_app)


class TestInstalledAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, non_workflow_installed_app):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        with pytest.raises(NotWorkflowAppError):
            method(non_workflow_installed_app, "task-1")

    def test_success(self, installed_workflow_app):
        api = InstalledAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        with (
            patch("controllers.console.explore.workflow.AppQueueManager.set_stop_flag_no_user_check") as stop_flag,
            patch("controllers.console.explore.workflow.GraphEngineManager.send_stop_command") as send_stop,
        ):
            result = method(installed_workflow_app, "task-1")

            stop_flag.assert_called_once_with("task-1")
            send_stop.assert_called_once_with("task-1")
            assert result == {"result": "success"}
