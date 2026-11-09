"""Root initialization receipts against the real graph factory and plugin adapter."""

import json
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from core.app.llm.model_access import DifyCredentialsProvider, DifyModelFactory
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfiguration
from core.model_manager import ModelInstance
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.nodes.base.node import Node
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.account import Account
from models.dify_builder import DifyBuilderRun, DifyBuilderTestInput
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.native_launch_observation import (
    NativeLaunchObservation,
    begin_preparation,
    mark_dispatched,
)
from services.dify_builder.run_mapping import run_result_data_from_run_row
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager
from services.workflow_runtime.workflow_runner import WorkflowAppRunner
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase, _run
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as full_run_harness
from tests.unit_tests.services.test_workflow_run_agg import make_workflow_runner

PROVIDER = "langgenius/synthetic/synthetic"
MODEL = "synthetic"
harness = full_run_harness


@dataclass
class SchemaTransport:
    handler: Callable[[str, str], Iterator[str]]
    call_count: int = 0

    def __call__(self, method: str, path: str, *_args: object, **_kwargs: object) -> Iterator[str]:
        self.call_count += 1
        return self.handler(method, path)


def _install_schema_failure(monkeypatch: pytest.MonkeyPatch, runner: WorkflowAppRunner) -> SchemaTransport:
    """Inject synthetic lookups/transport while retaining real adapters and graph code."""
    graph = runner._workflow.graph_dict
    graph["nodes"].append(
        {
            "id": "llm",
            "data": {
                "type": "llm",
                "title": "Synthetic model",
                "model": {"provider": PROVIDER, "name": MODEL, "mode": "chat", "completion_params": {}},
                "prompt_template": [{"role": "system", "text": "Synthetic input"}],
                "context": {"enabled": False, "variable_selector": []},
                "vision": {"enabled": False},
            },
        }
    )
    graph["edges"].append({"id": "start-llm", "source": "start", "target": "llm"})
    runner._workflow.graph = json.dumps(graph)
    client = PluginModelClient()
    response = {
        "code": -500,
        "message": json.dumps({"error_type": "PluginDaemonInnerError", "message": "Synthetic metadata unavailable"}),
    }
    transport = SchemaTransport(handler=lambda _method, _path: iter([json.dumps(response)]))
    monkeypatch.setattr(client, "_stream_request", transport)
    runtime = PluginModelRuntime("synthetic-tenant", "synthetic-account", client, PluginService)
    model = make_model_instance(provider=PROVIDER, model=MODEL)
    model.model_type_instance.model_runtime = runtime
    configuration = model.provider_model_bundle.configuration
    schema = make_model_config(provider=PROVIDER, model=MODEL, mode="chat").model_schema
    provider_model = ModelWithProviderEntity(
        model=MODEL,
        label=schema.label,
        model_type=ModelType.LLM,
        fetch_from=schema.fetch_from,
        model_properties=schema.model_properties,
        status=ModelStatus.ACTIVE,
        provider=SimpleModelProviderEntity(configuration.provider),
    )

    def fetch_credentials(_self: DifyCredentialsProvider, provider_name: str, model_name: str) -> dict[str, str]:
        assert (provider_name, model_name) == (PROVIDER, MODEL)
        return dict[str, str]()

    def init_model(_self: DifyModelFactory, provider_name: str, model_name: str) -> ModelInstance:
        assert (provider_name, model_name) == (PROVIDER, MODEL)
        return model

    def get_provider_model(_self: ProviderConfiguration, model: str, model_type: ModelType) -> ModelWithProviderEntity:
        assert (model, model_type) == (MODEL, ModelType.LLM)
        return provider_model

    monkeypatch.setattr(DifyCredentialsProvider, "fetch", fetch_credentials)
    monkeypatch.setattr(DifyModelFactory, "init_model_instance", init_model)
    monkeypatch.setattr(ProviderConfiguration, "get_provider_model", get_provider_model)
    monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client.get", lambda _key: None)
    return transport


def _forbid_node_execution(*_args: object, **_kwargs: object) -> None:
    pytest.fail("A workflow node executed during failed graph initialization")


