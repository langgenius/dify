"""HTTP error-contract tests for Console RAG pipeline endpoints."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Api
from werkzeug.test import TestResponse

from controllers.console import api as console_api
from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline import datasource_content_preview, rag_pipeline_workflow
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from services.errors.app import WorkflowHashNotEqualError
from services.knowledge.datasets.contracts import DatasetConcurrentUpdateError
from services.knowledge.entities.pipeline_workflows import DatasourceNodeRun
from services.knowledge.rag_pipeline.application import PipelineConfigurationError, PipelineNotFoundError


@dataclass
class PipelineWorkflowService:
    publish_error: Exception | None = None
    preview_error: Exception | None = None
    publish_calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    preview_calls: list[tuple[RequestContext, str, str, DatasourceNodeRun]] = field(default_factory=list)

    def publish_workflow(self, context: RequestContext, *, pipeline_id: str) -> datetime:
        self.publish_calls.append((context, pipeline_id))
        if self.publish_error is not None:
            raise self.publish_error
        return datetime(2026, 10, 20)

    def preview_console_datasource_node(
        self,
        context: RequestContext,
        *,
        pipeline_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> dict[str, object]:
        self.preview_calls.append((context, pipeline_id, node_id, command))
        if self.preview_error is not None:
            raise self.preview_error
        return {"content": "preview"}


@dataclass(frozen=True)
class KnowledgeServices:
    pipeline_workflows: PipelineWorkflowService


@dataclass(frozen=True)
class ApplicationServices:
    knowledge: KnowledgeServices


@pytest.fixture
def pipeline_routes(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> tuple[FlaskClient, PipelineWorkflowService]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False, RESTX_ERROR_404_HELP=False)
    api = Api(app)
    api.error_handlers = console_api.error_handlers.copy()
    api.add_namespace(console_ns, path="/console/api")

    account = Account(name="Owner", email="pipeline-owner@example.com")
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    identity = AccountWithTenant(account=account, tenant_id="tenant-1")
    monkeypatch.setattr("controllers.console.flask_admission.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)

    workflows = PipelineWorkflowService()
    services = ApplicationServices(KnowledgeServices(workflows))
    app.extensions["application_services"] = services
    monkeypatch.setattr(rag_pipeline_workflow, "application_services", lambda: services)
    monkeypatch.setattr(datasource_content_preview, "application_services", lambda: services)
    return app.test_client(), workflows


def _publish(client: FlaskClient, pipeline_id: UUID) -> TestResponse:
    return client.post(f"/console/api/rag/pipelines/{pipeline_id}/workflows/publish")


def test_publish_maps_conflicting_knowledge_nodes_to_invalid_param(
    pipeline_routes: tuple[FlaskClient, PipelineWorkflowService],
) -> None:
    client, workflows = pipeline_routes
    workflows.publish_error = PipelineConfigurationError(
        "A pipeline cannot publish conflicting knowledge index settings"
    )

    response = _publish(client, uuid4())

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "A pipeline cannot publish conflicting knowledge index settings",
        "status": 400,
    }


def test_publish_maps_changed_draft_to_retryable_conflict(
    pipeline_routes: tuple[FlaskClient, PipelineWorkflowService],
) -> None:
    client, workflows = pipeline_routes
    workflows.publish_error = WorkflowHashNotEqualError()

    response = _publish(client, uuid4())

    assert response.status_code == 409
    assert response.get_json() == {
        "code": "draft_workflow_not_sync",
        "message": "Workflow graph might have been modified, please refresh and resubmit.",
        "status": 409,
    }


def test_publish_maps_changed_dataset_to_retryable_conflict(
    pipeline_routes: tuple[FlaskClient, PipelineWorkflowService],
) -> None:
    client, workflows = pipeline_routes
    workflows.publish_error = DatasetConcurrentUpdateError()

    response = _publish(client, uuid4())

    assert response.status_code == 409
    assert response.get_json() == {
        "code": "dataset_concurrent_update",
        "message": "The dataset changed while it was being updated. Please retry the request.",
        "status": 409,
    }


def test_datasource_preview_documents_pipeline_not_found(
    pipeline_routes: tuple[FlaskClient, PipelineWorkflowService],
) -> None:
    client, workflows = pipeline_routes
    workflows.preview_error = PipelineNotFoundError()
    pipeline_id = uuid4()

    response = client.post(
        f"/console/api/rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/node-1/preview",
        json={"inputs": {"query": "hello"}, "datasource_type": "online_document"},
    )

    assert response.status_code == 404
    assert response.get_json() == {
        "code": "pipeline_not_found",
        "message": "Pipeline not found.",
        "status": 404,
    }
