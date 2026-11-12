import logging
from collections.abc import Generator

import pytest

from core.agent.plugin_entities import AgentStrategyParameter
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.agent.events import AgentLogEvent, NodeRunAgentLogEvent
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from core.workflow.nodes.agent.runtime_support import AgentRuntimeSupport
from graphon.engine_events import NodeRunStreamChunkEvent
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from graphon.runtime import InitParams, RuntimeState, VariablePool


class _RecordingStrategy:
    """Supply a deterministic strategy and retain its invocation arguments."""

    meta_version = None

    def __init__(self) -> None:
        self.invocations: list[dict[str, object]] = []
        self.message_stream: Generator[ToolInvokeMessage] | None = None

    def get_parameters(self) -> list[AgentStrategyParameter]:
        return []

    def invoke(self, **kwargs: object) -> Generator[ToolInvokeMessage]:
        self.invocations.append(kwargs)
        self.message_stream = (message for message in [])
        return self.message_stream


class _StrategyResolver:
    """Resolve the test's concrete strategy."""

    def __init__(self, strategy: _RecordingStrategy) -> None:
        self.strategy = strategy

    def resolve(self, **_kwargs: object) -> _RecordingStrategy:
        return self.strategy


class _PresentationProvider:
    """Expose a stable icon to the node."""

    def get_icon(self, **_kwargs: object) -> str:
        return "agent-icon"


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
        strategy_resolver=_StrategyResolver(_RecordingStrategy()),
        presentation_provider=_PresentationProvider(),
        runtime_support=AgentRuntimeSupport(),
        message_transformer=AgentMessageTransformer(),
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


def test_run_continues_when_tool_snapshot_capture_fails(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    strategy = _RecordingStrategy()
    parameters = {"query": "hello"}
    parameters_for_log = {"query": "hello"}
    runtime_support = AgentRuntimeSupport()

    def build_parameters(**_kwargs: object) -> dict[str, str]:
        return parameters

    def fail_snapshot(**_kwargs: object) -> None:
        raise RuntimeError("snapshot failed")

    monkeypatch.setattr(runtime_support, "build_parameters", build_parameters)
    monkeypatch.setattr(runtime_support, "build_model_visible_tool_snapshots", fail_snapshot)
    monkeypatch.setattr(runtime_support, "build_credentials", lambda **_kwargs: None)

    completed_event = StreamCompletedEvent(node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED))
    message_transformer = AgentMessageTransformer()
    transform_calls: list[dict[str, object]] = []

    def transform(**kwargs: object) -> Generator[StreamCompletedEvent]:
        transform_calls.append(kwargs)
        yield completed_event

    monkeypatch.setattr(message_transformer, "transform", transform)

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
        runtime_state=RuntimeState(workflow_id="workflow-id", variable_pool=VariablePool(), start_at=0),
        strategy_resolver=_StrategyResolver(strategy),
        presentation_provider=_PresentationProvider(),
        runtime_support=runtime_support,
        message_transformer=message_transformer,
    )
    node._node_execution_id = "execution-id"

    with caplog.at_level(logging.WARNING, logger="core.workflow.nodes.agent.agent_node"):
        events = list(node._run())

    assert events == [completed_event]
    assert strategy.invocations == [
        {
            "params": parameters,
            "user_id": "user-id",
            "app_id": "app-id",
            "conversation_id": None,
            "credentials": None,
        }
    ]
    assert len(transform_calls) == 1
    transform_kwargs = transform_calls[0]
    assert transform_kwargs["messages"] is strategy.message_stream
    assert transform_kwargs["parameters_for_log"] == parameters_for_log
    assert transform_kwargs["tool_info"] == {
        "icon": "agent-icon",
        "agent_strategy": "strategy",
        "available_tools": None,
    }
    assert "continuing without the snapshot" in caplog.text
