from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.app import workflow as workflow_module
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from core.workflow.file.enums import FileTransferMethod, FileType
from core.workflow.file.models import File


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_parse_file_no_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: None)
    workflow = SimpleNamespace(features_dict={}, tenant_id="t1")

    assert workflow_module._parse_file(workflow, files=[{"id": "f"}]) == []


def test_parse_file_with_config(monkeypatch: pytest.MonkeyPatch) -> None:
    config = object()
    file_list = [
        File(
            tenant_id="t1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="http://u",
        )
    ]
    build_mock = Mock(return_value=file_list)
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(workflow_module.file_factory, "build_from_mappings", build_mock)

    workflow = SimpleNamespace(features_dict={}, tenant_id="t1")
    result = workflow_module._parse_file(workflow, files=[{"id": "f"}])

    assert result == file_list
    build_mock.assert_called_once()


def test_sync_draft_workflow_invalid_content_type(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    with app.test_request_context("/apps/app/workflows/draft", method="POST", data="x", content_type="text/html"):
        with pytest.raises(HTTPException) as exc:
            handler(api, app_model=SimpleNamespace(id="app"))

    assert exc.value.code == 415


def test_sync_draft_workflow_invalid_json(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        data="[]",
        content_type="application/json",
    ):
        response, status = handler(api, app_model=SimpleNamespace(id="app"))

    assert status == 400
    assert response["message"] == "Invalid JSON data"


def test_sync_draft_workflow_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="h",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_environment_variable_from_mapping", lambda *_args: "env"
    )
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    service = SimpleNamespace(sync_draft_workflow=lambda **_kwargs: workflow)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        response = handler(api, app_model=SimpleNamespace(id="app"))

    assert response["result"] == "success"


def test_sync_draft_workflow_hash_mismatch(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    def _raise(*_args, **_kwargs):
        raise workflow_module.WorkflowHashNotEqualError()

    service = SimpleNamespace(sync_draft_workflow=_raise)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        with pytest.raises(DraftWorkflowNotSync):
            handler(api, app_model=SimpleNamespace(id="app"))


def test_draft_workflow_get_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_k: None)
    )

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.get)

    with pytest.raises(DraftWorkflowNotExist):
        handler(api, app_model=SimpleNamespace(id="app"))


def test_advanced_chat_run_conversation_not_exists(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        workflow_module.AppGenerateService,
        "generate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            workflow_module.services.errors.conversation.ConversationNotExistsError()
        ),
    )
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    api = workflow_module.AdvancedChatDraftWorkflowRunApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/advanced-chat/workflows/draft/run",
        method="POST",
        json={"inputs": {}},
    ):
        with pytest.raises(NotFound):
            handler(api, app_model=SimpleNamespace(id="app"))
