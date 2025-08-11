import time
from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.enums import (
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.events import (
    GraphRunPartialSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunStreamChunkEvent,
)
from core.workflow.events.node import NodeRunStreamChunkEvent
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.node_events.node import NodeRunResult, StreamCompletedEvent
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


class ContinueOnErrorTestHelper:
    @staticmethod
    def get_code_node(
        code: str, error_strategy: str = "fail-branch", default_value: dict | None = None, retry_config: dict = {}
    ):
        """Helper method to create a code node configuration"""
        node = {
            "id": "node",
            "data": {
                "outputs": {"result": {"type": "number"}},
                "error_strategy": error_strategy,
                "title": "code",
                "variables": [],
                "code_language": "python3",
                "code": "\n".join([line[4:] for line in code.split("\n")]),
                "type": "code",
                **retry_config,
            },
        }
        if default_value:
            node["data"]["default_value"] = default_value
        return node

    @staticmethod
    def get_http_node(
        error_strategy: str = "fail-branch",
        default_value: dict | None = None,
        authorization_success: bool = False,
        retry_config: dict = {},
    ):
        """Helper method to create a http node configuration"""
        authorization = (
            {
                "type": "api-key",
                "config": {
                    "type": "basic",
                    "api_key": "ak-xxx",
                    "header": "api-key",
                },
            }
            if authorization_success
            else {
                "type": "api-key",
                # missing config field
            }
        )
        node = {
            "id": "node",
            "data": {
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": authorization,
                "headers": "X-Header:123",
                "params": "A:b",
                "body": None,
                "type": "http-request",
                "error_strategy": error_strategy,
                **retry_config,
            },
        }
        if default_value:
            node["data"]["default_value"] = default_value
        return node

    @staticmethod
    def get_error_status_code_http_node(error_strategy: str = "fail-branch", default_value: dict | None = None):
        """Helper method to create a http node configuration"""
        node = {
            "id": "node",
            "data": {
                "type": "http-request",
                "title": "HTTP Request",
                "desc": "",
                "variables": [],
                "method": "get",
                "url": "https://api.github.com/issues",
                "authorization": {"type": "no-auth", "config": None},
                "headers": "",
                "params": "",
                "body": {"type": "none", "data": []},
                "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0, "max_write_timeout": 0},
                "error_strategy": error_strategy,
            },
        }
        if default_value:
            node["data"]["default_value"] = default_value
        return node

    @staticmethod
    def get_tool_node(error_strategy: str = "fail-branch", default_value: dict | None = None):
        """Helper method to create a tool node configuration"""
        node = {
            "id": "node",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "maths",
                "provider_type": "builtin",
                "provider_name": "maths",
                "tool_name": "eval_expression",
                "tool_label": "eval_expression",
                "tool_configurations": {},
                "tool_parameters": {
                    "expression": {
                        "type": "variable",
                        "value": ["1", "123", "args1"],
                    }
                },
                "type": "tool",
                "error_strategy": error_strategy,
            },
        }
        if default_value:
            node.node_data.default_value = default_value
        return node

    @staticmethod
    def get_llm_node(error_strategy: str = "fail-branch", default_value: dict | None = None):
        """Helper method to create a llm node configuration"""
        node = {
            "id": "node",
            "data": {
                "title": "123",
                "type": "llm",
                "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
                "prompt_template": [
                    {"role": "system", "text": "you are a helpful assistant.\ntoday's weather is {{#abc.output#}}."},
                    {"role": "user", "text": "{{#sys.query#}}"},
                ],
                "memory": None,
                "context": {"enabled": False},
                "vision": {"enabled": False},
                "error_strategy": error_strategy,
            },
        }
        if default_value:
            node["data"]["default_value"] = default_value
        return node

    @staticmethod
    def create_test_graph_engine(graph_config: dict, user_inputs: dict | None = None):
        """Helper method to create a graph engine instance for testing"""
        # Create graph initialization parameters
        init_params = GraphInitParams(
            tenant_id="1",
            app_id="1",
            workflow_id="1",
            graph_config=graph_config,
            user_id="1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="aaa",
                files=[],
                query="clear",
                conversation_id="abababa",
            ),
            user_inputs=user_inputs or {"uid": "takato"},
        )

        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
        node_factory = DifyNodeFactory(init_params, graph_runtime_state)
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

        return GraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )


DEFAULT_VALUE_EDGE = [
    {
        "id": "start-source-node-target",
        "source": "start",
        "target": "node",
        "sourceHandle": "source",
    },
    {
        "id": "node-source-answer-target",
        "source": "node",
        "target": "answer",
        "sourceHandle": "source",
    },
]

FAIL_BRANCH_EDGES = [
    {
        "id": "start-source-node-target",
        "source": "start",
        "target": "node",
        "sourceHandle": "source",
    },
    {
        "id": "node-true-success-target",
        "source": "node",
        "target": "success",
        "sourceHandle": "source",
    },
    {
        "id": "node-false-error-target",
        "source": "node",
        "target": "error",
        "sourceHandle": "fail-branch",
    },
]


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_code_default_value_continue_on_error():
    error_code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """

    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.result#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_code_node(
                error_code, "default-value", [{"key": "result", "type": "number", "value": 132123}]
            ),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())
    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "132123"} for e in events)
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_code_fail_branch_continue_on_error():
    error_code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """

    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "node node run successfully"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "node node run failed"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_code_node(error_code),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1
    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "node node run failed"} for e in events
    )


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_http_node_default_value_continue_on_error():
    """Test HTTP node with default value error strategy"""
    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.response#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_http_node(
                "default-value", [{"key": "response", "type": "string", "value": "http node got error response"}]
            ),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "http node got error response"}
        for e in events
    )
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_http_node_fail_branch_continue_on_error():
    """Test HTTP node with fail-branch error strategy"""
    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "HTTP request successful"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "HTTP request failed"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_http_node(),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "HTTP request failed"} for e in events
    )
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


