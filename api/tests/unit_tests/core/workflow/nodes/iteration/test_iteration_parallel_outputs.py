from datetime import UTC, datetime
from types import SimpleNamespace

from core.workflow.node_factory import resolve_workflow_node_class
from core.workflow.nodes.iteration import DifyIterationNode
from core.workflow.system_variables import default_system_variables
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_events import GraphRunSucceededEvent, NodeRunIterationSucceededEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.nodes.iteration.entities import IterationNodeData
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


class _ChildEngine:
    def __init__(self, *, index: int, output: object) -> None:
        variable_pool = VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={})
        variable_pool.add(["iteration-node", "index"], index)
        variable_pool.add(["iteration-node", "item"], f"item-{index}")
        self.graph_runtime_state = SimpleNamespace(
            variable_pool=variable_pool,
            llm_usage=LLMUsage.empty_usage(),
        )
        self._output = output

    def run(self):
        started_at = datetime.now(UTC).replace(tzinfo=None)
        yield NodeRunSucceededEvent(
            id=f"child-run-{self._output}",
            node_id="child-node",
            node_type=BuiltinNodeTypes.CODE,
            start_at=started_at,
            finished_at=started_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"result": self._output},
            ),
        )
        yield GraphRunSucceededEvent(outputs={"result": self._output})


def _build_iteration_node(*, outputs: list[object]) -> DifyIterationNode:
    variable_pool = VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={})
    variable_pool.add(["source-node", "items"], ["item-0", "item-1"])
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)

    node = DifyIterationNode(
        node_id="iteration-node",
        data=IterationNodeData(
            title="Iteration",
            iterator_selector=["source-node", "items"],
            output_selector=["child-node", "result"],
            start_node_id="iteration-start",
            is_parallel=True,
            parallel_nums=2,
        ),
        graph_init_params=build_test_graph_init_params(),
        graph_runtime_state=runtime_state,
    )

    child_engines = [_ChildEngine(index=index, output=output) for index, output in enumerate(outputs)]
    node._create_graph_engine = lambda index, item: child_engines[index]  # type: ignore[method-assign]
    return node


def test_parallel_iteration_collects_child_event_output_when_variable_pool_lacks_selector() -> None:
    node = _build_iteration_node(outputs=["first", "second"])

    events = list(node.run())

    iteration_success = next(event for event in events if isinstance(event, NodeRunIterationSucceededEvent))
    completed = next(
        event for event in events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "iteration-node"
    )

    assert iteration_success.outputs == {"output": ["first", "second"]}
    assert completed.node_run_result.outputs == {"output": ["first", "second"]}


def test_dify_node_factory_uses_iteration_compatibility_wrapper() -> None:
    assert resolve_workflow_node_class(node_type=BuiltinNodeTypes.ITERATION, node_version="1") is DifyIterationNode