@pytest.mark.parametrize("parent_already_executed", [False, True])
def test_real_root_graph_failure_proves_no_execution_only_before_first_preparation(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, parent_already_executed: bool
) -> None:
    runner, runs, nodes = make_workflow_runner(sqlite_engine)
    observation = NativeLaunchObservation()
    with observation.track():
        begin_preparation()
        worker_context = copy_context()
        mark_dispatched()
        if parent_already_executed:
            worker_context.run(WorkflowRunAgg.run, runner, None, runs, nodes)
        transport = _install_schema_failure(monkeypatch, runner)
        monkeypatch.setattr(Node, "run", _forbid_node_execution)
        with ThreadPoolExecutor(max_workers=1) as worker:
            future = worker.submit(worker_context.run, WorkflowRunAgg.run, runner, None, runs, nodes)
            with pytest.raises(PluginDaemonInnerError) as caught:
                future.result(timeout=10)

    assert transport.call_count == 1
    assert observation.dispatched
    assert not observation.failed_before_dispatch
    assert observation.resource_for(caught.value) == ("model", PROVIDER, MODEL)
    assert observation.node_ids_for(caught.value, dict(runner._workflow.graph_dict)) == ("llm",)
    assert observation.initialization_error is (None if parent_already_executed else caught.value)
    with Session(sqlite_engine) as session:
        assert len(session.scalars(select(WorkflowRun)).all()) == int(parent_already_executed)
        assert len(session.scalars(select(WorkflowNodeExecutionModel)).all()) == int(parent_already_executed)


def test_real_graph_failure_is_saved_once_and_same_input_recovery_does_not_dispatch(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_engine = harness.factory.kw["bind"]
    assert isinstance(runtime_engine, Engine)
    runner, runs, nodes = make_workflow_runner(runtime_engine)
    transport = _install_schema_failure(monkeypatch, runner)
    harness.draft.graph = runner._workflow.graph
    monkeypatch.setattr(Node, "run", _forbid_node_execution)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)

    def generate(**_kwargs: object) -> object:
        begin_preparation()
        worker_context = copy_context()
        mark_dispatched()
        with ThreadPoolExecutor(max_workers=1) as worker:
            future = worker.submit(worker_context.run, WorkflowRunAgg.run, runner, None, runs, nodes)
            with pytest.raises(PluginDaemonInnerError):
                future.result(timeout=10)
        # This is the native pipeline's error transport, not evidence by itself.
        return iter([{"event": "error", "code": "invalid_param", "status": 400, "message": "Synthetic failure"}])

    harness.generate.side_effect = generate
    first = _run(harness)
    with harness.factory() as session:
        persisted = session.scalar(select(DifyBuilderRun))
        assert persisted is not None
        before = (persisted.id, persisted.status, persisted.immutable, persisted.verification)
    recovered = _run(harness)

    assert harness.generate.call_count == transport.call_count == 1
    assert first.status == recovered.status == "failed"
    assert not first.dify_run_id
    assert first.per_node == []
    assert first.verification is not None
    evidence = first.verification.execution_evidence
    assert evidence is not None
    assert evidence.sealed
    assert evidence.safety_outcome == "preparation_failed"
    assert evidence.failure_resource == ("model", PROVIDER, MODEL)
    assert evidence.failure_node_ids == ("llm",)
    assert evidence.failure_phase == "preparation"
    with harness.factory() as session:
        persisted = session.scalar(select(DifyBuilderRun))
        assert persisted is not None
        assert (persisted.id, persisted.status, persisted.immutable, persisted.verification) == before
        assert persisted.immutable
        assert session.scalar(select(WorkflowRun)) is None
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None


