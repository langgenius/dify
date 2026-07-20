"""Tests for openapi workflow events reconnect endpoint."""

from __future__ import annotations

import sys
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.openapi.auth.data import AuthData
from libs.oauth_bearer import Scope, TokenType
from models.enums import CreatorUserRole


def _make_auth_data(app_model, caller, caller_kind):
    return AuthData.model_construct(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.uuid4(),
        token_hash="test",
        scopes=frozenset({Scope.FULL}),
        app=app_model,
        caller=caller,
        caller_kind=caller_kind,
    )


def _make_workflow_run(
    *,
    app_id="app-1",
    tenant_id="tenant-1",
    created_by_role=CreatorUserRole.ACCOUNT,
    created_by="acct-1",
    finished_at=None,
):
    return SimpleNamespace(
        id="wf-run-1",
        app_id=app_id,
        tenant_id=tenant_id,
        created_by_role=created_by_role,
        created_by=created_by,
        finished_at=finished_at,
    )


class TestOpenApiWorkflowEventsApi:
    def _get_api(self):
        from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi

        return OpenApiWorkflowEventsApi()

    def test_not_found_when_run_missing(self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
        module = sys.modules["controllers.openapi.workflow_events"]
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = None
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = self._get_api()
        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    task_id="wf-run-1",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )

    def test_not_found_when_run_belongs_to_different_app(
        self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
    ):
        module = sys.modules["controllers.openapi.workflow_events"]
        run = _make_workflow_run(app_id="other-app")
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = self._get_api()
        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    task_id="wf-run-1",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )

    def test_account_caller_checks_created_by_account(
        self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
    ):
        """Account caller must match created_by == caller.id and role == ACCOUNT."""
        module = sys.modules["controllers.openapi.workflow_events"]
        run = _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1")
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        snapshot_builder = Mock(return_value=iter([]))
        monkeypatch.setattr(module, "build_workflow_event_stream", snapshot_builder)

        generator_mock = Mock()
        generator_mock.convert_to_event_stream.return_value = iter([])
        monkeypatch.setattr(module, "WorkflowAppGenerator", lambda: generator_mock)

        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)

        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="acct-1")

        api = self._get_api()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            # Should not raise NotFound for matching caller
            resp = api.get.__wrapped__(
                api,
                app_id="app-1",
                task_id="wf-run-1",
                auth_data=_make_auth_data(app_model, caller, "account"),
            )
        assert resp.mimetype == "text/event-stream"

    def test_account_caller_rejected_for_end_user_run(
        self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
    ):
        module = sys.modules["controllers.openapi.workflow_events"]
        run = _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1")
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="acct-1")

        api = self._get_api()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    task_id="wf-run-1",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )

    def test_end_user_caller_checks_created_by_end_user(
        self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
    ):
        """End-user caller must match created_by == caller.id and role == END_USER."""
        module = sys.modules["controllers.openapi.workflow_events"]
        run = _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1")
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)

        generator_mock = Mock()
        generator_mock.convert_to_event_stream.return_value = iter([])
        monkeypatch.setattr(module, "WorkflowAppGenerator", lambda: generator_mock)

        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="eu-1")

        api = self._get_api()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            resp = api.get.__wrapped__(
                api,
                app_id="app-1",
                task_id="wf-run-1",
                auth_data=_make_auth_data(app_model, caller, "end_user"),
            )
        assert resp.mimetype == "text/event-stream"

    def test_finished_run_returns_single_sse_event(self, app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
        """A finished run returns a single done-event SSE response without streaming."""
        from datetime import UTC, datetime

        module = sys.modules["controllers.openapi.workflow_events"]
        finished_at = datetime(2024, 1, 1, tzinfo=UTC)
        run = _make_workflow_run(
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="acct-1",
            finished_at=finished_at,
        )
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        monkeypatch.setattr(module, "sessionmaker", Mock(return_value=object()))
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        finish_response = SimpleNamespace(
            event=SimpleNamespace(value="workflow_finished"),
            model_dump=lambda mode=None: {"task_id": "wf-run-1", "status": "succeeded"},
        )
        converter_mock = Mock()
        converter_mock.workflow_run_result_to_finish_response.return_value = finish_response
        monkeypatch.setattr(module, "WorkflowResponseConverter", converter_mock)

        from models.model import AppMode

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        caller = SimpleNamespace(id="acct-1")

        api = self._get_api()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            resp = api.get.__wrapped__(
                api,
                app_id="app-1",
                task_id="wf-run-1",
                auth_data=_make_auth_data(app_model, caller, "account"),
            )
        assert resp.mimetype == "text/event-stream"
        chunks = list(resp.response)
        data = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks).decode()
        assert "workflow_finished" in data
