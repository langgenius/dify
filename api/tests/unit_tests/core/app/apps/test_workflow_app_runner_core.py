from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from core.app.apps.execution_coordinator import AppExecutionState
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueHumanInputFormFilledEvent,
    QueueIterationCompletedEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueReasoningChunkEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.workflow.nodes.agent.events import NodeRunAgentLogEvent
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import default_system_variables
from graphon.engine.layer import Layer
from graphon.engine_events import (
    GraphRunAbortedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from graphon.graph import Graph
from graphon.node_events import NodeRunResult
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables.factory import build_segment
from graphon.variables.variables import StringVariable
from models.workflow import Workflow
from services.workflow.execution.adapters.events import WorkflowEventPublisher, enqueue_human_input_notifications
from services.workflow.execution.adapters.graph import WorkflowGraphBuilder
from services.workflow.execution.adapters.workflow.app_queue_manager import WorkflowAppQueueManager
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from services.workflow_run_index import WorkflowRunIndex
from tests.unit_tests.model_factories import make_workflow


def _workflow(graph: dict[str, object] | None = None) -> Workflow:
    return make_workflow(
        tenant_id="tenant",
        app_id="app",
        graph=json.dumps(graph or {}, default=str),
        created_by="account",
    )


def _workflow_entry(_runner: object | None = None, state: RuntimeState | None = None) -> WorkflowEntry:
    state = state or RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
    graph = WorkflowGraphBuilder(app_id="app").build(
        graph_config={
            "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}],
            "edges": [],
        },
        graph_runtime_state=state,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    return WorkflowEntry(
        graph_config=graph.graph_config,
        graph=graph,
        call_depth=0,
        graph_runtime_state=state,
        human_form_reader=MagicMock(),
    )


def _nested_container_graph(ownership: str) -> dict:
    nodes = [
        {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
        {
            "id": "outer",
            "data": {
                "type": "loop",
                "title": "Outer loop",
                "start_node_id": "outer-start",
                "loop_count": 1,
                "break_conditions": [],
                "logical_operator": "and",
            },
        },
        {"id": "outer-start", "data": {"type": "loop-start", "title": "Loop start"}},
        {
            "id": "inner",
            "data": {
                "type": "iteration",
                "title": "Inner iteration",
                "start_node_id": "inner-start",
                "iterator_selector": ["start", "items"],
                "output_selector": ["inner", "item"],
            },
        },
        {"id": "inner-start", "data": {"type": "iteration-start", "title": "Iteration start"}},
        {
            "id": "deep",
            "data": {
                "type": "loop",
                "title": "Nested loop",
                "start_node_id": "deep-start",
                "loop_count": 1,
                "break_conditions": [],
                "logical_operator": "and",
            },
        },
        {"id": "deep-start", "data": {"type": "loop-start", "title": "Nested loop start"}},
        {"id": "end", "data": {"type": "end", "title": "Output", "outputs": []}},
    ]
    owners = {"outer-start": "outer", "inner": "outer", "inner-start": "inner", "deep": "inner", "deep-start": "deep"}
    for node in nodes:
        owner = owners.get(node["id"], "")
        if ownership == "canonical":
            node["data"]["container_id"] = owner
            # Canonical ownership, including the empty root owner, takes precedence.
            node["parentId"] = "stale-owner"
            node["data"]["loop_id"] = "stale-owner"
        elif ownership == "parent":
            if owner:
                node["parentId"] = owner
        elif owner:
            node["data"]["loop_id"] = "deep" if owner == "deep" else "outer"
            if owner in {"inner", "deep"}:
                node["data"]["iteration_id"] = "inner"
    return {
        "nodes": nodes,
        "edges": [
            {"id": "start-outer", "source": "start", "target": "outer"},
            {"id": "outer-end", "source": "outer", "target": "end"},
            {"id": "outer-start-inner", "source": "outer-start", "target": "inner"},
            {"id": "inner-start-deep", "source": "inner-start", "target": "deep"},
        ],
    }


class TestWorkflowExecutionAdapters:
    @pytest.mark.parametrize(
        ("event_class", "node_type"),
        [
            (NodeRunIterationStartedEvent, BuiltinNodeTypes.ITERATION),
            (NodeRunIterationSucceededEvent, BuiltinNodeTypes.ITERATION),
            (NodeRunLoopStartedEvent, BuiltinNodeTypes.LOOP),
            (NodeRunLoopSucceededEvent, BuiltinNodeTypes.LOOP),
        ],
    )
    def test_container_queue_events_preserve_lifecycle_and_ancestor_metadata(
        self,
        event_class: type[
            NodeRunIterationStartedEvent
            | NodeRunIterationSucceededEvent
            | NodeRunLoopStartedEvent
            | NodeRunLoopSucceededEvent
        ],
        node_type: str,
    ) -> None:
        queue = WorkflowAppQueueManager(
            task_id="metadata-contract", user_id="account", invoke_from=InvokeFrom.DEBUGGER, app_mode="workflow"
        )
        publisher = WorkflowEventPublisher(queue_manager=queue, notify_pause=enqueue_human_input_notifications)
        entry = _workflow_entry()
        event = event_class(
            id="container-execution",
            node_id="container",
            node_type=node_type,
            node_title="Container",
            start_at=datetime.now(UTC),
            metadata={"iteration_length": 2, "total_tokens": 1},
            node_run_result=NodeRunResult(
                metadata={
                    WorkflowNodeExecutionMetadataKey.LOOP_ID: "outer",
                    WorkflowNodeExecutionMetadataKey.LOOP_INDEX: 3,
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 2,
                }
            ),
        )
        original_event = event.model_dump()

        publisher.publish(entry, event)
        queue.stop_listen(execution_state=AppExecutionState.TERMINAL)
        messages = list(queue.listen())

        assert len(messages) == 1
        queued_event = messages[0].event
        assert isinstance(
            queued_event,
            QueueIterationStartEvent | QueueIterationCompletedEvent | QueueLoopStartEvent | QueueLoopCompletedEvent,
        )
        assert queued_event.metadata == {
            "iteration_length": 2,
            "total_tokens": 2,
            "loop_id": "outer",
            "loop_index": 3,
        }
        assert event.model_dump() == original_event

    def test_resolve_user_from(self):
        runner = WorkflowGraphBuilder(app_id="app")

        assert runner.resolve_user_from(InvokeFrom.EXPLORE) == UserFrom.ACCOUNT
        assert runner.resolve_user_from(InvokeFrom.DEBUGGER) == UserFrom.ACCOUNT
        assert runner.resolve_user_from(InvokeFrom.WEB_APP) == UserFrom.END_USER

    def test_init_graph_validates_graph_structure(self):
        runner = WorkflowGraphBuilder(app_id="app")

        runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )

        with pytest.raises(ValidationError, match="nodes"):
            runner.build(
                graph_config={},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            )

        with pytest.raises(ValidationError, match="nodes"):
            runner.build(
                graph_config={"nodes": {}, "edges": []},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            )

        with pytest.raises(ValidationError, match="edges"):
            runner.build(
                graph_config={"nodes": [], "edges": {}},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            )

    def test_init_graph_includes_trace_session_id_in_run_context(self, monkeypatch: pytest.MonkeyPatch):
        runner = WorkflowGraphBuilder(app_id="app")
        runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        captured = {}

        def fake_from_graph_init_context(**kwargs):
            graph_init_context = kwargs["graph_init_context"]
            captured["run_context"] = graph_init_context.run_context
            captured["call_depth"] = graph_init_context.call_depth
            captured["runtime_state"] = kwargs["runtime_state"]
            return SimpleNamespace()

        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.DifyNodeFactory.from_graph_init_context",
            fake_from_graph_init_context,
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.Graph.init", lambda **_kwargs: SimpleNamespace()
        )

        runner.build(
            graph_config={"nodes": [], "edges": []},
            graph_runtime_state=runtime_state,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            root_node_id="root",
            trace_session_id="session-1",
            call_depth=3,
        )

        assert captured["run_context"][DIFY_RUN_CONTEXT_KEY].trace_session_id == "session-1"
        assert captured["call_depth"] == 3
        assert captured["runtime_state"] is runtime_state

    @pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
    def test_init_graph_preserves_container_execution_scopes(self, ownership: str) -> None:
        runner = WorkflowGraphBuilder(app_id="app")
        runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        graph_config = _nested_container_graph(ownership)
        original_config = deepcopy(graph_config)
        graph = runner.build(
            graph_config=graph_config,
            graph_runtime_state=runtime_state,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            root_node_id="start",
            call_depth=0,
        )

        assert set(graph.nodes) == {"start", "outer", "end"}
        outer_graph = Graph.init(
            graph_config=graph.graph_config,
            node_factory=graph.node_factory,
            root_node_id="outer-start",
            container_id="outer",
        )
        assert set(outer_graph.nodes) == {"outer-start", "inner"}
        inner_graph = Graph.init(
            graph_config=outer_graph.graph_config,
            node_factory=outer_graph.node_factory,
            root_node_id="inner-start",
            container_id="inner",
        )
        assert set(inner_graph.nodes) == {"inner-start", "deep"}
        deep_graph = Graph.init(
            graph_config=inner_graph.graph_config,
            node_factory=inner_graph.node_factory,
            root_node_id="deep-start",
            container_id="deep",
        )
        assert set(deep_graph.nodes) == {"deep-start"}
        assert graph_config == original_config

    def test_prepare_single_node_execution_requires_run(self):
        runner = WorkflowGraphBuilder(app_id="app")

        workflow = _workflow()

        with pytest.raises(ValueError, match="Neither single_iteration_run nor single_loop_run"):
            runner.build_single_node(workflow, None, None, user_id="00000000-0000-0000-0000-000000000001")

    @pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
    @pytest.mark.parametrize("node_id", ["outer", "inner", "deep"])
    def test_single_container_debugging_preserves_descendants(self, ownership: str, node_id: str):
        runner = WorkflowGraphBuilder(app_id="app")
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )

        graph_config = _nested_container_graph(ownership)
        workflow = _workflow(graph_config)
        workflow.id = "workflow"
        graph_runtime_state.variable_pool.add(["start", "items"], ["first", "second"])

        graph, variable_pool = runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id=node_id,
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_label="iteration",
            user_id="00000000-0000-0000-0000-000000000001",
        )

        assert set(graph.nodes) == {node_id}
        assert variable_pool is graph_runtime_state.variable_pool
        deep_graph = Graph.init(
            graph_config=graph.graph_config,
            node_factory=graph.node_factory,
            root_node_id="deep-start",
            container_id="deep",
        )
        assert set(deep_graph.nodes) == {"deep-start"}

    def test_get_graph_and_variable_pool_for_single_node_run_does_not_mutate_inputs(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        runner = WorkflowGraphBuilder(app_id="app")
        graph_runtime_state = RuntimeState(
            workflow_id="workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        graph_config = {
            "nodes": [
                {"id": "node-1", "data": {"type": "start", "version": "1"}},
                {"id": "node-child", "data": {"type": "start", "version": "1", "iteration_id": "node-1"}},
                {"id": "outside", "data": {"type": "start", "version": "1"}},
            ],
            "edges": [
                {"id": "edge-1", "source": "node-1", "target": "node-child"},
                {"id": "edge-2", "source": "outside", "target": "node-1"},
            ],
        }
        expected_graph_config = deepcopy(graph_config)
        workflow = SimpleNamespace(tenant_id="tenant", id="workflow", graph_dict=graph_config)
        user_inputs = {"question": "hello"}
        expected_user_inputs = dict(user_inputs)
        captured_graph_config = {}

        def fake_graph_init(**kwargs):
            captured_graph_config["value"] = kwargs["graph_config"]
            return SimpleNamespace()

        class _NodeCls:
            @staticmethod
            def extract_variable_selector_to_variable_mapping(graph_config, config):
                return {}

        from services.workflow.execution.adapters import graph as workflow_app_runner

        monkeypatch.setattr("services.workflow.execution.adapters.graph.Graph.init", fake_graph_init)
        monkeypatch.setattr(workflow_app_runner, "resolve_workflow_node_class", lambda **_kwargs: _NodeCls)
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.load_into_variable_pool",
            lambda **kwargs: kwargs["user_inputs"].update({"from_loader": "local-only"}),
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.WorkflowEntry.mapping_user_inputs_to_variable_pool",
            lambda **kwargs: kwargs["user_inputs"].update({"from_mapping": "local-only"}),
        )

        graph, variable_pool = runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="node-1",
            user_inputs=user_inputs,
            graph_runtime_state=graph_runtime_state,
            node_type_label="iteration",
            user_id="00000000-0000-0000-0000-000000000001",
        )

        assert graph is not None
        assert variable_pool is graph_runtime_state.variable_pool
        assert workflow.graph_dict == expected_graph_config
        assert user_inputs == expected_user_inputs
        assert captured_graph_config["value"] is not workflow.graph_dict
        assert [node["id"] for node in captured_graph_config["value"]["nodes"]] == ["node-1", "node-child"]
        assert captured_graph_config["value"]["edges"] == [{"id": "edge-1", "source": "node-1", "target": "node-child"}]

    def test_get_graph_and_variable_pool_for_single_node_run_includes_trace_session_id(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        runner = WorkflowGraphBuilder(app_id="app")
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        graph_config = {
            "nodes": [{"id": "node-1", "data": {"type": "start", "version": "1"}}],
            "edges": [],
        }
        workflow = _workflow(graph_config)
        workflow.id = "workflow"
        captured = {}

        def fake_from_graph_init_context(**kwargs):
            captured["run_context"] = kwargs["graph_init_context"].run_context
            captured["runtime_state"] = kwargs["runtime_state"]
            return SimpleNamespace()

        class _NodeCls:
            @staticmethod
            def extract_variable_selector_to_variable_mapping(graph_config, config):
                return {}

        from services.workflow.execution.adapters import graph as workflow_app_runner

        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.DifyNodeFactory.from_graph_init_context",
            fake_from_graph_init_context,
        )
        monkeypatch.setattr("services.workflow.execution.adapters.graph.Graph.init", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr(workflow_app_runner, "resolve_workflow_node_class", lambda **_kwargs: _NodeCls)
        monkeypatch.setattr("services.workflow.execution.adapters.graph.load_into_variable_pool", lambda **kwargs: None)
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.WorkflowEntry.mapping_user_inputs_to_variable_pool",
            lambda **kwargs: None,
        )

        runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="node-1",
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_label="iteration",
            user_id="00000000-0000-0000-0000-000000000001",
            trace_session_id="session-1",
        )

        assert captured["run_context"][DIFY_RUN_CONTEXT_KEY].trace_session_id == "session-1"
        assert captured["runtime_state"] is graph_runtime_state

    def test_get_graph_and_variable_pool_preloads_constructor_variables_before_graph_init(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        variable_loader = SimpleNamespace(
            load_variables=lambda selectors: (
                [
                    StringVariable(
                        name="conversation_id",
                        value="conv-1",
                        selector=["sys", "conversation_id"],
                    )
                ]
                if selectors
                else []
            )
        )
        runner = WorkflowGraphBuilder(variable_loader=variable_loader, app_id="app")
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )

        workflow = _workflow(
            {
                "nodes": [
                    {"id": "loop-node", "data": {"type": "loop", "version": "1", "title": "Loop"}},
                    {
                        "id": "llm-child",
                        "data": {
                            "type": "llm",
                            "version": "1",
                            "loop_id": "loop-node",
                            "memory": object(),
                        },
                    },
                ],
                "edges": [],
            }
        )
        workflow.id = "workflow"

        class _LoopNodeCls:
            @staticmethod
            def extract_variable_selector_to_variable_mapping(graph_config, config):
                return {}

        def _graph_init(**kwargs):
            variable_pool = graph_runtime_state.variable_pool
            assert variable_pool.get(["sys", "conversation_id"]) is not None
            return SimpleNamespace()

        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.Graph.init",
            _graph_init,
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.resolve_workflow_node_class",
            lambda **_kwargs: _LoopNodeCls,
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.load_into_variable_pool",
            lambda **kwargs: None,
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.graph.WorkflowEntry.mapping_user_inputs_to_variable_pool",
            lambda **kwargs: None,
        )

        graph, variable_pool = runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="loop-node",
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_label="loop",
        )

        assert graph is not None
        assert variable_pool.get(["sys", "conversation_id"]).value == "conv-1"

    def test_handle_graph_run_events_and_pause_notifications(self, monkeypatch: pytest.MonkeyPatch):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append((event, publish_from))

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        workflow_entry = _workflow_entry(runner, graph_runtime_state)

        emails: list[dict] = []

        class _Dispatch:
            def apply_async(self, *, kwargs, queue):
                emails.append({"kwargs": kwargs, "queue": queue})

        monkeypatch.setattr(
            "services.workflow.execution.adapters.events.dispatch_human_input_email_task",
            _Dispatch(),
        )
        enriched_reason = HumanInputRequired(
            form_id="form",
            form_content="content",
            node_id="node-1",
            node_title="Node",
        )

        reason = HitlRequired(
            session_id="form",
            node_id="node-1",
            node_title="Node",
        )

        runner.publish(workflow_entry, GraphRunStartedEvent())
        runner.publish(workflow_entry, GraphRunSucceededEvent(outputs={"ok": True}))
        runner.publish(
            workflow_entry, GraphRunPausedEvent(reasons=[reason], outputs={}), pause_reasons=[enriched_reason]
        )

        assert any(isinstance(event, QueueWorkflowStartedEvent) for event, _ in published)
        assert any(isinstance(event, QueueWorkflowSucceededEvent) for event, _ in published)
        paused_event = next(event for event, _ in published if isinstance(event, QueueWorkflowPausedEvent))
        assert paused_event.paused_nodes == ["node-1"]
        assert emails

    def test_handle_graph_aborted_publishes_stopped_terminal(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                del publish_from
                published.append(event)

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        workflow_entry = _workflow_entry(runner)

        runner.publish(workflow_entry, GraphRunAbortedEvent(reason="User requested stop", outputs={}))

        event = published[-1]
        assert isinstance(event, QueueStopEvent)
        assert event.get_stop_reason() == "User requested stop"

    def test_handle_node_events_publishes_queue_events(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        workflow_entry = _workflow_entry(runner, graph_runtime_state)

        runner.publish(
            workflow_entry,
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                node_title="Start",
                start_at=datetime.now(UTC),
            ),
        )
        runner.publish(
            workflow_entry,
            NodeRunStreamChunkEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                selector=["node", "text"],
                chunk="hi",
                is_final=False,
            ),
        )
        runner.publish(
            workflow_entry,
            NodeRunReasoningChunkEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                selector=["node", "reasoning_content"],
                chunk="thinking",
                is_final=False,
            ),
        )
        runner.publish(
            workflow_entry,
            NodeRunAgentLogEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                message_id="msg",
                label="label",
                node_execution_id="exec",
                parent_id=None,
                error=None,
                status="done",
                data={},
                metadata={},
            ),
        )
        runner.publish(
            workflow_entry,
            NodeRunIterationSucceededEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Iter",
                start_at=datetime.now(UTC),
                inputs={},
                outputs={"ok": True},
                metadata={},
                steps=1,
            ),
        )
        runner.publish(
            workflow_entry,
            NodeRunLoopFailedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Loop",
                start_at=datetime.now(UTC),
                inputs={},
                outputs={},
                metadata={},
                steps=1,
                error="boom",
            ),
        )

        assert any(isinstance(event, QueueTextChunkEvent) for event in published)
        assert any(isinstance(event, QueueReasoningChunkEvent) for event in published)
        assert any(isinstance(event, QueueAgentLogEvent) for event in published)
        assert any(isinstance(event, QueueIterationCompletedEvent) for event in published)
        assert any(isinstance(event, QueueLoopCompletedEvent) for event in published)

    def test_handle_human_input_form_filled_event_preserves_submitted_data(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        publisher = WorkflowEventPublisher(
            queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications
        )
        workflow_entry = _workflow_entry()
        submitted_data = {"decision": build_segment("approve")}

        publisher.publish(
            workflow_entry,
            NodeRunHumanInputFormFilledEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.HUMAN_INPUT,
                node_title="Human Input",
                rendered_content="content",
                action_id="approve",
                action_text="Approve",
                submitted_data=submitted_data,
            ),
        )

        queue_event = published[-1]
        assert isinstance(queue_event, QueueHumanInputFormFilledEvent)
        assert queue_event.submitted_data == submitted_data

    @pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
    def test_nested_engine_events_retain_both_container_ancestors(self, ownership: str):
        from tests.unit_tests.core.app.workflow.test_persistence_layer import _make_layer

        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                del publish_from
                published.append(event)

        graph_config = _nested_container_graph(ownership)
        graph_config["nodes"].append(
            {"id": "deep-end", "data": {"type": "end", "title": "Nested End", "outputs": [], "container_id": "deep"}}
        )
        graph_config["edges"].append({"id": "deep-output", "source": "deep-start", "target": "deep-end"})
        layer, _, node_repo, state = _make_layer(graph_data=graph_config)
        persisted_starts: dict[str, dict] = {}

        class _StartMetadataLayer(Layer):
            @override
            def on_event(self, event):
                if isinstance(event, NodeRunStartedEvent):
                    persisted_starts[event.node_id] = dict(node_repo.saved[-1].metadata)

        state.variable_pool.add(["start", "items"], ["item"])
        builder = WorkflowGraphBuilder(app_id="app")
        publisher = WorkflowEventPublisher(
            queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications
        )
        graph = builder.build(
            graph_config=graph_config,
            graph_runtime_state=state,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        )
        human_form_reader = MagicMock()
        entry = WorkflowEntry(
            graph_config=graph.graph_config,
            graph=graph,
            call_depth=0,
            graph_runtime_state=state,
            human_form_reader=human_form_reader,
        )
        engine = entry.graph_engine
        index = WorkflowRunIndex(())
        layer.set_node_run_indices(index.indices)
        engine.add_layer(index)
        engine.add_layer(layer)
        engine.add_layer(_StartMetadataLayer())
        for event in iter_dify_graph_engine_events(engine, human_form_reader=human_form_reader):
            publisher.publish(entry, event)

        expected = {
            "outer": (None, None),
            "inner": (None, "outer"),
            "deep": ("inner", "outer"),
            "deep-end": ("inner", "deep"),
        }
        started = {event.node_id: event for event in published if isinstance(event, QueueNodeStartedEvent)}
        persisted = {event.node_id: event for event in node_repo.saved}
        for node_id, (iteration_id, loop_id) in expected.items():
            assert (started[node_id].in_iteration_id, started[node_id].in_loop_id) == (iteration_id, loop_id)
            for metadata in (persisted_starts[node_id], persisted[node_id].metadata):
                assert (metadata.get("iteration_id"), metadata.get("loop_id")) == (iteration_id, loop_id)
        for metadata in (persisted_starts["deep-end"], persisted["deep-end"].metadata):
            assert metadata["iteration_index"] == 0
            assert metadata["loop_index"] == 0
        for event in published:
            if isinstance(
                event,
                QueueIterationStartEvent | QueueIterationCompletedEvent | QueueLoopStartEvent | QueueLoopCompletedEvent,
            ):
                assert (event.metadata.get("iteration_id"), event.metadata.get("loop_id")) == expected[event.node_id]

    def test_handle_nested_answer_success_publishes_text_chunk(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        workflow_entry = _workflow_entry(runner)

        runner.publish(
            workflow_entry,
            NodeRunSucceededEvent(
                id="exec",
                node_id="answer-in-iteration",
                node_type=BuiltinNodeTypes.ANSWER,
                start_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                node_run_result=NodeRunResult(
                    outputs={"answer": "inside iteration"}, metadata={"iteration_id": "iteration"}
                ),
                container_id="iteration",
            ),
        )

        text_chunk = published[0]
        assert isinstance(text_chunk, QueueTextChunkEvent)
        assert text_chunk.text == "inside iteration"
        assert text_chunk.from_variable_selector == ["answer-in-iteration", "answer"]
        assert text_chunk.in_iteration_id == "iteration"
        assert any(isinstance(event, QueueNodeSucceededEvent) for event in published)

    def test_handle_root_answer_success_does_not_publish_extra_text_chunk(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        workflow_entry = _workflow_entry(runner)

        runner.publish(
            workflow_entry,
            NodeRunSucceededEvent(
                id="exec",
                node_id="answer",
                node_type=BuiltinNodeTypes.ANSWER,
                start_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                node_run_result=NodeRunResult(outputs={"answer": "root answer"}),
            ),
        )

        assert not any(isinstance(event, QueueTextChunkEvent) for event in published)
        assert len(published) == 1
        assert isinstance(published[0], QueueNodeSucceededEvent)

    @pytest.mark.parametrize(
        ("event_factory", "queue_event_cls"),
        [
            (
                lambda result, start_at, finished_at: NodeRunSucceededEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.START,
                    start_at=start_at,
                    finished_at=finished_at,
                    node_run_result=result,
                ),
                QueueNodeSucceededEvent,
            ),
            (
                lambda result, start_at, finished_at: NodeRunFailedEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.START,
                    start_at=start_at,
                    finished_at=finished_at,
                    error="boom",
                    node_run_result=result,
                ),
                QueueNodeFailedEvent,
            ),
            (
                lambda result, start_at, finished_at: NodeRunExceptionEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.START,
                    start_at=start_at,
                    finished_at=finished_at,
                    error="boom",
                    node_run_result=result,
                ),
                QueueNodeExceptionEvent,
            ),
            (
                lambda result, start_at, _finished_at: NodeRunRetryEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.START,
                    node_title="Start",
                    start_at=start_at,
                    error="boom",
                    retry_index=1,
                    node_run_result=result,
                ),
                QueueNodeRetryEvent,
            ),
        ],
    )
    def test_handle_start_node_result_events_project_outputs(self, event_factory, queue_event_cls):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        runner = WorkflowEventPublisher(queue_manager=_QueueManager(), notify_pause=enqueue_human_input_notifications)
        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
            start_at=0.0,
        )
        workflow_entry = _workflow_entry(runner, graph_runtime_state)
        started_at = datetime.now(UTC)
        finished_at = datetime.now(UTC)
        result = NodeRunResult(
            inputs={"question": "hello"},
            outputs={
                "question": "hello",
                "sys.query": "hello",
                "env.API_KEY": "secret",
                "conversation.session_id": "session-1",
            },
        )

        runner.publish(workflow_entry, event_factory(result, started_at, finished_at))

        queue_event = published[-1]
        assert isinstance(queue_event, queue_event_cls)
        assert queue_event.outputs == {"question": "hello"}
