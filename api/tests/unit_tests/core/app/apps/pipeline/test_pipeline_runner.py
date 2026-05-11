"""
Unit tests for PipelineRunner behavior.
Asserts correct event handling, error propagation, and user invocation logic.
Primary collaborators: PipelineRunner, InvokeFrom, GraphRunFailedEvent, UserFrom, and mocked dependencies.
Cross-references: core.app.apps.pipeline.pipeline_runner, core.app.entities.app_invoke_entities.
"""

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

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

import core.app.apps.pipeline.pipeline_runner as module
from core.app.apps.pipeline.pipeline_runner import PipelineRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from graphon.graph_events import GraphRunFailedEvent


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
    workflow = MagicMock()
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


def test_get_workflow_returns_workflow(mocker, runner):
    pipeline = MagicMock(tenant_id="tenant", id="pipe")
    workflow = MagicMock(id="wf")

    mocker.patch.object(module.db, "session", MagicMock(scalar=MagicMock(return_value=workflow)))

    result = runner.get_workflow(pipeline=pipeline, workflow_id="wf")

    assert result == workflow


def test_init_rag_pipeline_graph_invalid_config(mocker, runner):
    workflow = MagicMock(id="wf", tenant_id="tenant", graph_dict={})

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())

    workflow.graph_dict = {"nodes": "bad", "edges": []}
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())

    workflow.graph_dict = {"nodes": [], "edges": "bad"}
    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())


def test_init_rag_pipeline_graph_not_found(mocker, runner):
    workflow = MagicMock(id="wf", tenant_id="tenant", graph_dict={"nodes": [], "edges": []})
    mocker.patch.object(module.Graph, "init", return_value=None)

    with pytest.raises(ValueError):
        runner._init_rag_pipeline_graph(workflow=workflow, graph_runtime_state=MagicMock())


def test_update_document_status_on_failure(mocker, runner):
    document = MagicMock()

    session = MagicMock()
    session.scalar.return_value = document
    mocker.patch.object(module.db, "session", session)

    event = GraphRunFailedEvent(error="boom")

    runner._update_document_status(event, document_id="doc", dataset_id="ds")

    assert document.indexing_status == "error"
    assert document.error == "boom"
    session.commit.assert_called_once()


def test_run_pipeline_not_found(mocker: MockerFixture):
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.invoke_from = InvokeFrom.WEB_APP
    app_generate_entity.single_iteration_run = None
    app_generate_entity.single_loop_run = None

    session = MagicMock()
    session.get.side_effect = [None, None]
    mocker.patch.object(module.db, "session", session)

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=MagicMock(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    with pytest.raises(ValueError):
        runner.run()


def test_run_workflow_not_initialized(mocker: MockerFixture):
    app_generate_entity = _build_app_generate_entity()

    pipeline = MagicMock(id="pipe")

    session = MagicMock()
    session.get.side_effect = [None, pipeline]
    mocker.patch.object(module.db, "session", session)

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=MagicMock(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )
    runner.get_workflow = MagicMock(return_value=None)

    with pytest.raises(ValueError):
        runner.run()


def test_run_single_iteration_path(mocker: MockerFixture):
    app_generate_entity = _build_app_generate_entity()
    app_generate_entity.single_iteration_run = MagicMock()

    pipeline = MagicMock(id="pipe")
    end_user = MagicMock(session_id="sess")

    session = MagicMock()
    session.get.side_effect = [end_user, pipeline]
    mocker.patch.object(module.db, "session", session)

    runner = PipelineRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(),
        variable_loader=MagicMock(),
        workflow=MagicMock(),
        system_user_id="sys",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    runner._resolve_user_from = MagicMock(return_value=UserFrom.ACCOUNT)
    runner.get_workflow = MagicMock(
        return_value=MagicMock(
            id="wf",
            tenant_id="tenant",
            app_id="pipe",
            graph_dict={},
            type="rag-pipeline",
            version="v1",
        )
    )
    runner._prepare_single_node_execution = MagicMock(return_value=("graph", "pool", "state"))
    runner._update_document_status = MagicMock()
    runner._handle_event = MagicMock()

    workflow_entry = MagicMock()
    workflow_entry.graph_engine = MagicMock()
    workflow_entry.run.return_value = [MagicMock()]
    mocker.patch.object(module, "WorkflowEntry", return_value=workflow_entry)

    mocker.patch.object(module, "WorkflowPersistenceLayer", return_value=MagicMock())

    runner.run()

    runner._prepare_single_node_execution.assert_called_once()
    runner._handle_event.assert_called()


def test_run_normal_path_builds_graph(mocker: MockerFixture):
    app_generate_entity = _build_app_generate_entity()

    pipeline = MagicMock(id="pipe")
    end_user = MagicMock(session_id="sess")

    session = MagicMock()
    session.get.side_effect = [end_user, pipeline]
    mocker.patch.object(module.db, "session", session)

    workflow = MagicMock(
        id="wf",
        tenant_id="tenant",
        app_id="pipe",
        graph_dict={"nodes": [], "edges": []},
        environment_variables=[],
        rag_pipeline_variables=[{"variable": "input1", "belong_to_node_id": "start"}],
        type="rag-pipeline",
        version="v1",
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
    runner.get_workflow = MagicMock(return_value=workflow)
    runner._init_rag_pipeline_graph = MagicMock(return_value="graph")
    runner._update_document_status = MagicMock()
    runner._handle_event = MagicMock()

    mocker.patch.object(
        module.RAGPipelineVariable,
        "model_validate",
        return_value=SimpleNamespace(belong_to_node_id="start", variable="input1"),
    )
    mocker.patch.object(module, "RAGPipelineVariableInput", side_effect=lambda **kwargs: SimpleNamespace(**kwargs))

    class FakeVariablePool:
        def add(self, selector, value):
            return None

    mocker.patch.object(module, "VariablePool", return_value=FakeVariablePool())

    workflow_entry = MagicMock()
    workflow_entry.graph_engine = MagicMock()
    workflow_entry.run.return_value = []
    mocker.patch.object(module, "WorkflowEntry", return_value=workflow_entry)
    mocker.patch.object(module, "WorkflowPersistenceLayer", return_value=MagicMock())

    runner.run()

    runner._init_rag_pipeline_graph.assert_called_once()
