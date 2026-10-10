"""Unit tests for PipelineRunner behavior.

This module validates core control-flow outcomes for
``core.app.apps.pipeline.pipeline_runner``: app/workflow lookup, graph
initialization guards, invoke-source to user-source resolution, and failed-run
event handling. Invariants asserted here include strict graph-config
validation, correct ``InvokeFrom`` to ``UserFrom`` mapping, and publishing
error paths driven by ``GraphRunFailedEvent`` through real document persistence.
Primary collaborators include ``PipelineRunner``,
``core.app.entities.app_invoke_entities.InvokeFrom``, ``GraphRunFailedEvent``,
``UserFrom``, and real ORM, graph, and runtime dependencies used by the runner.
"""

import json
from collections.abc import Generator

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.pipeline.pipeline_runner as module
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfig
from core.app.apps.pipeline.pipeline_queue_manager import PipelineQueueManager
from core.app.apps.pipeline.pipeline_runner import PipelineRunner
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.app.entities.queue_entities import AppQueueEvent, QueueWorkflowFailedEvent
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.workflow_entry import WorkflowEntry
from graphon.graph import Graph
from graphon.graph_events import GraphEngineEvent, GraphRunFailedEvent
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.account import Account
from models.dataset import Dataset, Document, Pipeline
from models.enums import DocumentCreatedFrom, WorkflowRunTriggeredFrom
from models.model import AppMode, EndUser
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from tests.unit_tests.model_factories import make_dataset, make_document, make_end_user, make_workflow


def _pipeline(*, tenant_id: str = "tenant", pipeline_id: str = "pipe") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="")
    pipeline.id = pipeline_id
    pipeline.workflow_id = "wf"
    return pipeline


def _dataset(*, tenant_id: str = "tenant", dataset_id: str = "ds", pipeline_id: str = "pipe") -> Dataset:
    return make_dataset(
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        description="",
        created_by="user",
        pipeline_id=pipeline_id,
    )


def _workflow(*, tenant_id: str = "tenant", pipeline_id: str = "pipe", graph: dict | None = None) -> Workflow:
    return make_workflow(
        tenant_id=tenant_id,
        app_id=pipeline_id,
        workflow_type=WorkflowType.RAG_PIPELINE,
        version="v1",
        graph=graph,
        created_by="user",
    )


def _end_user() -> EndUser:
    return make_end_user(end_user_id="user", tenant_id="tenant", app_id="pipe", name="User", session_id="sess")


def _document(*, document_id: str = "doc", dataset_id: str = "ds", tenant_id: str = "tenant") -> Document:
    return make_document(
        document_id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        batch="batch",
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


def _build_app_generate_entity() -> RagPipelineGenerateEntity:
    app_config = PipelineConfig(app_id="pipe", workflow_id="wf", tenant_id="tenant", app_mode=AppMode.RAG_PIPELINE)
    return RagPipelineGenerateEntity(
        task_id="task",
        stream=True,
        app_config=app_config,
        pipeline_config=app_config,
        invoke_from=InvokeFrom.WEB_APP,
        user_id="user",
        trace_manager=None,
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


@pytest.fixture(autouse=True)
def isolate_queue_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client.setex", lambda *_args, **_kwargs: True)


def _build_runner(
    app_generate_entity: RagPipelineGenerateEntity, sqlite_engine: Engine, workflow: Workflow
) -> PipelineRunner:
    user = Account(name="User", email="user@example.com")
    user.id = app_generate_entity.user_id
    return PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=PipelineQueueManager(
            task_id=app_generate_entity.task_id,
            user_id=user.id,
            invoke_from=app_generate_entity.invoke_from,
            app_mode=AppMode.RAG_PIPELINE,
        ),
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=workflow,
        system_user_id="sys",
        workflow_execution_repository=SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_engine,
            tenant_id="tenant",
            user=user,
            app_id="pipe",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
        workflow_node_execution_repository=SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_engine,
            tenant_id="tenant",
            user=user,
            app_id="pipe",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=sessionmaker(bind=sqlite_engine)),
    )


@pytest.fixture
def runner(sqlite_engine: Engine):
    return _build_runner(_build_app_generate_entity(), sqlite_engine, _workflow())


def test_get_app_id(runner):
    assert runner._get_app_id() == "pipe"


def test_get_workflow_returns_workflow(runner, sqlite_session: Session):
    pipeline, _, workflow = _persist_scope(sqlite_session)

    result = runner.get_workflow(session=sqlite_session, pipeline=pipeline, workflow_id="wf")

    assert result == workflow


