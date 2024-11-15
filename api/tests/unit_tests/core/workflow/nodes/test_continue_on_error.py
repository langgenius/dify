from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow import graph_engine
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.event import GraphRunSucceededEvent, NodeRunExceptionEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.graph_engine import GraphEngine
from models.enums import UserFrom
from models.workflow import WorkflowType
from tests.unit_tests.core.workflow.graph_engine.test_graph_engine import VariablePool


def test_default_value_continue_on_error():
    # LLM, Tool, HTTP Request, Code in the Grpah error handle
    code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """
    code = "\n".join([line[4:] for line in code.split("\n")])
    graph_config = {
        "edges": [
            {
                "id": "start-source-code-target",
                "source": "start",
                "target": "code",
                "sourceHandle": "source",
                "targetHandle": "target",
            },
            {
                "id": "code-source-answer-target",
                "source": "code",
                "target": "answer",
                "sourceHandle": "source",
                "targetHandle": "target",
            },
        ],
        "nodes": [
            {"data": {"title": "开始", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "直接回复", "type": "answer", "answer": "{{#code.result#}}"}, "id": "answer"},
            {
                "id": "code",
                "data": {
                    "outputs": {
                        "result": {
                            "type": "number",
                        },
                    },
                    "error_strategy": "default-value",
                    "title": "123",
                    "variables": [],
                    "code_language": "python3",
                    "default_value": {"result": 132123},
                    "code": code,
                    "type": "code",
                },
            },
        ],
    }
    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "清空对话",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={"uid": "Novice"},
    )

    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )
    rst = graph_engine.run()
    arr = []
    for r in rst:
        if isinstance(r, GraphRunSucceededEvent):
            assert r.outputs == {"answer": "132123"}
        arr.append(r)
    assert isinstance(arr[4], NodeRunExceptionEvent)


def test_fail_branch_continue_on_error():
    code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """
    code = "\n".join([line[4:] for line in code.split("\n")])
    graph_config = {
        "edges": [
            {
                "id": "start-source-code-target",
                "source": "start",
                "target": "code",
                "sourceHandle": "source",
                "targetHandle": "target",
            },
            {
                "id": "code-true-code_success-target",
                "source": "code",
                "target": "code_success",
                "sourceHandle": "success",
                "targetHandle": "target",
            },
            {
                "id": "code-false-code_error-target",
                "source": "code",
                "target": "code_error",
                "sourceHandle": "exception",
                "targetHandle": "target",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "id": "code",
                "data": {
                    "outputs": {
                        "result": {
                            "type": "number",
                        },
                    },
                    "error_strategy": "fail-branch",
                    "title": "code",
                    "variables": [],
                    "code_language": "python3",
                    "code": code,
                    "type": "code",
                },
            },
            {
                "data": {"title": "code_success", "type": "answer", "answer": "code node run successfully"},
                "id": "code_success",
            },
            {
                "data": {"title": "code_error", "type": "answer", "answer": "code node run failed"},
                "id": "code_error",
            },
        ],
    }
    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "清空对话",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={"uid": "takato"},
    )
    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )
    rst = graph_engine.run()
    arr = []
    for r in rst:
        arr.append(r)
        if isinstance(r, GraphRunSucceededEvent):
            assert r.outputs == {"answer": "code node run failed"}
    print(arr)


def test_success_branch_continue_on_error():
    code = """
    def main() -> dict:
        return {
            "result": 1 / 1,
        }
    """
    code = "\n".join([line[4:] for line in code.split("\n")])
    graph_config = {
        "edges": [
            {
                "id": "start-source-code-target",
                "source": "start",
                "target": "code",
                "sourceHandle": "source",
                "targetHandle": "target",
            },
            {
                "id": "code-true-code_success-target",
                "source": "code",
                "target": "code_success",
                "sourceHandle": "success",
                "targetHandle": "target",
            },
            {
                "id": "code-false-code_error-target",
                "source": "code",
                "target": "code_error",
                "sourceHandle": "exception",
                "targetHandle": "target",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "id": "code",
                "data": {
                    "outputs": {
                        "result": {
                            "type": "number",
                        },
                    },
                    "error_strategy": "fail-branch",
                    "title": "code",
                    "variables": [],
                    "code_language": "python3",
                    "code": code,
                    "type": "code",
                },
            },
            {
                "data": {"title": "code_success", "type": "answer", "answer": "code node run successfully"},
                "id": "code_success",
            },
            {
                "data": {"title": "code_error", "type": "answer", "answer": "code node run failed"},
                "id": "code_error",
            },
        ],
    }
    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "清空对话",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={"uid": "takato"},
    )
    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )
    rst = graph_engine.run()
    arr = []
    for r in rst:
        arr.append(r)
        if isinstance(r, GraphRunSucceededEvent):
            assert r.outputs == {"answer": "code node run successfully"}
    print(arr)
