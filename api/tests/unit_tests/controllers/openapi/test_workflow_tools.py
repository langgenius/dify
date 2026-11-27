import uuid
from collections.abc import Callable

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import TokenType
from controllers.common.fields import SimpleResultResponse
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import WorkflowToolCreatePayload, WorkflowToolResponse, WorkflowToolSetPayload
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.workflow_tools import WorkflowToolApi, WorkflowToolsApi
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from libs.oauth_bearer import AuthContext
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from tests.helpers.unit.model_factories import make_account, make_tenant

_TOOL_ID = str(uuid.uuid4())
_APP_ID = str(uuid.uuid4())


def _handler(view: Callable[..., object]) -> Callable[..., object]:
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def _context(session: Session) -> Context:
    subject = AccountSubject(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    ctx = Context(subject, session, {"workspace_id": "ws"})
    ctx._workspace = make_tenant(tenant_id="ws")
    ctx._caller = make_account(interface_language="en-US")
    return ctx


def _tool_dict() -> dict[str, object]:
    return {
        "name": "summarizer",
        "label": "Summarizer",
        "workflow_tool_id": _TOOL_ID,
        "workflow_app_id": _APP_ID,
        "icon": {"background": "#252525", "content": "\U0001f4dd"},
        "description": "Summarize a document",
        "parameters": [],
        "output_schema": {},
        "tool": {
            "name": "summarizer",
            "author": "caller",
            "label": {"en_US": "Summarizer"},
            "description": {"en_US": "Summarize a document", "zh_Hans": ""},
            "parameters": [],
            "labels": [],
        },
        "synced": True,
        "privacy_policy": "",
    }


def _create_payload() -> WorkflowToolCreatePayload:
    return WorkflowToolCreatePayload(
        workflow_app_id=_APP_ID,
        name="summarizer",
        label="Summarizer",
        icon={"background": "#252525", "content": "\U0001f4dd"},
        description="Summarize a document",
        parameters=[],
    )


def _set_payload() -> WorkflowToolSetPayload:
    return WorkflowToolSetPayload(
        name="summarizer_v2",
        label="Summarizer v2",
        icon={"background": "#252525", "content": "\U0001f4dd"},
        description="Summarize a document",
        parameters=[],
    )


def test_create_calls_the_service_and_describes_by_app(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    created: list[dict[str, object]] = []
    monkeypatch.setattr(WorkflowToolManageService, "create_workflow_tool", staticmethod(lambda **k: created.append(k)))
    monkeypatch.setattr(WorkflowToolManageService, "get_workflow_tool_by_app_id", lambda *_a: _tool_dict())

    api = WorkflowToolsApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/workflow-tools", method="POST"):
        created_result = _handler(api.post)(api, _context(sqlite_session), "ws", body=_create_payload())

    assert isinstance(created_result, tuple)
    response, status = created_result
    assert status == 201
    assert isinstance(response, WorkflowToolResponse)
    assert created[0]["tenant_id"] == "ws"
    assert created[0]["workflow_app_id"] == _APP_ID
    assert response.workflow_tool_id == _TOOL_ID


def _existing_tools() -> list[ToolProviderApiEntity]:
    return [
        ToolProviderApiEntity(
            id=_TOOL_ID,
            author="caller",
            name="summarizer",
            description=I18nObject(en_US="Summarize a document"),
            icon="\U0001f4dd",
            label=I18nObject(en_US="Summarizer"),
            type=ToolProviderType.WORKFLOW,
        )
    ]


def test_describe_answers_404_for_an_unknown_tool(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(WorkflowToolManageService, "list_tenant_workflow_tools", classmethod(lambda _cls, _u, _t: []))

    api = WorkflowToolApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/workflow-tools/{_TOOL_ID}"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.get)(api, _context(sqlite_session), "ws", _TOOL_ID)


def test_describe_returns_the_typed_tool(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    monkeypatch.setattr(
        WorkflowToolManageService, "list_tenant_workflow_tools", classmethod(lambda _cls, _u, _t: _existing_tools())
    )
    monkeypatch.setattr(WorkflowToolManageService, "get_workflow_tool_by_tool_id", lambda *_a: _tool_dict())

    api = WorkflowToolApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/workflow-tools/{_TOOL_ID}"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", _TOOL_ID)

    assert isinstance(response, WorkflowToolResponse)
    assert (response.workflow_tool_id, response.workflow_app_id, response.synced) == (_TOOL_ID, _APP_ID, True)


def test_set_replaces_the_tool(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    updated: list[tuple[object, ...]] = []
    monkeypatch.setattr(
        WorkflowToolManageService, "list_tenant_workflow_tools", classmethod(lambda _cls, _u, _t: _existing_tools())
    )
    monkeypatch.setattr(WorkflowToolManageService, "update_workflow_tool", staticmethod(lambda *a: updated.append(a)))
    monkeypatch.setattr(WorkflowToolManageService, "get_workflow_tool_by_tool_id", lambda *_a: _tool_dict())

    api = WorkflowToolApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/workflow-tools/{_TOOL_ID}", method="PUT"):
        response = _handler(api.put)(api, _context(sqlite_session), "ws", _TOOL_ID, body=_set_payload())

    (_user_id, tenant_id, tool_id, name, *_rest) = updated[0]
    assert (tenant_id, tool_id, name) == ("ws", _TOOL_ID, "summarizer_v2")
    assert isinstance(response, WorkflowToolResponse)
    assert response.workflow_tool_id == _TOOL_ID


def test_set_answers_400_for_a_duplicate_name(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    def duplicate(*_a: object) -> None:
        raise ValueError("Tool with same name already exists")

    monkeypatch.setattr(
        WorkflowToolManageService, "list_tenant_workflow_tools", classmethod(lambda _cls, _u, _t: _existing_tools())
    )
    monkeypatch.setattr(WorkflowToolManageService, "update_workflow_tool", duplicate)

    api = WorkflowToolApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/workflow-tools/{_TOOL_ID}", method="PUT"),
        pytest.raises(BadRequest),
    ):
        _handler(api.put)(api, _context(sqlite_session), "ws", _TOOL_ID, body=_set_payload())


def test_delete_calls_the_service(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    deleted: list[tuple[object, ...]] = []
    monkeypatch.setattr(
        WorkflowToolManageService, "list_tenant_workflow_tools", classmethod(lambda _cls, _u, _t: _existing_tools())
    )
    monkeypatch.setattr(WorkflowToolManageService, "delete_workflow_tool", staticmethod(lambda *a: deleted.append(a)))

    api = WorkflowToolApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/workflow-tools/{_TOOL_ID}", method="DELETE"):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _TOOL_ID)

    assert result == SimpleResultResponse(result="success")
    (_user_id, tenant_id, tool_id) = deleted[0]
    assert (tenant_id, tool_id) == ("ws", _TOOL_ID)


def test_a_create_payload_rejects_a_bad_app_id_and_extra_fields() -> None:
    with pytest.raises(ValidationError):
        WorkflowToolCreatePayload.model_validate(
            {
                "workflow_app_id": "not-a-uuid",
                "name": "x",
                "label": "X",
                "icon": {"background": "#fff", "content": "i"},
                "description": "d",
            }
        )
    with pytest.raises(ValidationError):
        WorkflowToolSetPayload.model_validate(
            {
                "name": "x",
                "label": "X",
                "icon": {"background": "#fff", "content": "i"},
                "description": "d",
                "surprise": 1,
            }
        )
