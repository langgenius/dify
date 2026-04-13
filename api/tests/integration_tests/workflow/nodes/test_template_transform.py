import time
import uuid

from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.template_rendering import TemplateRenderError

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from tests.workflow_test_utils import build_test_graph_init_params


class _SimpleJinja2Renderer:
    """Minimal Jinja2-based renderer for integration tests (no code executor)."""

    def render_template(self, template: str, variables: dict[str, object]) -> str:
        from jinja2 import Template

        try:
            return Template(template).render(**variables)
        except Exception as exc:
            raise TemplateRenderError(str(exc)) from exc


def test_execute_template_transform():
    code = """{{args2}}"""
    config = {
        "id": "1",
        "data": {
            "type": "template-transform",
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "args2"]},
            ],
            "template": code,
        },
    }

    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

    init_params = build_test_graph_init_params(
        workflow_id="1",
        graph_config=graph_config,
        tenant_id="1",
        app_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["1", "args1"], 1)
    variable_pool.add(["1", "args2"], 3)

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory (graph init path still works regardless of renderer choice below)
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")
    assert graph is not None

    node = TemplateTransformNode(
        id=str(uuid.uuid4()),
        config=config,
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        jinja2_template_renderer=_SimpleJinja2Renderer(),
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["output"] == "3"
