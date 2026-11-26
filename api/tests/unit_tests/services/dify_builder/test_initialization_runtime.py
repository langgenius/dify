"""Root initialization receipts against the real graph factory and plugin adapter."""

import json
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from dataclasses import dataclass

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
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.nodes.base.node import Node
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.native_launch_observation import (
    NativeLaunchObservation,
    begin_preparation,
    mark_dispatched,
)
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_runtime.workflow_runner import WorkflowAppRunner
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance
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
