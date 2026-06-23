from __future__ import annotations

import json
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask, Response

from controllers.common.errors import NotFoundError
from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.console.human_input_form import (
    ConsoleHumanInputFormApi,
    ConsoleWorkflowEventsApi,
    DifyAPIRepositoryFactory,
    WorkflowResponseConverter,
    _jsonify_form_definition,
)
from models.account import AccountStatus
from models.enums import CreatorUserRole
from models.human_input import RecipientType
from models.model import AppMode


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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

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
                SimpleNamespace(id="user-1"),
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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

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
                SimpleNamespace(id="user-1"),
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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

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
            SimpleNamespace(id="user-1"),
            form_token="token",
        )

    assert response.get_json() == {}
    submit_mock.assert_called_once()


def test_post_form_decorated_success_validates_request_body(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    submit_mock = Mock()
    form = SimpleNamespace(tenant_id="tenant-1", recipient_type=RecipientType.CONSOLE)
    current_user = SimpleNamespace(id="user-1", status=AccountStatus.ACTIVE)

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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))
    monkeypatch.setattr("libs.login.dify_config.LOGIN_DISABLED", True)

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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", SimpleNamespace(id="u1"), workflow_run_id="run-1")


def test_workflow_events_requires_account(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", SimpleNamespace(id="u1"), workflow_run_id="run-1")


def test_workflow_events_requires_creator(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        with pytest.raises(NotFoundError):
            handler(api, "t1", SimpleNamespace(id="u1"), workflow_run_id="run-1")


def test_workflow_events_finished(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr("controllers.console.human_input_form.db", SimpleNamespace(engine=object()))

    api = ConsoleWorkflowEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run/events", method="GET"):
        response = handler(api, "t1", SimpleNamespace(id="user-1"), workflow_run_id="run-1")

    assert response.mimetype == "text/event-stream"
    assert "data" in response.get_data(as_text=True)
