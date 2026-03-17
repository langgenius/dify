from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.app import workflow as workflow_module
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from core.helper import encrypter
from dify_graph.file.enums import FileTransferMethod, FileType
from dify_graph.file.models import File
from dify_graph.variables import SecretVariable


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


def test_sync_draft_workflow_restore_uses_source_secret(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="h",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    captured_env_mappings: list[dict] = []
    source_secret = SecretVariable.model_validate(
        {"id": "env-secret", "name": "api_key", "value": "restored-secret", "value_type": "secret"}
    )
    source_workflow = SimpleNamespace(environment_variables=[source_secret])

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))
    monkeypatch.setattr(
        workflow_module.variable_factory,
        "build_environment_variable_from_mapping",
        lambda obj: captured_env_mappings.append(obj) or obj,
    )
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    service = SimpleNamespace(
        get_published_workflow_by_id=lambda *_args, **_kwargs: source_workflow,
        sync_draft_workflow=lambda **_kwargs: workflow,
    )
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={
            "graph": {},
            "features": {},
            "hash": "h",
            "source_workflow_id": "published-workflow",
            "environment_variables": [
                {
                    "id": "env-secret",
                    "name": "api_key",
                    "value": encrypter.full_mask_token(),
                    "value_type": "secret",
                }
            ],
        },
    ):
        response = handler(api, app_model=SimpleNamespace(id="app", tenant_id="tenant-1"))

    assert response["result"] == "success"
    assert captured_env_mappings == [
        {
            "id": "env-secret",
            "name": "api_key",
            "value": "restored-secret",
            "value_type": "secret",
        }
    ]


def test_sync_draft_workflow_restore_returns_400_when_source_secret_missing(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_workflow = SimpleNamespace(environment_variables=[])

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    service = SimpleNamespace(
        get_published_workflow_by_id=lambda *_args, **_kwargs: source_workflow,
        sync_draft_workflow=lambda **_kwargs: None,
    )
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={
            "graph": {},
            "features": {},
            "hash": "h",
            "source_workflow_id": "published-workflow",
            "environment_variables": [
                {
                    "id": "missing-secret",
                    "name": "api_key",
                    "value": encrypter.full_mask_token(),
                    "value_type": "secret",
                }
            ],
        },
    ):
        response, status = handler(api, app_model=SimpleNamespace(id="app", tenant_id="tenant-1"))

    assert status == 400
    assert response["message"] == "cannot resolve secret environment variable from source workflow, id=missing-secret"


def test_sync_draft_workflow_restore_returns_400_when_source_workflow_is_draft(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    def _raise_is_draft(*_args, **_kwargs):
        raise workflow_module.IsDraftWorkflowError("source workflow must be published")

    service = SimpleNamespace(
        get_published_workflow_by_id=_raise_is_draft,
        sync_draft_workflow=lambda **_kwargs: None,
    )
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={
            "graph": {},
            "features": {},
            "hash": "h",
            "source_workflow_id": "draft-workflow",
            "environment_variables": [],
        },
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, app_model=SimpleNamespace(id="app", tenant_id="tenant-1"))

    assert exc.value.code == 400
    assert exc.value.description == "source workflow must be published"


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
