import logging
from unittest.mock import MagicMock

import pytest

from core.agent.plugin_entities import AgentStrategyParameter
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.agent.events import AgentLogEvent, NodeRunAgentLogEvent
from graphon.engine_events import NodeRunStreamChunkEvent
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from graphon.runtime import InitParams, RuntimeState, VariablePool


def test_dispatch_converts_agent_events_and_delegates_other_events() -> None:
    node = AgentNode(
        node_id="node-id",
        data=AgentNodeData(title="Agent"),
        init_params=InitParams(
            workflow_id="workflow-id",
            graph_config={},
            run_context={},
            call_depth=0,
        ),
        runtime_state=RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0),
        strategy_resolver=MagicMock(),
        presentation_provider=MagicMock(),
        runtime_support=MagicMock(),
        message_transformer=MagicMock(),
    )
    node._node_execution_id = "execution-id"

    graph_event = node._dispatch(
        AgentLogEvent(
            message_id="message-id",
            label="label",
            node_execution_id="agent-execution-id",
            parent_id="parent-id",
            error=None,
            status="succeeded",
            data={"output": "done"},
            metadata={"provider": "test"},
            node_id="source-node-id",
        )
    )

    assert graph_event == NodeRunAgentLogEvent(
        id="execution-id",
        node_id="node-id",
        node_type=BuiltinNodeTypes.AGENT,
        message_id="message-id",
        label="label",
        node_execution_id="agent-execution-id",
        parent_id="parent-id",
        error=None,
        status="succeeded",
        data={"output": "done"},
        metadata={"provider": "test"},
    )
    assert isinstance(
        node._dispatch(StreamChunkEvent(selector=["node-id", "text"], chunk="hello")),
        NodeRunStreamChunkEvent,
    )


def test_run_continues_when_tool_snapshot_capture_fails(caplog: pytest.LogCaptureFixture) -> None:
    strategy = MagicMock()
    agent_parameters: list[AgentStrategyParameter] = []
    parameters = {"query": "hello"}
    parameters_for_log = {"query": "hello"}
    credentials = MagicMock()
    message_stream = iter(())
    strategy.get_parameters.return_value = agent_parameters
    strategy.invoke.return_value = message_stream

    strategy_resolver = MagicMock()
    strategy_resolver.resolve.return_value = strategy
    presentation_provider = MagicMock()
    presentation_provider.get_icon.return_value = "agent-icon"
    runtime_support = MagicMock()
    runtime_support.build_parameters.side_effect = [parameters, parameters_for_log]
    runtime_support.build_model_visible_tool_snapshots.side_effect = RuntimeError("snapshot failed")
    runtime_support.build_credentials.return_value = credentials

    completed_event = StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))
    message_transformer = MagicMock()
    message_transformer.transform.return_value = iter([completed_event])

    node = AgentNode(
        node_id="node-id",
        data=AgentNodeData(
            title="Agent",
            agent_strategy_provider_name="provider",
            agent_strategy_name="strategy",
        ),
        init_params=InitParams(
            workflow_id="workflow-id",
            graph_config={},
            run_context={
                DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                    tenant_id="tenant-id",
                    app_id="app-id",
                    user_id="user-id",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                )
            },
            call_depth=0,
        ),
        runtime_state=RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0),
        strategy_resolver=strategy_resolver,
        presentation_provider=presentation_provider,
        runtime_support=runtime_support,
        message_transformer=message_transformer,
    )
    node._node_execution_id = "execution-id"

    with caplog.at_level(logging.WARNING, logger="core.workflow.nodes.agent.agent_node"):
        events = list(node._run())

    assert events == [completed_event]
    strategy.invoke.assert_called_once_with(
        params=parameters,
        user_id="user-id",
        app_id="app-id",
        conversation_id=None,
        credentials=credentials,
    )
    transform_kwargs = message_transformer.transform.call_args.kwargs
    assert transform_kwargs["messages"] is message_stream
    assert transform_kwargs["tool_info"] == {
        "icon": "agent-icon",
        "agent_strategy": "strategy",
        "available_tools": None,
    }
    assert "continuing without the snapshot" in caplog.text
