"""Regression tests for HTTP authorization inside parallel iteration."""

from __future__ import annotations

import threading
import time
from collections.abc import Mapping

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.graph_engine import create_dify_iteration_container_handler
from core.workflow.node_factory import DifyNodeFactory, get_default_root_node_id
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.entities import GraphInitParams
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphRunSucceededEvent
from graphon.http.response import HttpResponse
from graphon.runtime import GraphRuntimeState, VariablePool


class RecordingHttpClient:
    request_error = Exception
    max_retries_exceeded_error = Exception

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.requests: list[dict[str, object]] = []

    def _record(self, method: str, url: str, **kwargs: object) -> HttpResponse:
        with self._lock:
            self.requests.append({"method": method, "url": url, **kwargs})
        return HttpResponse(
            status_code=200,
            headers={"content-type": "text/plain"},
            content=b"ok",
        )

    def get(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("GET", url, max_retries=max_retries, **kwargs)

    def head(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("HEAD", url, max_retries=max_retries, **kwargs)

    def post(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("POST", url, max_retries=max_retries, **kwargs)

    def put(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("PUT", url, max_retries=max_retries, **kwargs)

    def delete(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("DELETE", url, max_retries=max_retries, **kwargs)

    def patch(self, url: str, max_retries: int = 0, **kwargs: object) -> HttpResponse:
        return self._record("PATCH", url, max_retries=max_retries, **kwargs)


def _build_http_iteration_graph_config(*, is_parallel: bool) -> dict[str, object]:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "iteration",
                "data": {
                    "type": "iteration",
                    "title": "Iteration",
                    "start_node_id": "iteration_start",
                    "iterator_selector": ["start", "items"],
                    "output_selector": ["http", "body"],
                    "output_type": "array[string]",
                    "error_handle_mode": "continue-on-error",
                    "is_parallel": is_parallel,
                    "parallel_nums": 3,
                    "flatten_output": True,
                },
            },
            {
                "id": "iteration_start",
                "parentId": "iteration",
                "data": {"type": "iteration-start", "title": "", "isInIteration": True},
            },
            {
                "id": "http",
                "parentId": "iteration",
                "data": {
                    "type": "http-request",
                    "title": "HTTP",
                    "isInIteration": True,
                    "iteration_id": "iteration",
                    "method": "get",
                    "url": "https://api.example.com/items/{{#iteration.item#}}",
                    "authorization": {
                        "type": "api-key",
                        "config": {
                            "type": "custom",
                            "header": "X-API-Key",
                            "api_key": "secret-token",
                        },
                    },
                    "headers": "",
                    "params": "",
                    "body": {"type": "none"},
                    "ssl_verify": True,
                    "timeout": {"connect": 10, "read": 30, "write": 30},
                },
            },
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "output",
                            "value_selector": ["iteration", "output"],
                            "value_type": "array[string]",
                        }
                    ],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "iteration", "sourceHandle": "source", "targetHandle": "target"},
            {"id": "e2", "source": "iteration", "target": "end", "sourceHandle": "source", "targetHandle": "target"},
            {
                "id": "e3",
                "source": "iteration_start",
                "target": "http",
                "sourceHandle": "source",
                "targetHandle": "target",
                "data": {"isInIteration": True, "iteration_id": "iteration"},
            },
        ],
    }


def _run_http_iteration_workflow(
    *,
    is_parallel: bool,
    min_workers: int,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[dict[str, object], RecordingHttpClient]:
    recording_client = RecordingHttpClient()
    monkeypatch.setattr(
        "core.workflow.node_factory.graphon_ssrf_proxy",
        recording_client,
    )

    graph_config = _build_http_iteration_graph_config(is_parallel=is_parallel)
    graph_init_params = GraphInitParams(
        workflow_id="test_workflow",
        graph_config=graph_config,
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "test_tenant",
                "app_id": "test_app",
                "user_id": "test_user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.DEBUGGER,
            }
        },
        call_depth=0,
    )

    system_variables = build_system_variables(
        user_id="test_user",
        app_id="test_app",
        workflow_id=graph_init_params.workflow_id,
        files=[],
        query="",
    )
    root_node_id = get_default_root_node_id(graph_config)
    variable_pool = VariablePool()
    add_variables_to_pool(
        variable_pool,
        build_bootstrap_variables(system_variables=system_variables),
    )
    add_node_inputs_to_pool(
        variable_pool,
        node_id=root_node_id,
        inputs={"items": ["a", "b", "c"]},
    )
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    node_factory = DifyNodeFactory(
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(
        graph_config=graph_config,
        node_factory=node_factory,
        root_node_id=root_node_id,
        skip_validation=True,
    )

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(
            min_workers=min_workers,
            max_workers=min_workers,
            scale_up_threshold=1,
            scale_down_idle_time=3600.0,
        ),
        container_handler_factories=(create_dify_iteration_container_handler,),
    )

    success_event: GraphRunSucceededEvent | None = None
    for event in iter_dify_graph_engine_events(engine):
        if isinstance(event, GraphRunSucceededEvent):
            success_event = event

    assert success_event is not None, "workflow did not succeed"
    return success_event.outputs, recording_client


def _authorization_header(headers: Mapping[str, object] | None) -> str | None:
    if not headers:
        return None
    for key, value in headers.items():
        if key.lower() == "x-api-key":
            return str(value)
    return None


@pytest.mark.parametrize("is_parallel", [False, True])
def test_http_authorization_header_is_preserved_in_iteration(
    is_parallel: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outputs, recording_client = _run_http_iteration_workflow(
        is_parallel=is_parallel,
        min_workers=3,
        monkeypatch=monkeypatch,
    )

    assert outputs["output"] == ["ok", "ok", "ok"]
    assert len(recording_client.requests) == 3
    assert all(_authorization_header(request.get("headers")) == "secret-token" for request in recording_client.requests)
