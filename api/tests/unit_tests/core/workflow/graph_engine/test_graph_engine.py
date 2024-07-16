from unittest.mock import patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import SystemVariable, UserFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.graph_engine import GraphEngine
from models.workflow import WorkflowType


@patch('extensions.ext_database.db.session.remove')
@patch('extensions.ext_database.db.session.close')
def test_run(mock_close, mock_remove):
    graph_config = {
        "edges": [
            {
                "id": "llm-source-answer-target",
                "source": "llm",
                "target": "answer",
            },
            {
                "id": "start-source-qc-target",
                "source": "start",
                "target": "qc",
            },
            {
                "id": "qc-1-llm-target",
                "source": "qc",
                "sourceHandle": "1",
                "target": "llm",
            },
            {
                "id": "qc-2-http-target",
                "source": "qc",
                "sourceHandle": "2",
                "target": "http",
            },
            {
                "id": "http-source-answer2-target",
                "source": "http",
                "target": "answer2",
            }
        ],
        "nodes": [
            {
                "data": {
                    "type": "start",
                    "title": "start"
                },
                "id": "start"
            },
            {
                "data": {
                    "type": "llm",
                    "title": "llm"
                },
                "id": "llm"
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer"
                },
                "id": "answer",
            },
            {
                "data": {
                    "type": "question-classifier",
                    "title": "qc"
                },
                "id": "qc",
            },
            {
                "data": {
                    "type": "http-request",
                    "title": "http"
                },
                "id": "http",
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer2"
                },
                "id": "answer2",
            }
        ],
    }

    graph = Graph.init(
        graph_config=graph_config
    )

    variable_pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200
    )

    print("")

    generator = graph_engine.run()
    for item in generator:
        print(type(item), item)
