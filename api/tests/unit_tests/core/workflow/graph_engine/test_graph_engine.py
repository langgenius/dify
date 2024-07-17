from unittest.mock import patch

from flask import Flask

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import SystemVariable, UserFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    BaseNodeEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.graph_engine.graph_engine import GraphEngine
from models.workflow import WorkflowType


@patch('extensions.ext_database.db.session.remove')
@patch('extensions.ext_database.db.session.close')
def test_run(mock_close, mock_remove):
    graph_config = {
        "edges": [
            {
                "id": "1",
                "source": "start",
                "target": "answer1",
            },
            {
                "id": "2",
                "source": "answer1",
                "target": "answer2",
            },
            {
                "id": "3",
                "source": "answer1",
                "target": "answer3",
            },
            {
                "id": "4",
                "source": "answer2",
                "target": "answer4",
            },
            {
                "id": "5",
                "source": "answer3",
                "target": "answer5",
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
                    "type": "answer",
                    "title": "answer1",
                    "answer": "1"
                },
                "id": "answer1"
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer2",
                    "answer": "2"
                },
                "id": "answer2",
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer3",
                    "answer": "3"
                },
                "id": "answer3",
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer4",
                    "answer": "4"
                },
                "id": "answer4",
            },
            {
                "data": {
                    "type": "answer",
                    "title": "answer5",
                    "answer": "5"
                },
                "id": "answer5",
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

    app = Flask('test')

    items = []
    with app.app_context():
        generator = graph_engine.run()
        for item in generator:
            print(type(item), item)
            items.append(item)
            if isinstance(item, NodeRunSucceededEvent):
                assert item.route_node_state.status == RouteNodeState.Status.SUCCESS

            assert not isinstance(item, NodeRunFailedEvent)
            assert not isinstance(item, GraphRunFailedEvent)

            if isinstance(item, BaseNodeEvent) and item.route_node_state.node_id in ['answer2', 'answer3']:
                assert item.parallel_id is not None

    assert len(items) == 12
    assert isinstance(items[0], GraphRunStartedEvent)
    assert isinstance(items[1], NodeRunStartedEvent)
    assert items[1].route_node_state.node_id == 'start'
    assert isinstance(items[2], NodeRunSucceededEvent)
    assert items[2].route_node_state.node_id == 'start'

    print(graph_engine.graph_runtime_state)
