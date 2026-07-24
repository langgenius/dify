from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Response

from controllers.console.human_input_form import (
    ConsoleHumanInputFormApi,
    ConsoleWorkflowEventsApi,
    DifyAPIRepositoryFactory,
    WorkflowResponseConverter,
    _jsonify_form_definition,
)
from controllers.web.error import NotFoundError
from models.enums import CreatorUserRole
from models.human_input import RecipientType
from models.model import AppMode


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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
    monkeypatch.setattr("controllers.console.human_input_form.current_account_with_tenant", lambda: (None, "tenant-2"))

    with pytest.raises(NotFoundError):
        ConsoleHumanInputFormApi._ensure_console_access(form)


def test_get_form_definition_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    expiration = datetime(2024, 1, 1, tzinfo=UTC)
    definition = SimpleNamespace(model_dump=lambda: {"fields": ["a"]})
    form = SimpleNamespace(tenant_id="tenant-1", get_definition=lambda: definition, expiration_time=expiration)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_definition_by_token_for_console(self, _token):
            return form

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)
    monkeypatch.setattr("controllers.console.human_input_form.current_account_with_tenant", lambda: (None, "tenant-1"))
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleHumanInputFormApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/form/human_input/token", method="GET"):
        response = handler(api, form_token="token")

    payload = json.loads(response.get_data(as_text=True))
    assert payload["fields"] == ["a"]


def test_get_form_definition_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_definition_by_token_for_console(self, _token):
            return None

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)
    monkeypatch.setattr("controllers.console.human_input_form.current_account_with_tenant", lambda: (None, "tenant-1"))
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleHumanInputFormApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/form/human_input/token", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, form_token="token")


def test_post_form_invalid_recipient_type(app, monkeypatch: pytest.MonkeyPatch) -> None:
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.EMAIL_MEMBER)

    class _ServiceStub:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_form_by_token(self, _token):
            return form

    monkeypatch.setattr("controllers.console.human_input_form.HumanInputService", _ServiceStub)
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="user-1"), "tenant-1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleHumanInputFormApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        with pytest.raises(NotFoundError):
            handler(api, form_token="token")


def test_post_form_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="user-1"), "tenant-1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleHumanInputFormApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/console/api/form/human_input/token",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        response = handler(api, form_token="token")

    assert response.get_json() == {}
    submit_mock.assert_called_once()


def test_workflow_events_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return None

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="u1"), "t1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, workflow_run_id="run-1")


def test_workflow_events_requires_account(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        tenant_id="t1",
    )

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="u1"), "t1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, workflow_run_id="run-1")


def test_workflow_events_requires_creator(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-2",
        tenant_id="t1",
    )

    class _RepoStub:
        def get_workflow_run_by_id_and_tenant_id(self, **_kwargs):
            return workflow_run

    monkeypatch.setattr(
        DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: _RepoStub(),
    )
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="u1"), "t1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, workflow_run_id="run-1")


def test_workflow_events_finished(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        tenant_id="t1",
        app_id="app-1",
        finished_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    app_model = SimpleNamespace(mode=AppMode.WORKFLOW)

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
    monkeypatch.setattr(
        "controllers.console.human_input_form.current_account_with_tenant",
        lambda: (SimpleNamespace(id="user-1"), "t1"),
    )
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        response = handler(api, workflow_run_id="run-1")

    assert response.mimetype == "text/event-stream"
    assert "data" in response.get_data(as_text=True)