def test_repaired_metadata_and_fresh_input_execute_new_native_run_without_replaying_failure(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_engine = harness.factory.kw["bind"]
    assert isinstance(runtime_engine, Engine)
    original, _, _ = make_workflow_runner(runtime_engine)
    transport = _install_schema_failure(monkeypatch, original)
    graph = original._workflow.graph_dict
    graph["nodes"].append(
        {
            "id": "end",
            "data": {
                "type": "end",
                "title": "End",
                "outputs": [{"variable": "answer", "value_selector": ["llm", "text"]}],
            },
        }
    )
    graph["edges"].append({"id": "llm-end", "source": "llm", "target": "end"})
    original._workflow.graph = harness.draft.graph = json.dumps(graph)
    original._workflow.tenant_id = harness.ids["tenant"]
    original._workflow.app_id = harness.ids["app"]
    original.application_generate_entity.user_id = harness.ids["account"]
    original.application_generate_entity.app_config.tenant_id = harness.ids["tenant"]
    original.application_generate_entity.app_config.app_id = harness.ids["app"]
    user = Account(name="Synthetic owner", email="synthetic@example.invalid")
    user.id = harness.ids["account"]
    runs = SQLAlchemyWorkflowExecutionRepository(
        runtime_engine, harness.ids["tenant"], user, harness.ids["app"], WorkflowRunTriggeredFrom.DEBUGGING
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        runtime_engine,
        harness.ids["tenant"],
        user,
        harness.ids["app"],
        WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    active_runner = original
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)

    def generate(**_kwargs: object) -> object:
        begin_preparation()
        worker_context = copy_context()
        mark_dispatched()
        with ThreadPoolExecutor(max_workers=1) as worker:
            future = worker.submit(worker_context.run, WorkflowRunAgg.run, active_runner, None, runs, nodes)
            try:
                future.result(timeout=10)
            except PluginDaemonInnerError:
                return iter([{"event": "error", "code": "invalid_param", "message": "Synthetic metadata failure"}])
        with harness.factory() as session:
            native = session.get(WorkflowRun, active_runner.application_generate_entity.workflow_execution_id)
            assert native is not None
            return {"data": run_result_data_from_run_row(native)}

    harness.generate.side_effect = generate
    failed = _run(harness)
    with harness.factory() as session:
        old = session.scalar(select(DifyBuilderRun))
        assert old is not None
        old_id = old.id
        snapshot = (old.status, old.immutable, old.verification)
        assert session.scalar(select(WorkflowRun)) is None
    assert failed.verification is not None
    assert failed.verification.execution_evidence is not None
    assert failed.verification.execution_evidence.safety_outcome == "preparation_failed"

    schema = make_model_config(provider=PROVIDER, model=MODEL, mode="chat").model_schema
    schema.model_properties = {ModelPropertyKey.MODE: "chat", ModelPropertyKey.CONTEXT_SIZE: 8192}
    invocation_paths: list[str] = []

    def repaired_transport(_method: str, path: str, *_args: object) -> Iterator[str]:
        if path.endswith("/model/schema"):
            data = {"model_schema": schema.model_dump(mode="json")}
        elif path.endswith("/llm/invoke"):
            invocation_paths.append(path)
            chunk = LLMResultChunk(
                model=MODEL,
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(content="Synthetic repaired answer"),
                    usage=LLMUsage.empty_usage(),
                    finish_reason="stop",
                ),
            )
            data = chunk.model_dump(mode="json")
        elif path.endswith("/llm/num_tokens"):
            data = {"num_tokens": 1}
        else:
            pytest.fail(f"Unexpected synthetic transport operation: {path}")
        return iter([json.dumps({"code": 0, "message": "success", "data": data})])

    transport.handler = repaired_transport
    entity = original.application_generate_entity.model_copy(
        update={"task_id": str(uuid4()), "workflow_execution_id": str(uuid4())}
    )
    active_runner = WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=WorkflowAppQueueManager(entity.task_id, entity.user_id, entity.invoke_from, AppMode.WORKFLOW),
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=original._workflow,
        system_user_id=entity.user_id,
        execution_driver=WorkflowRunAgg.run,
    )
    fresh_input = str(uuid4())
    with harness.factory.begin() as session:
        session.add(
            DifyBuilderTestInput(
                id=fresh_input,
                session_id=harness.ids["session"],
                source="user",
                inputs={"topic": "x"},
                start_schema_hash="schema",
            )
        )
    recovered = _run(harness)
    assert recovered.status == "failed"
    assert harness.generate.call_count == 1
    assert invocation_paths == []
    succeeded = _run(harness, test_input_id=fresh_input)
    assert succeeded.status == "succeeded", succeeded.error
    assert succeeded.dify_run_id == entity.workflow_execution_id
    assert succeeded.dify_run_id != original.application_generate_entity.workflow_execution_id
    assert len(invocation_paths) == 1
    assert harness.generate.call_count == 2
    with harness.factory() as session:
        native = session.get(WorkflowRun, succeeded.dify_run_id)
        assert native is not None
        assert native.status == "succeeded"
        assert native.outputs_dict == {"answer": "Synthetic repaired answer"}
        executed = session.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)).all()
        assert [(node.node_id, node.status) for node in executed] == [
            ("start", "succeeded"),
            ("llm", "succeeded"),
            ("end", "succeeded"),
        ]
        old = session.get(DifyBuilderRun, old_id)
        assert old is not None
        assert (old.status, old.immutable, old.verification) == snapshot
        fresh = session.scalar(select(DifyBuilderRun).where(DifyBuilderRun.inputs_ref == fresh_input))
        assert fresh is not None
        assert fresh.id != old_id
        assert fresh.dify_run_id == succeeded.dify_run_id
        assert fresh.status == "succeeded"
        assert fresh.immutable
        assert len(session.scalars(select(WorkflowRun)).all()) == 1
        assert len(session.scalars(select(DifyBuilderRun)).all()) == 2
    _run(harness)
    _run(harness, test_input_id=fresh_input)
    assert harness.generate.call_count == 2
    assert len(invocation_paths) == 1
