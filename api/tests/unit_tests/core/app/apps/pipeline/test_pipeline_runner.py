"""Unit tests for PipelineRunner behavior.

This module validates core control-flow outcomes for
``core.app.apps.pipeline.pipeline_runner``: app/workflow lookup, graph
initialization guards, invoke-source to user-source resolution, and failed-run
event handling. Invariants asserted here include strict graph-config
validation, correct ``InvokeFrom`` to ``UserFrom`` mapping, and publishing
error paths driven by ``GraphRunFailedEvent`` through mocked collaborators.
Primary collaborators include ``PipelineRunner``,
``core.app.entities.app_invoke_entities.InvokeFrom``, ``GraphRunFailedEvent``,
``UserFrom``, and patched DB/runtime dependencies used by the runner.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import core.app.apps.pipeline.pipeline_runner as module
from core.app.apps.pipeline.pipeline_runner import PipelineRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from graphon.graph_events import GraphRunFailedEvent
from models.dataset import Dataset, Document, Pipeline
from models.enums import DataSourceType, DocumentCreatedFrom, EndUserType
from models.model import EndUser
from models.workflow import Workflow, WorkflowType


def _pipeline(*, tenant_id: str = "tenant", pipeline_id: str = "pipe") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="")
    pipeline.id = pipeline_id
    pipeline.workflow_id = "wf"
    return pipeline


def _dataset(*, tenant_id: str = "tenant", dataset_id: str = "ds", pipeline_id: str = "pipe") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        created_by="user",
        pipeline_id=pipeline_id,
    )


def _workflow(*, tenant_id: str = "tenant", pipeline_id: str = "pipe", graph: dict | None = None) -> Workflow:
    return Workflow.new(
        tenant_id=tenant_id,
        app_id=pipeline_id,
        type=WorkflowType.RAG_PIPELINE.value,
        version="v1",
        graph=json.dumps(graph if graph is not None else {"nodes": [], "edges": []}),
        features="{}",
        created_by="user",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _end_user() -> EndUser:
    return EndUser(
        id="user",
        tenant_id="tenant",
        app_id="pipe",
        type=EndUserType.BROWSER,
        name="User",
        session_id="sess",
    )


def _document(*, document_id: str = "doc", dataset_id: str = "ds", tenant_id: str = "tenant") -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user",
    )


def _persist_scope(
    session: Session,
    *,
    pipeline: Pipeline | None = None,
    dataset: Dataset | None = None,
    workflow: Workflow | None = None,
    end_user: EndUser | None = None,
    documents: tuple[Document, ...] = (),
) -> tuple[Pipeline, Dataset, Workflow]:
    pipeline = pipeline or _pipeline()
    dataset = dataset or _dataset(tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id)
    workflow = workflow or _workflow(tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id)
    workflow.id = "wf"
    session.add_all([pipeline, dataset, workflow, *(documents or ()), *([end_user] if end_user else [])])
    session.commit()
    return pipeline, dataset, workflow


def _build_app_generate_entity() -> SimpleNamespace:
    app_config = SimpleNamespace(app_id="pipe", workflow_id="wf", tenant_id="tenant")
    return SimpleNamespace(
        app_config=app_config,
        invoke_from=InvokeFrom.WEB_APP,
        user_id="user",
        trace_manager=MagicMock(),
        inputs={"input1": "v1"},
        files=[],
        workflow_execution_id="run",
        document_id="doc",
        original_document_id=None,
        batch="batch",
        dataset_id="ds",
        datasource_type="local_file",
        datasource_info={"name": "file"},
        start_node_id="start",
        call_depth=0,
        single_iteration_run=None,
        single_loop_run=None,
    )


@pytest.fixture
def runner():
    app_generate_entity = _build_app_generate_entity()
    queue_manager = MagicMock()
    variable_loader = MagicMock()
    workflow = _workflow()
    workflow_execution_repository = MagicMock()
    workflow_node_execution_repository = MagicMock()

    return PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=queue_manager,
        variable_loader=variable_loader,
        workflow=workflow,
        system_user_id="sys",
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
    )


def test_get_app_id(runner):
    assert runner._get_app_id() == "pipe"


def test_get_workflow_returns_workflow(runner, sqlite_session: Session):
    pipeline, _, workflow = _persist_scope(sqlite_session)

    result = runner.get_workflow(session=sqlite_session, pipeline=pipeline, workflow_id="wf")

    assert result == workflow


def test_init_rag_pipeline_graph_invalid_config(mocker, runner):
    workflow = _workflow(graph={})

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())

    workflow.graph = json.dumps({"nodes": "bad", "edges": []})
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())

    workflow.graph = json.dumps({"nodes": [], "edges": "bad"})
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())


def test_init_rag_pipeline_graph_not_found(mocker, runner):
    workflow = _workflow()
    mocker.patch.object(module.Graph, "init", return_value=None)

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())


def test_update_document_status_on_failure(runner, sqlite_session: Session):
    document = _document()
    _, dataset, _ = _persist_scope(sqlite_session, documents=(document,))
    dataset_ref = module.DatasetRefService.create_dataset_ref(dataset)
    document_ref = module.DatasetRefService.create_document_ref_from_id(dataset_ref, document.id)

    event = GraphRunFailedEvent(error="boom")

    runner._update_document_status(event, document_ref)

    sqlite_session.expire_all()
    updated = sqlite_session.get(Document, document.id)
    assert updated is not None
    assert updated.indexing_status == "error"
    assert updated.error == "boom"


def test_update_document_status_skips_when_document_not_found(runner, sqlite_session: Session):
    _, dataset, _ = _persist_scope(sqlite_session)
    dataset_ref = module.DatasetRefService.create_dataset_ref(dataset)
    document_ref = module.DatasetRefService.create_document_ref_from_id(dataset_ref, "missing")

    runner._update_document_status(GraphRunFailedEvent(error="boom"), document_ref)

    assert sqlite_session.get(Document, "missing") is None


def test_update_document_status_skips_without_document_ref(runner, sqlite_engine: Engine):
    checkouts = 0

    def record_checkout(*_args) -> None:
        nonlocal checkouts
        checkouts += 1

    event.listen(sqlite_engine, "checkout", record_checkout)
    try:
        runner._update_document_status(GraphRunFailedEvent(error="boom"), None)
    finally:
        event.remove(sqlite_engine, "checkout", record_checkout)

    assert checkouts == 0


def test_run_pipeline_not_found():
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.invoke_from = InvokeFrom.WEB_APP
    app_generate_entity.single_iteration_run = None
    app_generate_entity.single_loop_run = None

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=_workflow(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    with pytest.raises(ValueError):
        runner.run()


def test_run_pipeline_from_other_tenant_is_not_found(runner: PipelineRunner, sqlite_session: Session):
    pipeline = _pipeline(tenant_id="other-tenant")
    sqlite_session.add(pipeline)
    sqlite_session.commit()

    with pytest.raises(ValueError, match="Pipeline not found"):
        runner.run()


@pytest.mark.parametrize(
    "dataset",
    [
        pytest.param(None, id="missing"),
        pytest.param(_dataset(tenant_id="other-tenant"), id="other-tenant"),
        pytest.param(_dataset(dataset_id="other-dataset"), id="other-dataset"),
    ],
)
def test_run_rejects_unowned_pipeline_dataset(
    runner: PipelineRunner,
    dataset: Dataset | None,
    sqlite_session: Session,
):
    pipeline = _pipeline()
    sqlite_session.add(pipeline)
    if dataset is not None:
        sqlite_session.add(dataset)
    sqlite_session.commit()
    runner.get_workflow = MagicMock()

    with pytest.raises(ValueError, match="Pipeline dataset not found"):
        runner.run()

    runner.get_workflow.assert_not_called()


def test_run_rejects_document_outside_pipeline_dataset_after_async_boundary(
    runner: PipelineRunner,
    sqlite_session: Session,
):
    runner.application_generate_entity.document_id = "foreign-doc"
    runner.application_generate_entity.original_document_id = "foreign-doc"
    _persist_scope(sqlite_session)
    runner.get_workflow = MagicMock()

    with pytest.raises(ValueError, match="Pipeline document not found"):
        runner.run()

    runner.get_workflow.assert_not_called()


def test_run_rejects_original_document_outside_pipeline_dataset_after_async_boundary(
    runner: PipelineRunner,
    sqlite_session: Session,
):
    runner.application_generate_entity.document_id = "doc"
    runner.application_generate_entity.original_document_id = "foreign-doc"
    _persist_scope(sqlite_session, documents=(_document(),))
    runner.get_workflow = MagicMock()

    with pytest.raises(ValueError, match="Pipeline original document not found"):
        runner.run()

    runner.get_workflow.assert_not_called()


def test_run_workflow_not_initialized(sqlite_session: Session):
    app_generate_entity = _build_app_generate_entity()

    pipeline = _pipeline()
    dataset = _dataset()
    document = _document()
    sqlite_session.add_all([pipeline, dataset, document])
    sqlite_session.commit()

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=_workflow(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )
    with pytest.raises(ValueError):
        runner.run()


def test_run_single_iteration_path(mocker: MockerFixture, sqlite_session: Session):
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.single_iteration_run = MagicMock()

    _, dataset, _ = _persist_scope(sqlite_session, documents=(_document(),))
    dataset_ref = module.DatasetRefService.create_dataset_ref(dataset)
    document_ref = module.DatasetRefService.create_document_ref_from_id(dataset_ref, "doc")

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=_workflow(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    runner._resolve_user_from = MagicMock(return_value=UserFrom.ACCOUNT)
    runner._prepare_single_node_execution = MagicMock(return_value=("graph", "pool", "state"))
    runner._update_document_status = MagicMock()
    runner._handle_event = MagicMock()

    event = MagicMock()
    workflow_entry = MagicMock()
    workflow_entry.graph_engine = MagicMock()
    workflow_entry.run.return_value = [event]
    mocker.patch.object(module, "WorkflowEntry", return_value=workflow_entry)

    mocker.patch.object(module, "WorkflowPersistenceLayer", return_value=MagicMock())

    runner.run()

    runner._prepare_single_node_execution.assert_called_once()
    runner._update_document_status.assert_called_once_with(event, document_ref)
    runner._handle_event.assert_called()


def test_run_normal_path_builds_graph(mocker: MockerFixture, sqlite_session: Session, sqlite_engine: Engine):
    app_generate_entity = _build_app_generate_entity()

    events = []
    workflow = _workflow()
    workflow.rag_pipeline_variables = [
        {
            "variable": "input1",
            "belong_to_node_id": "start",
            "type": "text-input",
            "label": "Input",
        }
    ]
    workflow.id = "wf"
    _persist_scope(
        sqlite_session,
        workflow=workflow,
        end_user=_end_user(),
        documents=(_document(),),
    )

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    runner._resolve_user_from = MagicMock(return_value=UserFrom.ACCOUNT)
    runner._init_rag_pipeline_graph = MagicMock(return_value="graph")
    runner._update_document_status = MagicMock()
    runner._handle_event = MagicMock()

    class FakeVariablePool:
        def add(self, selector, value):
            return None

    mocker.patch.object(module, "VariablePool", return_value=FakeVariablePool())

    workflow_entry = MagicMock()
    workflow_entry.graph_engine = MagicMock()
    workflow_entry.run.side_effect = lambda: events.append("workflow_run") or []
    mocker.patch.object(module, "WorkflowEntry", return_value=workflow_entry)
    mocker.patch.object(module, "WorkflowPersistenceLayer", return_value=MagicMock())

    def record_checkin(*_args) -> None:
        events.append("session_checkin")

    event.listen(sqlite_engine, "checkin", record_checkin)
    try:
        runner.run()
    finally:
        event.remove(sqlite_engine, "checkin", record_checkin)

    assert events[-1] == "workflow_run"
    assert "session_checkin" in events[:-1]
    runner._init_rag_pipeline_graph.assert_called_once()
