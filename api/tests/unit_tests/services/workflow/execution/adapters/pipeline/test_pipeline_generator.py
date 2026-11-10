import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.application_services.workflow import WorkflowExecutionDependencies
from models.dataset import Pipeline
from models.workflow import Workflow, WorkflowType
from repositories.data_source.credential_repository import SQLAlchemyDatasourceCredentialRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.data_source.provider_service import DatasourceProviderService
from services.errors.app import WorkflowNotFoundError
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator
from services.workflow_run_agg import WorkflowRunAgg
from tests.helpers.unit.credential_refresh import build_datasource_provider_service

TENANT_ID = "00000000-0000-0000-0000-000000000001"
PIPELINE_ID = "00000000-0000-0000-0000-000000000002"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000003"
USER_ID = "00000000-0000-0000-0000-000000000004"


def _build_pipeline() -> Pipeline:
    pipeline = Pipeline(tenant_id=TENANT_ID, name="Pipeline", description="")
    pipeline.id = PIPELINE_ID
    return pipeline


def _build_workflow(*, version: str) -> Workflow:
    workflow = Workflow.new(
        tenant_id=TENANT_ID,
        app_id=PIPELINE_ID,
        type=WorkflowType.RAG_PIPELINE.value,
        version=version,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=USER_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = WORKFLOW_ID
    return workflow


@pytest.fixture
def pipeline_generator(
    sqlite_session_factory: sessionmaker[Session], workflow_runtime: WorkflowExecutionDependencies
) -> PipelineGenerator:
    datasource_providers: DatasourceProviderService = build_datasource_provider_service(
        credentials=SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    )
    return PipelineGenerator(
        runtime=workflow_runtime,
        execution_driver=WorkflowRunAgg.run,
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        datasource_providers=datasource_providers,
    )


@pytest.mark.parametrize(
    ("invoke_from", "version"),
    [
        pytest.param(InvokeFrom.DEBUGGER, Workflow.VERSION_DRAFT, id="draft"),
        pytest.param(InvokeFrom.PUBLISHED_PIPELINE, "1", id="published"),
    ],
)
def test_load_workflow_returns_persisted_snapshot(
    sqlite_session: Session,
    pipeline_generator: PipelineGenerator,
    invoke_from: InvokeFrom,
    version: str,
) -> None:
    pipeline = _build_pipeline()
    workflow = _build_workflow(version=version)
    if invoke_from != InvokeFrom.DEBUGGER:
        pipeline.workflow_id = workflow.id
    sqlite_session.add_all([pipeline, workflow])
    sqlite_session.commit()

    snapshot = pipeline_generator.load_workflow(pipeline, invoke_from)

    assert snapshot.id == workflow.id
    assert snapshot.tenant_id == pipeline.tenant_id
    assert snapshot.app_id == pipeline.id
    assert snapshot.version == version


@pytest.mark.parametrize(
    ("invoke_from", "expected_error"),
    [
        pytest.param(InvokeFrom.DEBUGGER, "Workflow not initialized", id="draft"),
        pytest.param(InvokeFrom.PUBLISHED_PIPELINE, "Workflow not published", id="published"),
    ],
)
def test_load_workflow_preserves_missing_workflow_error_contract(
    sqlite_session: Session,
    pipeline_generator: PipelineGenerator,
    invoke_from: InvokeFrom,
    expected_error: str,
) -> None:
    pipeline = _build_pipeline()
    sqlite_session.add(pipeline)
    sqlite_session.commit()

    with pytest.raises(ValueError, match=f"^{expected_error}$") as exc_info:
        pipeline_generator.load_workflow(pipeline, invoke_from)

    assert isinstance(exc_info.value.__cause__, WorkflowNotFoundError)
