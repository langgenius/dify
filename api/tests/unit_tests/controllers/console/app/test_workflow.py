from __future__ import annotations

import inspect
import json
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, Mock

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException, NotFound, UnprocessableEntity

from controllers.common.errors import InvalidArgumentError
from controllers.console import wraps as console_wraps
from controllers.console.app import workflow as workflow_module
from controllers.console.app import wraps as app_wraps
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.workflow import ConvertToWorkflowApi
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from enums import DeploymentEdition
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables import SecretVariable, StringVariable
from graphon.variables.variables import RAGPipelineVariable
from libs import login as login_lib
from models import Account as _workflow_convert_api_Account
from models import App as _workflow_convert_api_App
from models import App as _workflow_human_input_debug_api_App
from models import Tenant
from models.account import Account as _workflow_Account
from models.account import Account as _workflow_human_input_debug_api_Account
from models.account import AccountStatus, TenantAccountRole
from models.model import App as _workflow_App
from models.model import AppMode, IconType
from models.workflow import Workflow, WorkflowType
from services import workflow_variable_reference_validator as variable_reference_validator
from services.app.access import AppAccessFilter
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.controllers.error_body import raised_error
from tests.helpers.unit.model_factories import make_app


def _account() -> _workflow_Account:
    account = _workflow_Account(name="Alice", email="alice@example.com")
    account.id = "user-1"
    return account


def _workflow_app(*, app_id: str = "app", tenant_id: str = "t1") -> _workflow_App:
    return _workflow_App(
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
        _features=json.dumps(features),
        marked_name="Release 1",
        marked_comment="Initial release",
        created_by="user-1",
        updated_by=None,
        _environment_variables=[],
        _conversation_variables=[],
        _rag_pipeline_variables=[],
    )
    workflow.created_at = datetime(2024, 1, 1, 12, 0, 0)
    workflow.updated_at = datetime(2024, 1, 1, 12, 1, 0)
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


class TestWorkflowCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _identity_workflow_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
        """Keep variable serialization focused on ORM behavior, not the external key provider."""

        monkeypatch.setattr(workflow_module.encrypter, "encrypt_token", lambda *, tenant_id, token: token)
        monkeypatch.setattr(workflow_module.encrypter, "decrypt_token", lambda *, tenant_id, token: token)

    @staticmethod
    @pytest.mark.parametrize(
        "advisory", ["clean", "warning", "checker-error", "formatter-error", "empty", "non-object", "invalid-json"]
    )
    def test_publish_workflow_returns_success(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        advisory: str,
    ) -> None:
        current_user = SimpleNamespace(id="account-1")
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        graph = {
            "nodes": [
                {"id": "start", "data": {"type": "start"}},
                {"id": "branch", "data": {"type": "if-else"}},
                {"id": "producer", "data": {"type": "code", "title": "Producer"}},
                {
                    "id": "consumer",
                    "data": {"type": "answer", "title": "Consumer", "answer": "{{#producer.text#}}"},
                },
            ],
            "edges": [
                {"source": "start", "target": "branch"},
                {"source": "branch", "target": "producer", "sourceHandle": "true"},
                {"source": "branch", "target": "consumer", "sourceHandle": "false"},
            ],
        }
        workflow = SimpleNamespace(
            id="published-workflow",
            created_at=datetime(2026, 8, 17, 12, 0, 0),
            graph={"clean": "{}", "empty": None, "non-object": "[]", "invalid-json": "{"}.get(
                advisory, json.dumps(graph)
            ),
        )
        if advisory == "checker-error":
            monkeypatch.setattr(
                variable_reference_validator, "validate_variable_references", Mock(side_effect=RuntimeError("checker"))
            )
        elif advisory == "formatter-error":
            monkeypatch.setattr(
                variable_reference_validator,
                "format_variable_reference_errors",
                Mock(side_effect=RuntimeError("format")),
            )
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
                workflow_module.PublishWorkflowPayload.model_validate({}),
                current_user,
                app_model,
            )

        assert response["result"] == "success"
        assert app_model.workflow_id == workflow.id
        assert isinstance(response["created_at"], int)
        if advisory == "warning":
            assert "Consumer" in response["warning"]
            assert "Producer" in response["warning"]
            assert "skipped branch" in response["warning"]
        else:
            assert "warning" not in response

    @staticmethod
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

    @staticmethod
    def test_parse_file_no_config(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: None)
        workflow = _make_workflow(features_dict={})

        assert workflow_module._parse_file(workflow, files=[{"id": "f"}]) == []

    @staticmethod
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

    @staticmethod
    def test_sync_draft_workflow_invalid_content_type(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.post)

        with app.test_request_context("/apps/app/workflows/draft", method="POST", data="x", content_type="text/html"):
            with pytest.raises(HTTPException) as exc:
                handler(api, _account(), app_model=_workflow_app())

        assert exc.value.code == 415

    @staticmethod
    def test_sync_draft_workflow_invalid_json(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.post)

        with app.test_request_context(
            "/apps/app/workflows/draft",
            method="POST",
            data="[]",
            content_type="application/json",
        ):
            response, status = raised_error(lambda: handler(api, _account(), app_model=_workflow_app()))

        assert status == 400
        assert response["message"] == "Invalid JSON data"

    @staticmethod
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
            response = handler(api, _account(), app_model=_workflow_app())

        assert response["result"] == "success"
        assert sync_draft_workflow.call_args.kwargs["environment_variables"] == []
        assert sync_draft_workflow.call_args.kwargs["preserve_environment_variables"] is True

    @staticmethod
    @pytest.mark.parametrize("content_type", ["application/json", "text/plain"])
    @pytest.mark.parametrize("confirmation", [{}, {"force": False}], ids=["missing-force", "force-false"])
    def test_sync_draft_workflow_rejects_empty_graph_without_confirmation(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        content_type: str,
        confirmation: dict[str, bool],
    ) -> None:
        workflow_service = Mock()
        monkeypatch.setattr(workflow_module, "WorkflowService", workflow_service)
        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.post)

        with app.test_request_context(
            "/apps/app/workflows/draft",
            method="POST",
            data=json.dumps({"graph": {"nodes": [], "edges": []}, "features": {}, "hash": "h", **confirmation}),
            content_type=content_type,
        ):
            with pytest.raises(InvalidArgumentError) as exc:
                handler(api, _account(), app_model=_workflow_app())

        assert exc.value.code == 400
        assert exc.value.description == "Saving an empty workflow requires force=true."
        workflow_service.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize("content_type", ["application/json", "text/plain"])
    @pytest.mark.parametrize(
        ("graph", "confirmation"),
        [
            ({"nodes": [], "edges": []}, {"force": True}),
            ({"nodes": [{"id": "start"}], "edges": []}, {}),
            ({"nodes": [], "edges": [{"id": "edge-1", "source": "start", "target": "end"}]}, {}),
        ],
        ids=["confirmed-empty-graph", "nodes-without-edges", "edges-without-nodes"],
    )
    def test_sync_draft_workflow_saves_confirmed_empty_or_nonempty_graph(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        content_type: str,
        graph: dict[str, list[dict[str, str]]],
        confirmation: dict[str, bool],
    ) -> None:
        workflow = SimpleNamespace(unique_hash="next-hash", updated_at=None, created_at=datetime(2024, 1, 1))
        sync_draft_workflow = Mock(return_value=workflow)
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
            data=json.dumps({"graph": graph, "features": {}, "hash": "current-hash", **confirmation}),
            content_type=content_type,
        ):
            response = handler(api, _account(), app_model=_workflow_app())

        assert response["result"] == "success"
        assert response["hash"] == "next-hash"
        sync_draft_workflow.assert_called_once()
        assert sync_draft_workflow.call_args.kwargs["graph"] == graph
        assert sync_draft_workflow.call_args.kwargs["unique_hash"] == "current-hash"

    @staticmethod
    @pytest.mark.parametrize("content_type", ["application/json", "text/plain"])
    def test_sync_draft_workflow_force_does_not_bypass_hash_conflict(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        content_type: str,
    ) -> None:
        sync_draft_workflow = Mock(side_effect=workflow_module.WorkflowHashNotEqualError())
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
            data=json.dumps({"graph": {"nodes": [], "edges": []}, "features": {}, "hash": "stale-hash", "force": True}),
            content_type=content_type,
        ):
            with pytest.raises(DraftWorkflowNotSync) as exc:
                handler(api, _account(), app_model=_workflow_app())

        assert exc.value.code == 409
        sync_draft_workflow.assert_called_once()
        assert sync_draft_workflow.call_args.kwargs["unique_hash"] == "stale-hash"

    @staticmethod
    @pytest.mark.parametrize("content_type", ["application/json", "text/plain"])
    @pytest.mark.parametrize("force", ["true", 1, None], ids=["string", "integer", "null"])
    def test_sync_draft_workflow_rejects_non_boolean_force(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        content_type: str,
        force: str | int | None,
    ) -> None:
        workflow_service = Mock()
        monkeypatch.setattr(workflow_module, "WorkflowService", workflow_service)
        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.post)

        with app.test_request_context(
            "/apps/app/workflows/draft",
            method="POST",
            data=json.dumps({"graph": {"nodes": [], "edges": []}, "features": {}, "force": force}),
            content_type=content_type,
        ):
            if content_type == "application/json":
                with pytest.raises(ValidationError, match="Input should be a valid boolean"):
                    handler(api, _account(), app_model=_workflow_app())
            else:
                response, status = raised_error(lambda: handler(api, _account(), app_model=_workflow_app()))
                assert status == 400
                assert response["message"] == "Invalid JSON data"

        workflow_service.assert_not_called()

    @staticmethod
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
            response = handler(api, _account(), app_model=_workflow_app())

        assert response["result"] == "success"
        assert sync_draft_workflow.call_args.kwargs["preserve_environment_variables"] is True
        assert sync_draft_workflow.call_args.kwargs["environment_variable_upserts"] == [patched_variable]
        assert sync_draft_workflow.call_args.kwargs["deleted_environment_variable_ids"] == ["env-old"]
        build_environment_variable.assert_called_once()

    @staticmethod
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

    @staticmethod
    def test_sync_draft_workflow_rejects_legacy_environment_variables() -> None:
        with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
            workflow_module.SyncDraftWorkflowPayload.model_validate(
                {
                    "graph": {},
                    "features": {},
                    "environment_variables": [],
                }
            )

    @staticmethod
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
                handler(api, _account(), app_model=_workflow_app())

    @staticmethod
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
                handler(api, _account(), app_model=_workflow_app())

        assert exc.value.description == "description too long"

    @staticmethod
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
                app_model=_workflow_app(tenant_id="tenant-1"),
                workflow_id="published-workflow",
            )

        assert response["result"] == "success"
        assert response["hash"] == workflow.unique_hash

    @staticmethod
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
                    app_model=_workflow_app(tenant_id="tenant-1"),
                    workflow_id="published-workflow",
                )

    @staticmethod
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
                    app_model=_workflow_app(tenant_id="tenant-1"),
                    workflow_id="draft-workflow",
                )

        assert exc.value.code == 400
        assert exc.value.description == workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE

    @staticmethod
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
                    app_model=_workflow_app(tenant_id="tenant-1"),
                    workflow_id="published-workflow",
                )

        assert exc.value.code == 400
        assert exc.value.description == "invalid workflow graph"

    @staticmethod
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
            query = workflow_module.WorkflowListQuery.model_validate(
                {"page": "1", "limit": "10", "user_id": "", "named_only": "false"}
            )
            response = handler(api, query, sqlite_session, _account(), app_model=_workflow_app())

        assert response["items"][0]["id"] == "workflow-1"
        assert response["page"] == 1
        assert response["limit"] == 10
        assert response["has_more"] is False

    @staticmethod
    def test_draft_workflow_get_serializes_response_model(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        workflow = _make_workflow()
        sqlite_session.add_all([_account(), workflow])
        sqlite_session.commit()
        monkeypatch.setattr(
            workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_kwargs: workflow)
        )

        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.get)

        response = handler(api, sqlite_session, app_model=_workflow_app())

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

    @staticmethod
    def test_published_workflow_get_uses_session_aware_response_source(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        sqlite_session.add(_account())
        sqlite_session.commit()
        workflow = _make_workflow()
        monkeypatch.setattr(workflow_module.db, "session", lambda: sqlite_session)
        monkeypatch.setattr(
            workflow_module,
            "WorkflowService",
            lambda: SimpleNamespace(get_published_workflow=lambda **_kwargs: workflow),
        )

        api = workflow_module.PublishedWorkflowApi()
        handler = inspect.unwrap(api.get)

        response = handler(api, app_model=SimpleNamespace(id="app"))

        assert response["id"] == "workflow-1"
        assert response["created_by"] == {"id": "user-1", "name": "Alice", "email": "alice@example.com"}
        assert response["updated_by"] is None
        assert response["tool_published"] is False

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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
            workflow_module.WorkflowResponseSource(workflow, session=sqlite_session),
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

    @staticmethod
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
            workflow_module.WorkflowResponseSource(workflow, session=sqlite_session),
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

    @staticmethod
    def test_workflow_response_rejects_invalid_environment_variable_dict(sqlite_session: Session) -> None:
        workflow = _make_workflow(environment_variables=[{"value_type": "not-a-segment-type"}])
        sqlite_session.add_all([_account(), workflow])
        sqlite_session.commit()

        with pytest.raises(ValidationError):
            workflow_module.WorkflowResponse.model_validate(
                workflow_module.WorkflowResponseSource(workflow, session=sqlite_session),
                from_attributes=True,
            )

    @staticmethod
    def test_draft_workflow_get_not_found(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
        monkeypatch.setattr(
            workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_k: None)
        )

        api = workflow_module.DraftWorkflowApi()
        handler = inspect.unwrap(api.get)

        with pytest.raises(DraftWorkflowNotExist):
            handler(api, unbound_session, app_model=_workflow_app())

    @staticmethod
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

        response = handler(api, sqlite_session, app_model=_workflow_app())

        assert response["graph"] == projected_graph

    @staticmethod
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
            payload = workflow_module.AdvancedChatWorkflowRunPayload.model_validate({"inputs": {}})
            with pytest.raises(NotFound):
                handler(api, payload, unbound_session, _account(), app_model=_workflow_app())

    @staticmethod
    @pytest.mark.parametrize(
        ("resource", "payload_model", "payload"),
        [
            (
                workflow_module.DraftWorkflowTriggerRunApi,
                workflow_module.DraftWorkflowTriggerRunPayload,
                {"node_id": "node-1"},
            ),
            (
                workflow_module.DraftWorkflowTriggerRunAllApi,
                workflow_module.DraftWorkflowTriggerRunAllPayload,
                {"node_ids": ["node-1"]},
            ),
        ],
    )
    def test_trigger_run_loads_draft_with_request_session(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        unbound_session: Session,
        resource: type,
        payload_model: type,
        payload: dict[str, object],
    ) -> None:
        get_draft_workflow = Mock(return_value=None)
        monkeypatch.setattr(
            workflow_module,
            "WorkflowService",
            lambda: SimpleNamespace(get_draft_workflow=get_draft_workflow),
        )
        session = unbound_session
        app_model = _workflow_app(app_id="app-1")
        handler = inspect.unwrap(resource.post)

        with app.test_request_context("/", method="POST", json=payload):
            with pytest.raises(ValueError, match="Workflow not found"):
                handler(
                    resource(),
                    payload_model.model_validate(payload),
                    session,
                    _account(),
                    app_model,
                )

        get_draft_workflow.assert_called_once_with(app_model, session=session)

    @staticmethod
    def test_workflow_online_users_filters_inaccessible_workflow(
        app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ) -> None:
        app_id_1 = "11111111-1111-1111-1111-111111111111"
        app_id_2 = "22222222-2222-2222-2222-222222222222"
        signed_avatar_url = "https://files.example.com/signed/avatar-1"
        signed_ids: list[str] = []
        queries: list[tuple[list[str], str, Session]] = []
        actors: list[tuple[str, str]] = []

        def sign_avatar(file_id: str) -> str:
            signed_ids.append(file_id)
            return signed_avatar_url

        class WorkflowQueries:
            def get_tenant_app_maintainers(
                self, app_ids: list[str], tenant_id: str, *, session: Session
            ) -> dict[str, str]:
                queries.append((app_ids, tenant_id, session))
                return {app_id_1: "owner-1", app_id_2: "owner-2"}

        def resolve_access(tenant_id: str, account_id: str) -> AppAccessFilter:
            actors.append((tenant_id, account_id))
            return AppAccessFilter(accessible_app_ids={app_id_1}, can_manage_own_apps=False)

        monkeypatch.setattr(workflow_module, "WorkflowService", WorkflowQueries)
        monkeypatch.setattr(workflow_module, "resolve_app_access_filter", resolve_access)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(workflow_module.file_helpers, "get_signed_file_url", sign_avatar)
        monkeypatch.setattr(workflow_module.session_factory, "create_session", lambda: nullcontext(unbound_session))

        redis_result = [
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
        redis_keys: list[str] = []
        pipeline_transactions: list[bool] = []
        executions: list[bool] = []

        class PresencePipeline:
            def hgetall(self, key: str) -> None:
                redis_keys.append(key)

            def execute(self) -> list[dict[bytes, str]]:
                executions.append(True)
                return redis_result

        def pipeline(*, transaction: bool) -> PresencePipeline:
            pipeline_transactions.append(transaction)
            return PresencePipeline()

        monkeypatch.setattr(workflow_module.redis_client, "pipeline", pipeline)

        api = workflow_module.WorkflowOnlineUsersApi()
        handler = inspect.unwrap(api.post)

        with app.test_request_context(
            "/apps/workflows/online-users",
            method="POST",
            json={"app_ids": [app_id_1, app_id_2]},
        ):
            args = workflow_module.WorkflowOnlineUsersPayload.model_validate({"app_ids": [app_id_1, app_id_2]})
            actor = _account()
            actor.id = "account-1"
            response = handler(api, args, "tenant-1", actor)

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
        assert pipeline_transactions == [False]
        assert redis_keys == [f"{workflow_module.WORKFLOW_ONLINE_USERS_PREFIX}{app_id_1}"]
        assert executions == [True]
        assert signed_ids == ["avatar-file-id"]
        assert queries == [([app_id_1, app_id_2], "tenant-1", unbound_session)]
        assert actors == [("tenant-1", "account-1")]

    @staticmethod
    def test_workflow_online_users_batches_redis_reads(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        app_ids = [f"wf-{index}" for index in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE + 1)]
        monkeypatch.setattr(
            workflow_module,
            "WorkflowService",
            lambda: SimpleNamespace(
                get_tenant_app_maintainers=lambda app_ids, tenant_id, session: dict.fromkeys(app_ids)
            ),
        )
        apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
        monkeypatch.setattr(workflow_module.session_factory, "create_session", lambda: nullcontext(Mock()))

        first_pipeline = Mock()
        first_pipeline.execute.return_value = [
            {} for _ in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE)
        ]
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
            args = workflow_module.WorkflowOnlineUsersPayload.model_validate({"app_ids": app_ids})
            response = handler(api, args, "tenant-1", SimpleNamespace(id="account-1"))

        assert len(response["data"]) == len(app_ids)
        assert redis_pipeline_factory.call_count == 2
        assert first_pipeline.hgetall.call_count == workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE
        assert second_pipeline.hgetall.call_count == 1

    @staticmethod
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
            args = workflow_module.WorkflowOnlineUsersPayload.model_validate({"app_ids": excessive_ids})
            with pytest.raises(HTTPException) as exc:
                handler(api, args, "tenant-1", SimpleNamespace(id="account-1"))

        assert exc.value.code == 400
        assert exc.value.description is not None
        assert "Maximum" in exc.value.description
        get_tenant_app_maintainers.assert_not_called()


"""Unit tests for convert-to-workflow endpoint."""


def _workflow_convert_api_app(app_id: str) -> _workflow_convert_api_App:
    return make_app(app_id=app_id, name=f"App {app_id}")


class TestWorkflowConvertApiCases:
    class TestConvertToWorkflowApi:
        @pytest.fixture
        def api(self):
            return workflow_module.ConvertToWorkflowApi()

        def test_convert_to_workflow_attaches_permission_keys_when_rbac_enabled(
            self, api: ConvertToWorkflowApi, app: Flask, monkeypatch: pytest.MonkeyPatch
        ) -> None:
            method = unwrap(api.post)
            new_app = _workflow_convert_api_app("new-app-1")

            monkeypatch.setattr(
                workflow_module,
                "WorkflowService",
                lambda: type("WorkflowServiceStub", (), {"convert_to_workflow": lambda self, **_kwargs: new_app})(),
            )
            monkeypatch.setattr(
                workflow_module,
                "get_app_permission_keys",
                lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
            )

            with app.test_request_context(
                "/console/api/apps/app-1/convert-to-workflow",
                method="POST",
                json={},
            ):
                current_user = _workflow_convert_api_Account(name="Current user", email="user@example.com")
                current_user.id = "u1"
                response = method(
                    api,
                    workflow_module.ConvertToWorkflowPayload.model_validate({}),
                    current_tenant_id="tenant-1",
                    current_user=current_user,
                    app_model=_workflow_convert_api_app("app-1"),
                )

            assert response["new_app_id"] == "new-app-1"
            assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]