def test_init_rag_pipeline_graph_invalid_config(mocker, runner):
    workflow = _workflow(graph={})

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(
            workflow=workflow, graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
        )

    workflow.graph = json.dumps({"nodes": "bad", "edges": []})
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(
            workflow=workflow, graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
        )

    workflow.graph = json.dumps({"nodes": [], "edges": "bad"})
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(
            workflow=workflow, graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
        )


def test_init_rag_pipeline_graph_not_found(mocker, runner):
    workflow = _workflow()
    mocker.patch.object(module.Graph, "init", return_value=None)

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(
            workflow=workflow, graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
        )


def test_update_document_status_on_failure(runner, sqlite_session: Session):
    document = _document()
    _, dataset, _ = _persist_scope(sqlite_session, documents=(document,))

    event = GraphRunFailedEvent(error="boom")

    runner._update_document_status(
        event,
        workspace_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
    )

    sqlite_session.expire_all()
    updated = sqlite_session.get(Document, document.id)
    assert updated is not None
    assert updated.indexing_status == "error"
    assert updated.error == "boom"


def test_update_document_status_skips_when_document_not_found(runner, sqlite_session: Session):
    _, dataset, _ = _persist_scope(sqlite_session)

    runner._update_document_status(
        GraphRunFailedEvent(error="boom"),
        workspace_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id="missing",
    )

    assert sqlite_session.get(Document, "missing") is None


def test_update_document_status_skips_without_document_ref(runner, sqlite_engine: Engine):
    checkouts = 0

    def record_checkout(*_args) -> None:
        nonlocal checkouts
        checkouts += 1

    event.listen(sqlite_engine, "checkout", record_checkout)
    try:
        runner._update_document_status(
            GraphRunFailedEvent(error="boom"),
            workspace_id="workspace-1",
            dataset_id="dataset-1",
            document_id=None,
        )
    finally:
        event.remove(sqlite_engine, "checkout", record_checkout)

    assert checkouts == 0


def test_run_pipeline_not_found(sqlite_engine: Engine):
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.invoke_from = InvokeFrom.WEB_APP
    app_generate_entity.single_iteration_run = None
    app_generate_entity.single_loop_run = None

    runner = _build_runner(app_generate_entity, sqlite_engine, _workflow())

    with pytest.raises(ValueError):
        runner.run()


def test_run_pipeline_from_other_tenant_is_not_found(runner: PipelineRunner, sqlite_session: Session):
    pipeline = _pipeline(tenant_id="other-tenant")
    sqlite_session.add(pipeline)
    sqlite_session.commit()

    with pytest.raises(ValueError, match="Pipeline not found"):
        runner.run()


def _unexpected_workflow_lookup(session: Session, pipeline: Pipeline, workflow_id: str) -> Workflow | None:
    pytest.fail("Workflow lookup must follow successful dataset and document ownership checks")


@pytest.mark.parametrize(
    "dataset",
    [
        pytest.param(None, id="missing"),
        pytest.param(_dataset(tenant_id="other-tenant"), id="other-tenant"),
        pytest.param(_dataset(dataset_id="other-dataset"), id="other-dataset"),
    ],
)
def test_run_rejects_unowned_pipeline_dataset(
    monkeypatch: pytest.MonkeyPatch,
    runner: PipelineRunner,
    dataset: Dataset | None,
    sqlite_session: Session,
):
    pipeline = _pipeline()
    sqlite_session.add(pipeline)
    if dataset is not None:
        sqlite_session.add(dataset)
    sqlite_session.commit()
    monkeypatch.setattr(runner, "get_workflow", _unexpected_workflow_lookup)

    with pytest.raises(ValueError, match="Pipeline dataset not found"):
        runner.run()


def test_run_rejects_document_outside_pipeline_dataset_after_async_boundary(
    monkeypatch: pytest.MonkeyPatch,
    runner: PipelineRunner,
    sqlite_session: Session,
):
    runner.application_generate_entity.document_id = "foreign-doc"
    runner.application_generate_entity.original_document_id = "foreign-doc"
    _persist_scope(sqlite_session)
    monkeypatch.setattr(runner, "get_workflow", _unexpected_workflow_lookup)

    with pytest.raises(ValueError, match="Pipeline document not found"):
        runner.run()


