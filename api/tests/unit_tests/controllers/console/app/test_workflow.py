from __future__ import annotations

import inspect
import json
from contextlib import contextmanager, nullcontext
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException, NotFound

from controllers.common.errors import InvalidArgumentError
from controllers.console.app import workflow as workflow_module
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables import SecretVariable, StringVariable
from graphon.variables.variables import RAGPipelineVariable
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType


@pytest.fixture(autouse=True)
def _identity_workflow_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep variable serialization focused on ORM behavior, not the external key provider."""

    monkeypatch.setattr(workflow_module.encrypter, "encrypt_token", lambda *, tenant_id, token: token)
    monkeypatch.setattr(workflow_module.encrypter, "decrypt_token", lambda *, tenant_id, token: token)


def _account() -> Account:
    account = Account(name="Alice", email="alice@example.com")
    account.id = "user-1"
    return account


def _app(*, app_id: str = "app", tenant_id: str = "t1") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Workflow App",
        description="",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _make_workflow(**overrides) -> Workflow:
    graph = overrides.pop("graph_dict", {"nodes": [], "edges": []})
    features = overrides.pop("features_dict", {"file_upload": {"enabled": False}})
    environment_variables = overrides.pop(
        "environment_variables",
        [
            SecretVariable(
                id="env-1",
                name="API_KEY",
                value="plain-token",
                selector=["env", "API_KEY"],
                description="API key",
            )
        ],
    )
    conversation_variables = overrides.pop(
        "conversation_variables",
        [
            StringVariable(
                id="conv-1",
                name="topic",
                value="hello",
                selector=["conversation", "topic"],
                description="Topic",
            )
        ],
    )
    rag_pipeline_variables = overrides.pop(
        "rag_pipeline_variables",
        [
            RAGPipelineVariable.model_validate(
                {
                    "variable": "query",
                    "type": "text-input",
                    "label": "Query",
                    "belong_to_node_id": "shared",
                    "max_length": 0,
                    "required": False,
                    "unit": "",
                    "default_value": "",
                    "options": [],
                    "placeholder": "",
                    "tooltips": "",
                    "allowed_file_types": ["custom"],
                    "allowed_file_extensions": [".pdf"],
                    "allowed_file_upload_methods": ["local_file"],
                }
            )
        ],
    )
    workflow = Workflow(
        id="workflow-1",
        tenant_id="t1",
        app_id="app",
        type=WorkflowType.WORKFLOW,
        version="1",
        graph=json.dumps(graph),
        features=json.dumps(features),
        marked_name="Release 1",
        marked_comment="Initial release",
        created_by="user-1",
        created_at=datetime(2024, 1, 1, 12, 0, 0),
        updated_by=None,
        updated_at=datetime(2024, 1, 1, 12, 1, 0),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    if environment_variables and isinstance(environment_variables[0], dict):
        workflow._environment_variables = json.dumps(
            {str(index): value for index, value in enumerate(environment_variables)}
        )
    else:
        workflow.environment_variables = environment_variables
    workflow.conversation_variables = conversation_variables
    workflow.rag_pipeline_variables = rag_pipeline_variables
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


def test_publish_workflow_returns_success(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = SimpleNamespace(id="account-1")
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    workflow = SimpleNamespace(id="published-workflow", created_at=datetime(2026, 8, 17, 12, 0, 0))
    session = Mock()
    session.get.return_value = app_model
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        Mock(return_value=SimpleNamespace(publish_workflow=Mock(return_value=workflow))),
    )
    monkeypatch.setattr(
        workflow_module,
        "sessionmaker",
        lambda _engine: SimpleNamespace(begin=lambda: nullcontext(session)),
    )
    monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))
    with app.test_request_context("/apps/app-1/workflows/publish", method="POST", json={}):
        response = inspect.unwrap(workflow_module.PublishedWorkflowApi.post)(
            workflow_module.PublishedWorkflowApi(),
            current_user,
            app_model,
        )

    assert response["result"] == "success"


@pytest.mark.parametrize("transaction_fails", [False, True], ids=["commit-succeeds", "commit-fails"])
def test_delete_workflow_retires_candidates_only_after_transaction_exit(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    transaction_fails: bool,
) -> None:
    current_user = SimpleNamespace(id="account-1")
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = Mock()
    events: list[str] = []
    error = RuntimeError("commit failed")
    workflow_service = SimpleNamespace(
        delete_workflow=Mock(side_effect=lambda **_kwargs: events.append("delete") or ["inline-agent"])
    )

    @contextmanager
    def transaction():
        events.append("transaction-enter")
        yield session
        events.append("transaction-exit")
        if transaction_fails:
            raise error

    monkeypatch.setattr(workflow_module, "WorkflowService", Mock(return_value=workflow_service))
    monkeypatch.setattr(
        workflow_module,
        "sessionmaker",
        lambda _engine: SimpleNamespace(begin=transaction),
    )
    monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))
    retire_unowned = Mock(side_effect=lambda **_kwargs: events.append("retire"))
    monkeypatch.setattr(workflow_module.WorkflowAgentRetirementService, "retire_unowned", retire_unowned)

    with app.test_request_context("/apps/app-1/workflows/workflow-1", method="DELETE"):
        if transaction_fails:
            with pytest.raises(RuntimeError) as exc_info:
                inspect.unwrap(workflow_module.WorkflowByIdApi.delete)(
                    workflow_module.WorkflowByIdApi(),
                    current_user,
                    app_model,
                    "workflow-1",
                )
            assert exc_info.value is error
        else:
            response = inspect.unwrap(workflow_module.WorkflowByIdApi.delete)(
                workflow_module.WorkflowByIdApi(),
                current_user,
                app_model,
                "workflow-1",
            )
            assert response == (None, 204)

    assert events == ["transaction-enter", "delete", "transaction-exit"] + ([] if transaction_fails else ["retire"])
    if transaction_fails:
        retire_unowned.assert_not_called()
    else:
        retire_unowned.assert_called_once_with(
            tenant_id=app_model.tenant_id,
            agent_ids=["inline-agent"],
            account_id=current_user.id,
        )


def test_parse_file_no_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: None)
    workflow = _make_workflow(features_dict={})

    assert workflow_module._parse_file(workflow, files=[{"id": "f"}]) == []


def test_parse_file_with_config(monkeypatch: pytest.MonkeyPatch) -> None:
    config = object()
    file_list = [
        File(
            tenant_id="t1",
            file_type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="http://u",
        )
    ]
    build_mock = Mock(return_value=file_list)
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(workflow_module.file_factory, "build_from_mappings", build_mock)

    workflow = _make_workflow(features_dict={})
    result = workflow_module._parse_file(workflow, files=[{"id": "f"}])

    assert result == file_list
    build_mock.assert_called_once()


def test_sync_draft_workflow_invalid_content_type(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context("/apps/app/workflows/draft", method="POST", data="x", content_type="text/html"):
        with pytest.raises(HTTPException) as exc:
            handler(api, _account(), app_model=_app())

    assert exc.value.code == 415


def test_sync_draft_workflow_invalid_json(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        data="[]",
        content_type="application/json",
    ):
        response, status = handler(api, _account(), app_model=_app())

    assert status == 400
    assert response["message"] == "Invalid JSON data"


def test_sync_draft_workflow_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow(updated_at=None, created_at=datetime(2024, 1, 1))

    monkeypatch.setattr(
        workflow_module.variable_factory, "build_environment_variable_from_mapping", lambda *_args: "env"
    )
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    sync_draft_workflow = Mock(return_value=workflow)
    service = SimpleNamespace(sync_draft_workflow=sync_draft_workflow)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        response = handler(api, _account(), app_model=_app())

    assert response["result"] == "success"
    assert sync_draft_workflow.call_args.kwargs["environment_variables"] == []
    assert sync_draft_workflow.call_args.kwargs["preserve_environment_variables"] is True


def test_sync_draft_workflow_passes_environment_patch(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow(updated_at=None, created_at=datetime(2024, 1, 1))
    patched_variable = StringVariable(
        id="env-model",
        name="shared_model",
        value="model",
        selector=["env", "shared_model"],
    )
    build_environment_variable = Mock(return_value=patched_variable)
    sync_draft_workflow = Mock(return_value=workflow)
    monkeypatch.setattr(
        workflow_module.variable_factory,
        "build_environment_variable_from_mapping",
        build_environment_variable,
    )
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(sync_draft_workflow=sync_draft_workflow),
    )

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)
    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={
            "graph": {},
            "features": {},
            "hash": "current-hash",
            "environment_variable_patch": {
                "environment_variables": [
                    {
                        "id": "env-model",
                        "name": "shared_model",
                        "value": "model",
                        "value_type": "string",
                    }
                ],
                "deleted_environment_variable_ids": ["env-old"],
            },
        },
    ):
        response = handler(api, _account(), app_model=_app())

    assert response["result"] == "success"
    assert sync_draft_workflow.call_args.kwargs["preserve_environment_variables"] is True
    assert sync_draft_workflow.call_args.kwargs["environment_variable_upserts"] == [patched_variable]
    assert sync_draft_workflow.call_args.kwargs["deleted_environment_variable_ids"] == ["env-old"]
    build_environment_variable.assert_called_once()


def test_sync_draft_workflow_rejects_overlapping_environment_patch_ids() -> None:
    with pytest.raises(ValidationError, match="cannot be upserted and deleted"):
        workflow_module.SyncDraftWorkflowPayload.model_validate(
            {
                "graph": {},
                "features": {},
                "environment_variable_patch": {
                    "environment_variables": [{"id": "env-model"}],
                    "deleted_environment_variable_ids": ["env-model"],
                },
            }
        )


def test_sync_draft_workflow_rejects_legacy_environment_variables() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        workflow_module.SyncDraftWorkflowPayload.model_validate(
            {
                "graph": {},
                "features": {},
                "environment_variables": [],
            }
        )


def test_sync_draft_workflow_hash_mismatch(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:

    def _raise(*_args, **_kwargs):
        raise workflow_module.WorkflowHashNotEqualError()

    service = SimpleNamespace(sync_draft_workflow=_raise)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        with pytest.raises(DraftWorkflowNotSync):
            handler(api, _account(), app_model=_app())


def test_sync_draft_workflow_variable_validation_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(*_args, **_kwargs):
        raise workflow_module.VariableError("description too long")

    monkeypatch.setattr(workflow_module.variable_factory, "build_conversation_variable_from_mapping", _raise)
    monkeypatch.setattr(
        workflow_module, "WorkflowService", lambda: SimpleNamespace(sync_draft_workflow=lambda **_kwargs: None)
    )

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h", "conversation_variables": [{"name": "topic"}]},
    ):
        with pytest.raises(InvalidArgumentError) as exc:
            handler(api, _account(), app_model=_app())

    assert exc.value.description == "description too long"


def test_restore_published_workflow_to_draft_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow(updated_at=None, created_at=datetime(2024, 1, 1))

    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(restore_published_workflow_to_draft=lambda **_kwargs: workflow),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(
            api,
            _account(),
            app_model=_app(tenant_id="tenant-1"),
            workflow_id="published-workflow",
        )

    assert response["result"] == "success"
    assert response["hash"] == workflow.unique_hash


def test_restore_published_workflow_to_draft_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                workflow_module.WorkflowNotFoundError("Workflow not found")
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(NotFound):
            handler(
                api,
                _account(),
                app_model=_app(tenant_id="tenant-1"),
                workflow_id="published-workflow",
            )


def test_restore_published_workflow_to_draft_returns_400_for_draft_source(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                workflow_module.IsDraftWorkflowError(
                    "Cannot use draft workflow version. Workflow ID: draft-workflow. "
                    "Please use a published workflow version or leave workflow_id empty."
                )
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api,
                _account(),
                app_model=_app(tenant_id="tenant-1"),
                workflow_id="draft-workflow",
            )

    assert exc.value.code == 400
    assert exc.value.description == workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE


def test_restore_published_workflow_to_draft_returns_400_for_invalid_structure(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                ValueError("invalid workflow graph")
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api,
                _account(),
                app_model=_app(tenant_id="tenant-1"),
                workflow_id="published-workflow",
            )

    assert exc.value.code == 400
    assert exc.value.description == "invalid workflow graph"


def test_get_published_workflows_uses_the_request_session(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    api = workflow_module.PublishedAllWorkflowApi()
    handler = inspect.unwrap(api.get)
    workflow = _make_workflow()
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()

    def get_all_published_workflow(*, session: Session, **_kwargs):
        assert session is sqlite_session
        return [workflow], False

    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_all_published_workflow=get_all_published_workflow),
    )

    with app.test_request_context(
        "/apps/app/workflows",
        method="GET",
        query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
    ):
        response = handler(api, sqlite_session, _account(), app_model=_app())

    assert response["items"][0]["id"] == "workflow-1"
    assert response["page"] == 1
    assert response["limit"] == 10
    assert response["has_more"] is False


def test_draft_workflow_get_serializes_response_model(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    workflow = _make_workflow()
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()
    monkeypatch.setattr(
        workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_kwargs: workflow)
    )

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.get)

    response = handler(api, sqlite_session, app_model=_app())

    assert response["id"] == "workflow-1"
    assert response["graph"] == {"nodes": [], "edges": []}
    assert response["features"] == {"file_upload": {"enabled": False}}
    assert response["hash"] == workflow.unique_hash
    assert response["created_by"] == {"id": "user-1", "name": "Alice", "email": "alice@example.com"}
    assert response["updated_by"] is None
    assert response["created_at"] == int(datetime(2024, 1, 1, 12, 0, 0).timestamp())
    assert response["updated_at"] == int(datetime(2024, 1, 1, 12, 1, 0).timestamp())
    assert response["environment_variables"] == [
        {
            "id": "env-1",
            "name": "API_KEY",
            "value": workflow_module.encrypter.full_mask_token(),
            "value_type": "secret",
            "description": "API key",
        }
    ]
    assert response["conversation_variables"] == [
        {
            "id": "conv-1",
            "name": "topic",
            "value": "hello",
            "value_type": "string",
            "description": "Topic",
        }
    ]
    assert response["rag_pipeline_variables"] == [
        {
            "label": "Query",
            "variable": "query",
            "type": "text-input",
            "belong_to_node_id": "shared",
            "max_length": 0,
            "required": False,
            "unit": "",
            "default_value": "",
            "options": [],
            "placeholder": "",
            "tooltips": "",
            "allowed_file_types": ["custom"],
            "allowed_file_extensions": [".pdf"],
            "allowed_file_upload_methods": ["local_file"],
        }
    ]


def test_pipeline_variable_response_accepts_legacy_file_field_names() -> None:
    response = workflow_module.PipelineVariableResponse.model_validate(
        {
            "label": "Query",
            "variable": "query",
            "type": "single-file",
            "belong_to_node_id": "shared",
            "max_length": 0,
            "required": False,
            "unit": "",
            "default_value": "",
            "options": [],
            "placeholder": "",
            "tooltips": "",
            "allowed_file_types": [],
            "allow_file_extension": [".txt"],
            "allow_file_upload_methods": ["remote_url"],
        }
    ).model_dump(mode="json")

    assert response["allowed_file_extensions"] == [".txt"]
    assert response["allowed_file_upload_methods"] == ["remote_url"]


def test_pipeline_variable_response_accepts_explicit_null_optional_fields() -> None:
    pipeline_variable = RAGPipelineVariable.model_validate(
        {
            "label": "Query",
            "variable": "query",
            "type": "text-input",
            "belong_to_node_id": "shared",
            "max_length": None,
            "unit": None,
            "default_value": None,
            "options": None,
            "placeholder": None,
            "tooltips": None,
            "allowed_file_types": None,
            "allowed_file_extensions": None,
            "allowed_file_upload_methods": None,
        }
    ).model_dump(mode="json")

    response = workflow_module.PipelineVariableResponse.model_validate(pipeline_variable).model_dump(mode="json")

    assert response["max_length"] is None
    assert response["allowed_file_types"] is None
    assert response["allowed_file_extensions"] is None
    assert response["allowed_file_upload_methods"] is None


def test_workflow_response_masks_secret_environment_variables(sqlite_session: Session) -> None:
    workflow = _make_workflow(
        environment_variables=[
            SecretVariable(id="env-secret", name="API_KEY", value="plain-token", selector=["env", "API_KEY"]),
            StringVariable(id="env-string", name="REGION", value="us-east-1", selector=["env", "REGION"]),
        ]
    )
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()

    response = workflow_module.WorkflowResponse.model_validate(
        workflow_module._WorkflowResponseSource(workflow, session=sqlite_session),
        from_attributes=True,
    ).model_dump(mode="json")

    assert response["environment_variables"] == [
        {
            "id": "env-secret",
            "name": "API_KEY",
            "value": workflow_module.encrypter.full_mask_token(),
            "value_type": "secret",
            "description": "",
        },
        {
            "id": "env-string",
            "name": "REGION",
            "value": "us-east-1",
            "value_type": "string",
            "description": "",
        },
    ]


def test_workflow_response_preserves_llm_environment_variable_type(sqlite_session: Session) -> None:
    workflow = _make_workflow(
        environment_variables=[
            LLMEnvironmentVariable(
                id="env-llm",
                name="for_summarize",
                value={"provider": "provider", "name": "model", "mode": "chat"},
                selector=["env", "for_summarize"],
            )
        ]
    )
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()

    response = workflow_module.WorkflowResponse.model_validate(
        workflow_module._WorkflowResponseSource(workflow, session=sqlite_session),
        from_attributes=True,
    ).model_dump(mode="json")

    assert response["environment_variables"] == [
        {
            "id": "env-llm",
            "name": "for_summarize",
            "value": {"provider": "provider", "name": "model", "mode": "chat"},
            "value_type": "llm",
            "description": "",
        }
    ]


def test_workflow_response_rejects_invalid_environment_variable_dict(sqlite_session: Session) -> None:
    workflow = _make_workflow(environment_variables=[{"value_type": "not-a-segment-type"}])
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()

    with pytest.raises(ValidationError):
        workflow_module.WorkflowResponse.model_validate(
            workflow_module._WorkflowResponseSource(workflow, session=sqlite_session),
            from_attributes=True,
        )


def test_draft_workflow_get_not_found(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    monkeypatch.setattr(
        workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_k: None)
    )

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.get)

    with pytest.raises(DraftWorkflowNotExist):
        handler(api, unbound_session, app_model=_app())


def test_draft_workflow_get_projects_agent_node_job_to_graph(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workflow = _make_workflow(
        graph_dict={
            "nodes": [
                {
                    "id": "agent-node",
                    "data": {
                        "type": "agent",
                        "version": "2",
                        "agent_node_kind": "dify_agent",
                    },
                }
            ],
            "edges": [],
        }
    )
    sqlite_session.add_all([_account(), workflow])
    sqlite_session.commit()
    projected_graph = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "dify_agent",
                    "agent_task": "Summarize it.",
                    "agent_declared_outputs": [{"name": "summary", "type": "string"}],
                },
            }
        ],
        "edges": [],
    }

    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_draft_workflow=lambda **_k: workflow),
    )

    from services.agent.workflow_publish_service import WorkflowAgentPublishService

    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "project_draft_bindings_to_graph",
        lambda **_k: projected_graph,
    )

    api = workflow_module.DraftWorkflowApi()
    handler = inspect.unwrap(api.get)

    response = handler(api, sqlite_session, app_model=_app())

    assert response["graph"] == projected_graph


def test_advanced_chat_run_conversation_not_exists(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    monkeypatch.setattr(
        workflow_module.AppGenerateService,
        "generate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            workflow_module.services.errors.conversation.ConversationNotExistsError()
        ),
    )

    api = workflow_module.AdvancedChatDraftWorkflowRunApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/app/advanced-chat/workflows/draft/run",
        method="POST",
        json={"inputs": {}},
    ):
        with pytest.raises(NotFound):
            handler(api, unbound_session, "t1", app_model=_app())


@pytest.mark.parametrize(
    ("resource", "payload"),
    [
        (workflow_module.DraftWorkflowTriggerRunApi, {"node_id": "node-1"}),
        (workflow_module.DraftWorkflowTriggerRunAllApi, {"node_ids": ["node-1"]}),
    ],
)
def test_trigger_run_loads_draft_with_request_session(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    unbound_session: Session,
    resource: type,
    payload: dict[str, object],
) -> None:
    get_draft_workflow = Mock(return_value=None)
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_draft_workflow=get_draft_workflow),
    )
    session = unbound_session
    app_model = _app(app_id="app-1")
    handler = inspect.unwrap(resource.post)

    with app.test_request_context("/", method="POST", json=payload):
        with pytest.raises(ValueError, match="Workflow not found"):
            handler(resource(), session, _account(), app_model)

    get_draft_workflow.assert_called_once_with(app_model, session=session)


def test_workflow_online_users_filters_inaccessible_workflow(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    app_id_1 = "11111111-1111-1111-1111-111111111111"
    app_id_2 = "22222222-2222-2222-2222-222222222222"
    signed_avatar_url = "https://files.example.com/signed/avatar-1"
    sign_avatar = Mock(return_value=signed_avatar_url)
    get_tenant_app_maintainers = Mock(return_value={app_id_1: "owner-1", app_id_2: "owner-2"})
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_tenant_app_maintainers=get_tenant_app_maintainers),
    )
    access_filter = SimpleNamespace(is_app_accessible=lambda app_id, _maintainer, _account_id: app_id == app_id_1)
    resolve_access = Mock(return_value=access_filter)
    monkeypatch.setattr(workflow_module, "resolve_app_access_filter", resolve_access)
    monkeypatch.setattr(workflow_module.dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(workflow_module.file_helpers, "get_signed_file_url", sign_avatar)
    short_session = Mock()
    monkeypatch.setattr(workflow_module.session_factory, "create_session", lambda: nullcontext(short_session))

    redis_pipeline = Mock()
    redis_pipeline.execute.return_value = [
        {
            b"sid-1": json.dumps(
                {
                    "user_id": "u-1",
                    "username": "Alice",
                    "avatar": "avatar-file-id",
                    "sid": "sid-1",
                }
            ),
            b"sid-malformed": json.dumps({"avatar": "avatar-file-id", "sid": "sid-malformed"}),
            b"sid-invalid-avatar": json.dumps(
                {
                    "user_id": "u-2",
                    "username": "Bob",
                    "avatar": {"file_id": "avatar-file-id"},
                }
            ),
            b"sid-invalid-user-id": json.dumps(
                {
                    "user_id": 42,
                    "username": "Carol",
                    "avatar": "avatar-file-id",
                }
            ),
            b"sid-invalid-username": json.dumps(
                {
                    "user_id": "u-4",
                    "username": ["Dave"],
                    "avatar": "avatar-file-id",
                }
            ),
        }
    ]
    redis_pipeline_factory = Mock(return_value=redis_pipeline)
    monkeypatch.setattr(workflow_module.redis_client, "pipeline", redis_pipeline_factory)

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": [app_id_1, app_id_2]},
    ):
        response = handler(api, "tenant-1", SimpleNamespace(id="account-1"))

    assert response == {
        "data": [
            {
                "app_id": app_id_1,
                "users": [
                    {
                        "user_id": "u-1",
                        "username": "Alice",
                        "avatar": signed_avatar_url,
                    },
                    {
                        "user_id": "u-2",
                        "username": "Bob",
                        "avatar": None,
                    },
                ],
            }
        ]
    }
    redis_pipeline_factory.assert_called_once_with(transaction=False)
    redis_pipeline.hgetall.assert_called_once_with(f"{workflow_module.WORKFLOW_ONLINE_USERS_PREFIX}{app_id_1}")
    redis_pipeline.execute.assert_called_once_with()
    sign_avatar.assert_called_once_with("avatar-file-id")
    get_tenant_app_maintainers.assert_called_once()
    resolve_access.assert_called_once()
    assert get_tenant_app_maintainers.call_args.args == ([app_id_1, app_id_2], "tenant-1")
    assert resolve_access.call_args.args == ("tenant-1", "account-1")
    assert get_tenant_app_maintainers.call_args.kwargs["session"] is resolve_access.call_args.kwargs["session"]


def test_workflow_online_users_batches_redis_reads(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    app_ids = [f"wf-{index}" for index in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE + 1)]
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_tenant_app_maintainers=lambda app_ids, tenant_id, session: dict.fromkeys(app_ids)),
    )
    monkeypatch.setattr(workflow_module.dify_config, "RBAC_ENABLED", False)
    monkeypatch.setattr(workflow_module.session_factory, "create_session", lambda: nullcontext(Mock()))

    first_pipeline = Mock()
    first_pipeline.execute.return_value = [{} for _ in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE)]
    second_pipeline = Mock()
    second_pipeline.execute.return_value = [{}]
    redis_pipeline_factory = Mock(side_effect=[first_pipeline, second_pipeline])
    monkeypatch.setattr(workflow_module.redis_client, "pipeline", redis_pipeline_factory)

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": app_ids},
    ):
        response = handler(api, "tenant-1", SimpleNamespace(id="account-1"))

    assert len(response["data"]) == len(app_ids)
    assert redis_pipeline_factory.call_count == 2
    assert first_pipeline.hgetall.call_count == workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE
    assert second_pipeline.hgetall.call_count == 1


def test_workflow_online_users_rejects_excessive_workflow_ids(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    get_tenant_app_maintainers = Mock(return_value={})
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_tenant_app_maintainers=get_tenant_app_maintainers),
    )

    excessive_ids = [f"wf-{index}" for index in range(workflow_module.MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS + 1)]

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = inspect.unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": excessive_ids},
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, "tenant-1", SimpleNamespace(id="account-1"))

    assert exc.value.code == 400
    assert exc.value.description is not None
    assert "Maximum" in exc.value.description
    get_tenant_app_maintainers.assert_not_called()