# def test_tool_node_default_value_continue_on_error():
#     """Test tool node with default value error strategy"""
#     graph_config = {
#         "edges": DEFAULT_VALUE_EDGE,
#         "nodes": [
#             {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
#             {"data": {"title": "answer", "type": "answer", "answer": "{{#node.result#}}"}, "id": "answer"},
#             ContinueOnErrorTestHelper.get_tool_node(
#                 "default-value", [{"key": "result", "type": "string", "value": "default tool result"}]
#             ),
#         ],
#     }

#     graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
#     events = list(graph_engine.run())

#     assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
#     assert any(
#         isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "default tool result"} for e in events  # noqa: E501
#     )
#     assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


# def test_tool_node_fail_branch_continue_on_error():
#     """Test HTTP node with fail-branch error strategy"""
#     graph_config = {
#         "edges": FAIL_BRANCH_EDGES,
#         "nodes": [
#             {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
#             {
#                 "data": {"title": "success", "type": "answer", "answer": "tool execute successful"},
#                 "id": "success",
#             },
#             {
#                 "data": {"title": "error", "type": "answer", "answer": "tool execute failed"},
#                 "id": "error",
#             },
#             ContinueOnErrorTestHelper.get_tool_node(),
#         ],
#     }

#     graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
#     events = list(graph_engine.run())

#     assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
#     assert any(
#         isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "tool execute failed"} for e in events  # noqa: E501
#     )
#     assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_llm_node_default_value_continue_on_error():
    """Test LLM node with default value error strategy"""
    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.answer#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_llm_node(
                "default-value", [{"key": "answer", "type": "string", "value": "default LLM response"}]
            ),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "default LLM response"} for e in events
    )
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_llm_node_fail_branch_continue_on_error():
    """Test LLM node with fail-branch error strategy"""
    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "LLM request successful"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "LLM request failed"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_llm_node(),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "LLM request failed"} for e in events
    )
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_status_code_error_http_node_fail_branch_continue_on_error():
    """Test HTTP node with fail-branch error strategy"""
    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "http execute successful"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "http execute failed"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_error_status_code_http_node(),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(
        isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {"answer": "http execute failed"} for e in events
    )
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 1


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_variable_pool_error_type_variable():
    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "http execute successful"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "http execute failed"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_error_status_code_http_node(),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    list(graph_engine.run())
    error_message = graph_engine.graph_runtime_state.variable_pool.get(["node", "error_message"])
    error_type = graph_engine.graph_runtime_state.variable_pool.get(["node", "error_type"])
    assert error_message != None
    assert error_type.value == "HTTPResponseCodeError"


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_no_node_in_fail_branch_continue_on_error():
    """Test HTTP node with fail-branch error strategy"""
    graph_config = {
        "edges": FAIL_BRANCH_EDGES[:-1],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "success", "type": "answer", "answer": "HTTP request successful"}, "id": "success"},
            ContinueOnErrorTestHelper.get_http_node(),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())

    assert any(isinstance(e, NodeRunExceptionEvent) for e in events)
    assert any(isinstance(e, GraphRunPartialSucceededEvent) and e.outputs == {} for e in events)
    assert sum(1 for e in events if isinstance(e, NodeRunStreamChunkEvent)) == 0


@pytest.mark.skip(
    reason="Continue-on-error functionality is part of Phase 2 enhanced error handling - "
    "not fully implemented in MVP of queue-based engine"
)
def test_stream_output_with_fail_branch_continue_on_error():
    """Test stream output with fail-branch error strategy"""
    graph_config = {
        "edges": FAIL_BRANCH_EDGES,
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {"title": "success", "type": "answer", "answer": "LLM request successful"},
                "id": "success",
            },
            {
                "data": {"title": "error", "type": "answer", "answer": "{{#node.text#}}"},
                "id": "error",
            },
            ContinueOnErrorTestHelper.get_llm_node(),
        ],
    }
    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)

    def llm_generator(self):
        contents = ["hi", "bye", "good morning"]

        yield NodeRunStreamChunkEvent(
            node_id=self.node_id,
            node_type=self._node_type,
            selector=[self.node_id, "text"],
            chunk=contents[0],
            is_final=False,
            # Legacy fields for compatibility
            chunk_content=contents[0],
            from_variable_selector=[self.node_id, "text"],
        )

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={},
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 1,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 1,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
                },
            )
        )

    with patch.object(LLMNode, "_run", new=llm_generator):
        events = list(graph_engine.run())
        assert sum(isinstance(e, NodeRunStreamChunkEvent) for e in events) == 1
        assert all(not isinstance(e, NodeRunFailedEvent | NodeRunExceptionEvent) for e in events)
