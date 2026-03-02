from types import SimpleNamespace

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from models.enums import UserFrom


def test_init_graph_forwards_skip_validation(monkeypatch) -> None:
    runner = WorkflowBasedAppRunner(
        queue_manager=SimpleNamespace(),
        app_id="app-id",
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
            environment_variables=[],
            conversation_variables=[],
        ),
        start_at=0.0,
    )
    captured: dict[str, object] = {}

    def _fake_graph_init(*, graph_config, node_factory, root_node_id, skip_validation):
        captured["graph_config"] = graph_config
        captured["root_node_id"] = root_node_id
        captured["skip_validation"] = skip_validation
        return SimpleNamespace()

    monkeypatch.setattr("core.app.apps.workflow_app_runner.Graph.init", _fake_graph_init)

    graph = runner._init_graph(
        graph_config={"nodes": [{"id": "target"}], "edges": []},
        graph_runtime_state=runtime_state,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        root_node_id="target",
        skip_validation=True,
    )

    assert graph is not None
    assert captured["root_node_id"] == "target"
    assert captured["skip_validation"] is True