def _make_account() -> _workflow_human_input_debug_api_Account:
    account = _workflow_human_input_debug_api_Account(name="tester", email="tester@example.com")
    account.status = AccountStatus.ACTIVE
    account.role = TenantAccountRole.OWNER
    account.id = "account-123"  # type: ignore[assignment]
    tenant = Tenant(name="Test tenant")
    tenant.id = "tenant-123"
    account._current_tenant = tenant
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


def _make_app(mode: AppMode) -> _workflow_human_input_debug_api_App:
    return _workflow_human_input_debug_api_App(
        id="app-123",
        tenant_id="tenant-123",
        name="Human input app",
        description="",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


def _patch_console_guards(
    monkeypatch: pytest.MonkeyPatch,
    account: _workflow_human_input_debug_api_Account,
    app_model: _workflow_human_input_debug_api_App,
) -> None:
    # Skip setup and auth guardrails
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=True,
        INIT_PASSWORD="",
    )
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *_, **__: None)
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))

    # Avoid hitting the database when resolving the app model
    monkeypatch.setattr(app_wraps, "_load_app_model_from_scoped_session", lambda _app_id: app_model)


@dataclass
class PreviewCase:
    resource_cls: type
    path: str
    mode: AppMode


@dataclass
class SubmitCase:
    resource_cls: type
    path: str
    mode: AppMode


