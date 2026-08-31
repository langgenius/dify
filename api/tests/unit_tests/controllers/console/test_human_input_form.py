from __future__ import annotations

import json
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest
from flask import Flask, Response
from sqlalchemy import Engine

from controllers.common.errors import NotFoundError
from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.console import human_input_form as human_input_form_module
from controllers.console.human_input_form import (
    ConsoleHumanInputFormApi,
    ConsoleWorkflowEventsApi,
    DifyAPIRepositoryFactory,
    WorkflowResponseConverter,
    _jsonify_form_definition,
)
from core.workflow.human_input_policy import HumanInputSurface
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Account
from models.account import AccountStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import RecipientType
from models.model import App, AppMode
from models.workflow import WorkflowRun
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture(autouse=True)
def bind_console_human_input_database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """Bind controller-owned service factories to the isolated SQLite engine."""
    monkeypatch.setattr(human_input_form_module, "db", SimpleNamespace(engine=sqlite_engine))


def _account(*, account_id: str = "user-1") -> Account:
    account = Account(name="Console User", email=f"{account_id}@example.com", status=AccountStatus.ACTIVE)
    account.id = account_id
    return account


def _app() -> App:
    return App(
        id="app-1",
        tenant_id="t1",
        name="Human Input App",
        description="",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _workflow_run(
    *,
    created_by_role: CreatorUserRole = CreatorUserRole.ACCOUNT,
    created_by: str = "user-1",
    finished_at: datetime | None = None,
) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="t1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED if finished_at else WorkflowExecutionStatus.RUNNING,
        created_by_role=created_by_role,
        created_by=created_by,
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
        finished_at=finished_at,
    )


def test_jsonify_form_definition() -> None:
    expiration = datetime(2024, 1, 1, tzinfo=UTC)
    definition = SimpleNamespace(model_dump=lambda: {"fields": []})
    form = SimpleNamespace(get_definition=lambda: definition, expiration_time=expiration)

    response = _jsonify_form_definition(form)

    assert isinstance(response, Response)
    payload = json.loads(response.get_data(as_text=True))
    assert payload["expiration_time"] == int(expiration.timestamp())


def test_ensure_console_access_rejects(monkeypatch: pytest.MonkeyPatch) -> None:
    form = SimpleNamespace(tenant_id="tenant-1")

    with pytest.raises(NotFoundError):
        ConsoleHumanInputFormApi._ensure_console_access(form, "tenant-2")


def test_get_form_definition_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    expiration = datetime(2024, 1, 1, tzinfo=UTC)
    definition = SimpleNamespace(model_dump=lambda: {"fields": ["a"]})
    form = SimpleNamespace(tenant_id="tenant-1", get_definition=lambda: definition, expiration_time=expiration)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_definition_by_token_for_console(self, _token):
            return form

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)

    api = ConsoleHumanInputFormApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/form/human_input/token", method="GET"):
        response = handler(api, "tenant-1", form_token="token")

    payload = json.loads(response.get_data(as_text=True))
    assert payload["fields"] == ["a"]


def test_get_form_definition_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_definition_by_token_for_console(self, _token):
            return None

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)

    api = ConsoleHumanInputFormApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/form/human_input/token", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "tenant-1", form_token="token")


def test_post_form_invalid_recipient_type(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.EMAIL_MEMBER)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_by_token(self, _token):
            return form

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)

    api = ConsoleHumanInputFormApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        with pytest.raises(NotFoundError):
            handler(
                api,
                HumanInputFormSubmitPayload.model_validate({"inputs": {"content": "ok"}, "action": "approve"}),
                "tenant-1",
                _account(),
                form_token="token",
            )


def test_post_form_rejects_webapp_recipient_type(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.STANDALONE_WEB_APP)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_by_token(self, _token):
            return form

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)

    api = ConsoleHumanInputFormApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        with pytest.raises(NotFoundError):
            handler(
                api,
                HumanInputFormSubmitPayload.model_validate({"inputs": {"content": "ok"}, "action": "approve"}),
                "tenant-1",
                _account(),
                form_token="token",
            )


def test_post_form_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    submit_mock = Mock()
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.CONSOLE)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_by_token(self, _token):
            return form

        def submit_form_by_token(self, **kwargs):
            submit_mock(**kwargs)

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)

    api = ConsoleHumanInputFormApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        response = handler(
            api,
            HumanInputFormSubmitPayload.model_validate({"inputs": {"content": "ok"}, "action": "approve"}),
            "tenant-1",
            _account(),
            form_token="token",
        )

    assert response.get_json() == {}
    submit_mock.assert_called_once()


def test_post_form_decorated_success_validates_request_body(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    submit_mock = Mock()
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.CONSOLE)
    current_user = _account()

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_by_token(self, _token):
            return form

        def submit_form_by_token(self, **kwargs):
            submit_mock(**kwargs)

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: (current_user, "tenant-1"),
    )
    apply_config_overrides(monkeypatch, LOGIN_DISABLED=True)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        response = ConsoleHumanInputFormApi().post(form_token="token")

    assert response.get_json() == {}
    submit_mock.assert_called_once_with(
        recipient_type=RecipientType.CONSOLE,
        form_token="token",
        selected_action_id="approve",
        form_data={"content": "ok"},
        submission_user_id="user-1",
    )


def test_workflow_events_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return None

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", _account(account_id="u1"), workflow_run_id="run-1")


def test_workflow_events_requires_account(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = _workflow_run(created_by_role=CreatorUserRole.END_USER)

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", _account(account_id="u1"), workflow_run_id="run-1")


def test_workflow_events_requires_creator(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = _workflow_run(created_by="user-2")

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", _account(account_id="u1"), workflow_run_id="run-1")


def test_workflow_events_finished(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = _workflow_run(finished_at=datetime(2024, 1, 1, tzinfo=UTC))
    app_model = _app()

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    response_obj = SimpleNamespace(
        event=SimpleNamespace(value="finished"),
        model_dump=lambda mode="json": {"status": "done"},
    )

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form._retrieve_app_for_workflow_run",
        lambda *_args, **_kwargs: app_model,
    )
    monkeypatch.setattr(
        WorkflowResponseConverter,
        "workflow_run_result_to_finish_response",
        lambda **_kwargs: response_obj,
    )

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        response = handler(api, "t1", _account(), workflow_run_id="run-1")

    assert response.mimetype == "text/event-stream"
    assert "data" in response.get_data(as_text=True)


def test_workflow_events_snapshot_can_continue_across_pauses(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = _workflow_run()
    app_model = _app()

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    workflow_generator = Mock()
    workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
    snapshot_builder = Mock(return_value=["snapshot-events"])

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form._retrieve_app_for_workflow_run",
        lambda *_args, **_kwargs: app_model,
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form.WorkflowAppGenerator",
        lambda: workflow_generator,
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form.build_workflow_event_stream",
        snapshot_builder,
    )

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context(
        "/console/api/workflow/run-1/events?include_state_snapshot=true&continue_on_pause=true",
        method="GET",
    ):
        response = handler(api, "t1", _account(), workflow_run_id="run-1")

    assert response.get_data(as_text=True) == "data: snapshot\n\n"
    snapshot_builder.assert_called_once_with(
        app_mode=AppMode.WORKFLOW,
        workflow_run=workflow_run,
        tenant_id="t1",
        app_id="app-1",
        session_maker=ANY,
        human_input_surface=HumanInputSurface.CONSOLE,
        close_on_pause=False,
    )
