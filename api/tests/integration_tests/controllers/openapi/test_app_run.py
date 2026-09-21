"""Integration tests for the per-mode run routes under POST /openapi/v1/apps/<id>."""

from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from flask import Flask

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models import App


def test_chat_run_reaches_the_generator(
    flask_app: Flask, auth_headers, app_in_workspace, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def _fake_generate(*, app_model, user, args, invoke_from, streaming):
        captured["mode"] = app_model.mode
        captured["args"] = args
        captured["invoke_from"] = invoke_from
        return {
            "event": "message",
            "task_id": "t",
            "id": "m",
            "message_id": "m",
            "conversation_id": "c",
            "mode": "chat",
            "answer": "ok",
            "created_at": 0,
        }

    monkeypatch.setattr("controllers.openapi.app_run.AppGenerateService.generate", staticmethod(_fake_generate))
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.get_json()["mode"] == "chat"
    assert captured["mode"] == "chat"
    assert captured["invoke_from"] == InvokeFrom.OPENAPI


def test_chat_run_refuses_a_body_naming_the_caller(flask_app: Flask, auth_headers, app_in_workspace):
    """Identity comes from the bearer; a `user` field is a foreign key and fails validation."""
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}, "query": "hi", "user": "spoof@x.com"},
        headers=auth_headers,
    )
    assert res.status_code == 422


@pytest.fixture
def app_with_mode(flask_app: Flask, workspace_account):
    """Factory that creates an App row in the workspace_account tenant with
    a specified mode. Tracks rows for teardown.
    """
    _, tenant, _ = workspace_account
    created: list[App] = []

    def _make(mode: str) -> App:
        with flask_app.app_context():
            app = App(
                tenant_id=tenant.id,
                name=f"a-{mode}",
                mode=mode,
                status="normal",
                enable_site=True,
                enable_api=True,
            )
            db.session.add(app)
            db.session.commit()
            db.session.refresh(app)
            db.session.expunge(app)
            created.append(app)
            return app

    yield _make

    with flask_app.app_context():
        for app in created:
            db.session.delete(db.session.merge(app))
        db.session.commit()


def test_chat_run_without_query_returns_422(flask_app: Flask, auth_headers, app_in_workspace):
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}},
        headers=auth_headers,
    )
    assert res.status_code == 422


def test_completion_run_reaches_the_generator(
    flask_app: Flask, auth_headers, app_with_mode, monkeypatch: pytest.MonkeyPatch
):
    app = app_with_mode("completion")

    captured = {}

    def _fake_generate(*, app_model, user, args, invoke_from, streaming):
        captured["mode"] = app_model.mode
        captured["args"] = args
        return {
            "event": "message",
            "task_id": "t",
            "id": "m",
            "message_id": "m",
            "mode": "completion",
            "answer": "ok",
            "created_at": 0,
        }

    monkeypatch.setattr("controllers.openapi.app_run.AppGenerateService.generate", staticmethod(_fake_generate))
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app.id}/completion:run",
        json={"inputs": {}},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.get_json()["mode"] == "completion"
    assert captured["mode"] == "completion"


def test_workflow_run_with_query_returns_422(flask_app: Flask, auth_headers, app_with_mode):
    app = app_with_mode("workflow")
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app.id}/workflow:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 422


def test_workflow_run_reaches_the_generator(
    flask_app: Flask, auth_headers, app_with_mode, monkeypatch: pytest.MonkeyPatch
):
    app = app_with_mode("workflow")

    def _fake_generate(*, app_model, user, args, invoke_from, streaming):
        return {
            "workflow_run_id": "wfr",
            "task_id": "t",
            "data": {"id": "wf-d", "workflow_id": "wf", "status": "succeeded"},
        }

    monkeypatch.setattr("controllers.openapi.app_run.AppGenerateService.generate", staticmethod(_fake_generate))
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app.id}/workflow:run",
        json={"inputs": {}},
        headers=auth_headers,
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["workflow_run_id"] == "wfr"


def test_run_route_of_another_mode_returns_422(flask_app: Flask, auth_headers, app_with_mode):
    app = app_with_mode("channel")
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app.id}/chat:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 422
    assert b"app_mode_mismatch" in res.data


def test_run_without_bearer_returns_401(flask_app: Flask, app_in_workspace):
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}, "query": "hi"},
    )
    assert res.status_code == 401


def test_run_with_insufficient_scope_returns_403(
    flask_app: Flask, auth_headers, app_in_workspace, monkeypatch: pytest.MonkeyPatch
):
    """Stub the authenticator to return an AuthContext with empty scopes."""
    from libs import oauth_bearer

    real_authenticate = oauth_bearer.BearerAuthenticator.authenticate

    def _stub_authenticate(self, token: str):
        ctx = real_authenticate(self, token)
        from dataclasses import replace

        return replace(ctx, scopes=frozenset())

    monkeypatch.setattr(oauth_bearer.BearerAuthenticator, "authenticate", _stub_authenticate)

    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 403


def test_run_with_unknown_app_returns_404(flask_app: Flask, auth_headers):
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{uuid.uuid4()}/chat:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 404


def test_run_streaming_returns_event_stream(
    flask_app: Flask, auth_headers, app_in_workspace, monkeypatch: pytest.MonkeyPatch
):
    def _stream() -> Generator[str, None, None]:
        yield 'event: message\ndata: {"x": 1}\n\n'

    monkeypatch.setattr(
        "controllers.openapi.app_run.AppGenerateService.generate",
        staticmethod(lambda **kw: _stream()),
    )

    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"inputs": {}, "query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.headers["Content-Type"].startswith("text/event-stream")
    assert b"event: message" in res.data


def test_run_without_inputs_returns_422(flask_app: Flask, auth_headers, app_in_workspace):
    client = flask_app.test_client()
    res = client.post(
        f"/openapi/v1/apps/{app_in_workspace.id}/chat:run",
        json={"query": "hi"},
        headers=auth_headers,
    )
    assert res.status_code == 422
