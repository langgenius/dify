import time
import uuid

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


def _build_variable_pool() -> VariablePool:
    return VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
    )


def _build_answer_node(*, answer: str, variable_pool: VariablePool) -> AnswerNode:
    graph_config = {
        "edges": [],
        "nodes": [
            {
                "data": {
                    "title": "Answer",
                    "type": "answer",
                    "answer": answer,
                },
                "id": "answer",
            }
        ],
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
    graph_runtime_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
    )
    return AnswerNode(
        node_id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        data=AnswerNodeData(
            title="Answer",
            type="answer",
            answer=answer,
        ),
    )


def test_execute_answer_renders_variable_selectors() -> None:
    variable_pool = _build_variable_pool()
    variable_pool.add(["start", "weather"], "sunny")
    variable_pool.add(["llm", "text"], "You are a helpful AI.")
    node = _build_answer_node(
        answer="Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
        variable_pool=variable_pool,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."


def test_execute_answer_renders_structured_output_object_as_json() -> None:
    variable_pool = _build_variable_pool()
    variable_pool.add(["1777539038857", "structured_output"], {"type": "greeting"})
    node = _build_answer_node(
        answer="{{#1777539038857.structured_output#}}",
        variable_pool=variable_pool,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == '{\n  "type": "greeting"\n}'


def test_execute_answer_falls_back_to_plain_selector_text_when_structured_output_missing() -> None:
    node = _build_answer_node(
        answer="{{#1777539038857.structured_output#}}",
        variable_pool=_build_variable_pool(),
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == "1777539038857.structured_output"
