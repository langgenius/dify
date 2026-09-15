from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from functools import partial
from typing import override
from unittest.mock import MagicMock

import pytest
from flask import current_app, g

from context.flask_app_context import capture_flask_context
from core.app.layers import execution_context_layer as module
from core.app.layers.execution_context_layer import ExecutionContextLayer
from core.app.workflow.file_runtime import create_dify_workflow_file_runtime, init_app
from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from core.workflow.workflow_tool_container_handler import WorkflowToolContainerHandler
from dify_app import DifyApp
from graphon.engine import Engine
from graphon.engine.layer import Layer
from graphon.engine_events import GraphRunSucceededEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
from graphon.nodes.base.node import Node
from tests.unit_tests.core.workflow.test_workflow_tool_container import (
    _outer_graph,
    _source_workflow,
    _workflow_tool_node,
)


def test_host_context_preserves_each_engine_file_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    app = DifyApp("execution-context")
    init_app(app)
    monkeypatch.setattr(module, "capture_current_context", capture_flask_context)
    request_id: ContextVar[str] = ContextVar("request_id")
    caller_runtime = create_dify_workflow_file_runtime()
    source_app, source_workflow = _source_workflow()

    def build_engine(request: str) -> tuple[Engine, list[str]]:
        runtime = create_dify_workflow_file_runtime()
        with app.app_context():
            g._login_user = request
            request_id.set(request)
            host = ExecutionContextLayer()
        assert host.enter_context() is not host.enter_context()
        checked_nodes: list[str] = []

        def check_context() -> None:
            assert current_app == app
            assert g._login_user == request
            assert request_id.get() == request
            assert peek_workflow_file_runtime() is runtime

        class CheckNodeContext(Layer):
            @override
            def on_node_run_start(self, node: Node[BaseNodeData]) -> None:
                check_context()
                checked_nodes.append(node.id)

        def get_source(**_kwargs) -> WorkflowToolSource:
            # Source loading and graph construction execute on the dispatcher,
            # outside the worker's node_run_context hooks.
            check_context()
            return WorkflowToolSource(
                app_id=source_app.id,
                workflow_id=source_workflow.id,
                graph_config=source_workflow.graph_dict,
                features_dict={},
                environment_variables=[],
                workflow_kind="standard",
            )

        repository = MagicMock(spec=WorkflowToolSourceRepository)
        repository.get_source.side_effect = get_source
        tool, _, _ = _workflow_tool_node()
        engine = Engine(
            graph=_outer_graph(tool),
            runtime_state=tool.runtime_state,
            workers=2,
            file_runtime=runtime,
            container_handler_factories=(
                partial(
                    WorkflowToolContainerHandler,
                    source_repository=repository,
                    execution_context_factory=host.enter_context,
                ),
            ),
        )
        engine.add_layer(host)
        engine.add_layer(CheckNodeContext())
        return engine, checked_nodes

    engines = [build_engine("first"), build_engine("second")]

    def run_engine(item: tuple[Engine, list[str]]) -> None:
        engine, checked_nodes = item
        with use_workflow_file_runtime(caller_runtime):
            for event in engine.run():
                assert peek_workflow_file_runtime() is caller_runtime
            assert isinstance(event, GraphRunSucceededEvent)
            assert set(checked_nodes) == {"outer-start", "tool", "source-start", "source-end"}
            assert peek_workflow_file_runtime() is caller_runtime

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run_engine, engines))