@dataclass
class DeliveryTestCase:
    resource_cls: type
    path: str
    mode: AppMode


class TestWorkflowHumanInputDebugApiCases:
    @staticmethod
    @pytest.mark.parametrize(
        "case",
        [
            PreviewCase(
                resource_cls=workflow_module.AdvancedChatDraftHumanInputFormPreviewApi,
                path="/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-42/form/preview",
                mode=AppMode.ADVANCED_CHAT,
            ),
            PreviewCase(
                resource_cls=workflow_module.WorkflowDraftHumanInputFormPreviewApi,
                path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-42/form/preview",
                mode=AppMode.WORKFLOW,
            ),
        ],
    )
    def test_human_input_preview_delegates_to_service(
        app: Flask, monkeypatch: pytest.MonkeyPatch, case: PreviewCase
    ) -> None:
        account = _make_account()
        app_model = _make_app(case.mode)
        _patch_console_guards(monkeypatch, account, app_model)

        preview_payload = {
            "form_id": "node-42",
            "node_id": "node-42",
            "node_title": "Human input",
            "form_content": "<div>example</div>",
            "inputs": [
                {"type": "paragraph", "output_variable_name": "topic", "default": None},
                {
                    "type": "select",
                    "output_variable_name": "choice",
                    "option_source": {"type": "constant", "selector": list[str](), "value": ["one", "two"]},
                },
                {
                    "type": "file",
                    "output_variable_name": "attachment",
                    "allowed_file_types": ["document"],
                    "allowed_file_extensions": list[str](),
                    "allowed_file_upload_methods": ["local_file", "remote_url"],
                },
                {
                    "type": "file-list",
                    "output_variable_name": "attachments",
                    "allowed_file_types": ["image"],
                    "allowed_file_extensions": list[str](),
                    "allowed_file_upload_methods": ["local_file"],
                    "number_limits": 0,
                },
            ],
            "actions": [{"id": "continue", "title": "Continue", "button_style": "default"}],
            "resolved_default_values": {"topic": ""},
        }
        service_instance = MagicMock()
        service_instance.get_human_input_form_preview.return_value = preview_payload
        monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

        with app.test_request_context(case.path, method="POST", json={"inputs": {"topic": "tech"}}):
            response = case.resource_cls().post(app_id=app_model.id, node_id="node-42")

        assert response == {
            **preview_payload,
            "display_in_ui": None,
            "form_token": None,
            "expiration_time": None,
        }
        service_instance.get_human_input_form_preview.assert_called_once_with(
            app_model=app_model,
            account=account,
            node_id="node-42",
            inputs={"topic": "tech"},
            session=ANY,
        )

    @staticmethod
    @pytest.mark.parametrize(
        "case",
        [
            SubmitCase(
                resource_cls=workflow_module.AdvancedChatDraftHumanInputFormRunApi,
                path="/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-99/form/run",
                mode=AppMode.ADVANCED_CHAT,
            ),
            SubmitCase(
                resource_cls=workflow_module.WorkflowDraftHumanInputFormRunApi,
                path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-99/form/run",
                mode=AppMode.WORKFLOW,
            ),
        ],
    )
    def test_human_input_submit_forwards_payload(app: Flask, monkeypatch: pytest.MonkeyPatch, case: SubmitCase) -> None:
        account = _make_account()
        app_model = _make_app(case.mode)
        _patch_console_guards(monkeypatch, account, app_model)

        result_payload = {"node_id": "node-99", "outputs": {"__rendered_content": "<p>done</p>"}, "action": "approve"}
        service_instance = MagicMock()
        service_instance.submit_human_input_form_preview.return_value = result_payload
        monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

        with app.test_request_context(
            case.path,
            method="POST",
            json={"form_inputs": {"answer": "42"}, "inputs": {"#node-1.result#": "LLM output"}, "action": "approve"},
        ):
            response = case.resource_cls().post(app_id=app_model.id, node_id="node-99")

        assert response == result_payload
        service_instance.submit_human_input_form_preview.assert_called_once_with(
            app_model=app_model,
            account=account,
            node_id="node-99",
            form_inputs={"answer": "42"},
            inputs={"#node-1.result#": "LLM output"},
            action="approve",
            session=ANY,
        )

    @staticmethod
    @pytest.mark.parametrize(
        "case",
        [
            DeliveryTestCase(
                resource_cls=workflow_module.WorkflowDraftHumanInputDeliveryTestApi,
                path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-7/delivery-test",
                mode=AppMode.ADVANCED_CHAT,
            ),
            DeliveryTestCase(
                resource_cls=workflow_module.WorkflowDraftHumanInputDeliveryTestApi,
                path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-7/delivery-test",
                mode=AppMode.WORKFLOW,
            ),
        ],
    )
    def test_human_input_delivery_test_calls_service(
        app: Flask, monkeypatch: pytest.MonkeyPatch, case: DeliveryTestCase
    ) -> None:
        account = _make_account()
        app_model = _make_app(case.mode)
        _patch_console_guards(monkeypatch, account, app_model)

        service_instance = MagicMock()
        monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

        with app.test_request_context(
            case.path,
            method="POST",
            json={"delivery_method_id": "delivery-123"},
        ):
            response = case.resource_cls().post(app_id=app_model.id, node_id="node-7")

        assert response == {}
        service_instance.test_human_input_delivery.assert_called_once_with(
            app_model=app_model,
            account=account,
            node_id="node-7",
            delivery_method_id="delivery-123",
            inputs={},
            session=ANY,
        )

    @staticmethod
    def test_human_input_delivery_test_maps_validation_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        account = _make_account()
        app_model = _make_app(AppMode.ADVANCED_CHAT)
        _patch_console_guards(monkeypatch, account, app_model)

        service_instance = MagicMock()
        service_instance.test_human_input_delivery.side_effect = ValueError("bad delivery method")
        monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

        with app.test_request_context(
            "/console/api/apps/app-123/workflows/draft/human-input/nodes/node-1/delivery-test",
            method="POST",
            json={"delivery_method_id": "bad"},
        ):
            with pytest.raises(ValueError, match="bad delivery method"):
                workflow_module.WorkflowDraftHumanInputDeliveryTestApi().post(app_id=app_model.id, node_id="node-1")

    @staticmethod
    def test_human_input_preview_rejects_non_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        account = _make_account()
        app_model = _make_app(AppMode.ADVANCED_CHAT)
        _patch_console_guards(monkeypatch, account, app_model)

        with app.test_request_context(
            "/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-1/form/preview",
            method="POST",
            json={"inputs": ["not-a-dict"]},
        ):
            with pytest.raises(UnprocessableEntity):
                workflow_module.AdvancedChatDraftHumanInputFormPreviewApi().post(app_id=app_model.id, node_id="node-1")