def test_run_rejects_original_document_outside_pipeline_dataset_after_async_boundary(
    monkeypatch: pytest.MonkeyPatch,
    runner: PipelineRunner,
    sqlite_session: Session,
):
    runner.application_generate_entity.document_id = "doc"
    runner.application_generate_entity.original_document_id = "foreign-doc"
    _persist_scope(sqlite_session, documents=(_document(),))
    monkeypatch.setattr(runner, "get_workflow", _unexpected_workflow_lookup)

    with pytest.raises(ValueError, match="Pipeline original document not found"):
        runner.run()


def test_run_workflow_not_initialized(sqlite_session: Session, sqlite_engine: Engine):
    app_generate_entity = _build_app_generate_entity()

    pipeline = _pipeline()
    dataset = _dataset()
    document = _document()
    sqlite_session.add_all([pipeline, dataset, document])
    sqlite_session.commit()

    runner = _build_runner(app_generate_entity, sqlite_engine, _workflow())
    with pytest.raises(ValueError):
        runner.run()


def _start_workflow() -> Workflow:
    return _workflow(
        graph={"nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}], "edges": []}
    )


def test_run_single_iteration_path(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine):
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.single_iteration_run = RagPipelineGenerateEntity.SingleIterationRunEntity(
        node_id="start", inputs={}
    )
    _, dataset, workflow = _persist_scope(sqlite_session, workflow=_start_workflow(), documents=(_document(),))
    runner = _build_runner(app_generate_entity, sqlite_engine, workflow)
    prepared = []
    published: list[AppQueueEvent] = []
    failure = GraphRunFailedEvent(error="iteration failed")
    variable_pool = VariablePool()
    state = GraphRuntimeState(variable_pool=variable_pool, start_at=0)

    def prepare_single_node_execution(
        *,
        workflow: Workflow,
        single_iteration_run: RagPipelineGenerateEntity.SingleIterationRunEntity | None,
        single_loop_run: RagPipelineGenerateEntity.SingleLoopRunEntity | None,
        user_id: str,
    ) -> tuple[Graph, VariablePool, GraphRuntimeState]:
        prepared.append((workflow.id, single_iteration_run, single_loop_run, user_id))
        graph = runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=state, start_node_id="start")
        return graph, variable_pool, state

    def run_workflow(entry: WorkflowEntry) -> Generator[GraphEngineEvent]:
        assert entry.graph_engine.graph_runtime_state is state
        yield failure

    monkeypatch.setattr(runner, "_prepare_single_node_execution", prepare_single_node_execution)
    monkeypatch.setattr(runner, "_publish_event", published.append)
    monkeypatch.setattr(WorkflowEntry, "run", run_workflow)

    runner.run()

    assert prepared == [("wf", app_generate_entity.single_iteration_run, None, "user")]
    assert runner._queue_manager.graph_runtime_state is state
    sqlite_session.expire_all()
    document = sqlite_session.get(Document, "doc")
    assert document is not None
    assert document.tenant_id == dataset.tenant_id
    assert document.dataset_id == dataset.id
    assert document.indexing_status == "error"
    assert document.error == failure.error
    assert len(published) == 1
    assert isinstance(published[0], QueueWorkflowFailedEvent)
    assert published[0].error == failure.error


def test_run_normal_path_builds_graph(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine):
    app_generate_entity = _build_app_generate_entity()
    events: list[str] = []
    workflow = _start_workflow()
    workflow.rag_pipeline_variables = [
        {"variable": "input1", "belong_to_node_id": "start", "type": "text-input", "label": "Input"}
    ]
    _persist_scope(sqlite_session, workflow=workflow, end_user=_end_user(), documents=(_document(),))
    runner = _build_runner(app_generate_entity, sqlite_engine, workflow)
    entries: list[WorkflowEntry] = []

    def run_workflow(entry: WorkflowEntry) -> Generator[GraphEngineEvent]:
        events.append("workflow_run")
        entries.append(entry)
        yield from ()

    monkeypatch.setattr(WorkflowEntry, "run", run_workflow)

    def record_checkin(*_args) -> None:
        events.append("session_checkin")

    event.listen(sqlite_engine, "checkin", record_checkin)
    try:
        runner.run()
    finally:
        event.remove(sqlite_engine, "checkin", record_checkin)

    assert events[-1] == "workflow_run"
    assert "session_checkin" in events[:-1]
    assert len(entries) == 1
    graph_engine = entries[0].graph_engine
    assert graph_engine.graph.root_node.id == "start"
    assert graph_engine.graph_runtime_state is runner._queue_manager.graph_runtime_state
    input_variable = graph_engine.graph_runtime_state.variable_pool.get(["start", "input1"])
    assert input_variable is not None
    assert input_variable.value == "v1"
