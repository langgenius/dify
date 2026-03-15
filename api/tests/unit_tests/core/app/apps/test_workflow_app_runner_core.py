from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueIterationCompletedEvent,
    QueueLoopCompletedEvent,
    QueueTextChunkEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from dify_graph.entities.pause_reason import HumanInputRequired
from dify_graph.enums import BuiltinNodeTypes
from dify_graph.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunAgentLogEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
)
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable


class TestWorkflowBasedAppRunner:
    def test_resolve_user_from(self):
        runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

        assert runner._resolve_user_from(InvokeFrom.EXPLORE) == UserFrom.ACCOUNT
        assert runner._resolve_user_from(InvokeFrom.DEBUGGER) == UserFrom.ACCOUNT
        assert runner._resolve_user_from(InvokeFrom.WEB_APP) == UserFrom.END_USER

    def test_init_graph_validates_graph_structure(self):
        runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

        runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
            start_at=0.0,
        )

        with pytest.raises(ValueError, match="nodes or edges not found"):
            runner._init_graph(
                graph_config={},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )

        with pytest.raises(ValueError, match="nodes in workflow graph must be a list"):
            runner._init_graph(
                graph_config={"nodes": {}, "edges": []},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )

        with pytest.raises(ValueError, match="edges in workflow graph must be a list"):
            runner._init_graph(
                graph_config={"nodes": [], "edges": {}},
                graph_runtime_state=runtime_state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )

    def test_prepare_single_node_execution_requires_run(self):
        runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

        workflow = SimpleNamespace(environment_variables=[], graph_dict={})

        with pytest.raises(ValueError, match="Neither single_iteration_run nor single_loop_run"):
            runner._prepare_single_node_execution(workflow, None, None)

    def test_get_graph_and_variable_pool_for_single_node_run(self, monkeypatch):
        runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
            start_at=0.0,
        )

        graph_config = {
            "nodes": [{"id": "node-1", "data": {"type": "start", "version": "1"}}],
            "edges": [],
        }
        workflow = SimpleNamespace(tenant_id="tenant", id="workflow", graph_dict=graph_config)

        monkeypatch.setattr(
            "core.app.apps.workflow_app_runner.Graph.init",
            lambda **kwargs: SimpleNamespace(),
        )

        class _NodeCls:
            @staticmethod
            def extract_variable_selector_to_variable_mapping(graph_config, config):
                return {}

        from core.app.apps import workflow_app_runner

        monkeypatch.setattr(
            workflow_app_runner,
            "resolve_workflow_node_class",
            lambda **_kwargs: _NodeCls,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow_app_runner.load_into_variable_pool",
            lambda **kwargs: None,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow_app_runner.WorkflowEntry.mapping_user_inputs_to_variable_pool",
            lambda **kwargs: None,
        )

        graph, variable_pool = runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="node-1",
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_filter_key="iteration_id",
            node_type_label="iteration",
        )

        assert graph is not None
        assert variable_pool is graph_runtime_state.variable_pool

    def test_handle_graph_run_events_and_pause_notifications(self, monkeypatch):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append((event, publish_from))

        runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
            start_at=0.0,
        )
        graph_runtime_state.register_paused_node("node-1")
        workflow_entry = SimpleNamespace(graph_engine=SimpleNamespace(graph_runtime_state=graph_runtime_state))

        emails: list[dict] = []

        class _Dispatch:
            def apply_async(self, *, kwargs, queue):
                emails.append({"kwargs": kwargs, "queue": queue})

        monkeypatch.setattr(
            "core.app.apps.workflow_app_runner.dispatch_human_input_email_task",
            _Dispatch(),
        )

        reason = HumanInputRequired(
            form_id="form",
            form_content="content",
            node_id="node-1",
            node_title="Node",
        )

        runner._handle_event(workflow_entry, GraphRunStartedEvent())
        runner._handle_event(workflow_entry, GraphRunSucceededEvent(outputs={"ok": True}))
        runner._handle_event(workflow_entry, GraphRunPausedEvent(reasons=[reason], outputs={}))

        assert any(isinstance(event, QueueWorkflowStartedEvent) for event, _ in published)
        assert any(isinstance(event, QueueWorkflowSucceededEvent) for event, _ in published)
        paused_event = next(event for event, _ in published if isinstance(event, QueueWorkflowPausedEvent))
        assert paused_event.paused_nodes == ["node-1"]
        assert emails

    def test_handle_node_events_publishes_queue_events(self):
        published: list[object] = []

        class _QueueManager:
            def publish(self, event, publish_from):
                published.append(event)

        runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
            start_at=0.0,
        )
        workflow_entry = SimpleNamespace(graph_engine=SimpleNamespace(graph_runtime_state=graph_runtime_state))

        runner._handle_event(
            workflow_entry,
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                node_title="Start",
                start_at=datetime.utcnow(),
            ),
        )
        runner._handle_event(
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
        runner._handle_event(
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
        runner._handle_event(
            workflow_entry,
            NodeRunIterationSucceededEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Iter",
                start_at=datetime.utcnow(),
                inputs={},
                outputs={"ok": True},
                metadata={},
                steps=1,
            ),
        )
        runner._handle_event(
            workflow_entry,
            NodeRunLoopFailedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Loop",
                start_at=datetime.utcnow(),
                inputs={},
                outputs={},
                metadata={},
                steps=1,
                error="boom",
            ),
        )

        assert any(isinstance(event, QueueTextChunkEvent) for event in published)
        assert any(isinstance(event, QueueAgentLogEvent) for event in published)
        assert any(isinstance(event, QueueIterationCompletedEvent) for event in published)
        assert any(isinstance(event, QueueLoopCompletedEvent) for event in published)
