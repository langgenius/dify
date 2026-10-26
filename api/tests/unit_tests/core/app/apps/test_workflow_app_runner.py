from __future__ import annotations

import json
from collections.abc import Generator, Mapping
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from time import perf_counter
from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock, PropertyMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from pydantic import ValidationError
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.common import workflow_response_converter
from core.app.apps.execution_coordinator import AppExecutionState
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.apps.workflow_app_runner import PreparedWorkflowRun, WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAgentLogEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
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
from core.credit_usage import CreditUsageAppType
from core.db.session_factory import session_factory
from core.repositories.human_input_repository import HumanInputFormRepositoryImpl, HumanInputFormSubmissionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_runtime import DifyFileReferenceFactory
from core.workflow.nodes.agent.events import NodeRunAgentLogEvent
from core.workflow.nodes.human_input.boundary import human_input_container_selector
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormDefinition,
    HumanInputNodeData,
    ParagraphInputConfig,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import default_system_variables
from core.workflow.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from extensions.storage.storage_type import StorageType
from graphon.engine.layer import Layer
from graphon.engine.ready_queue import StartTask
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
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
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowType
from graphon.file.helpers import verify_file_signature
from graphon.graph import Graph
from graphon.node_events import NodeRunResult
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphonHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.variables.variables import StringVariable
from models import Account, UploadFile
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from models.model import AppMode
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionTriggeredFrom
from models.workflow import WorkflowType as ModelWorkflowType
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_run_index import WorkflowRunIndex
from tests.helpers.unit.model_factories import make_workflow
from tests.unit_tests.core.app.apps.advanced_chat.test_generate_task_pipeline import (
    _build_generate_entity,
    _build_pipeline,
)
from tests.unit_tests.core.app.apps.common.test_workflow_response_converter import (
    _workflow_response_converter_human_input_build_converter as _build_converter,
)
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context


def _workflow(graph: dict[str, object] | None = None) -> Workflow:
    return make_workflow(
        tenant_id="tenant",
        app_id="app",
        graph=json.dumps(graph or {}, default=str),
        created_by="account",
    )


def _workflow_entry(runner: WorkflowBasedAppRunner, state: RuntimeState | None = None) -> WorkflowEntry:
    state = state or RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
    graph = runner._init_graph(
        graph_config={
            "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}],
            "edges": [],
        },
        graph_runtime_state=state,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    return WorkflowEntry(graph_config=graph.graph_config, graph=graph, call_depth=0, graph_runtime_state=state)


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


class TestWorkflowAppRunnerCoreCases:
    class TestWorkflowBasedAppRunner:
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
            runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
            entry = _workflow_entry(runner)
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

            runner.handle_event(entry, event)
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
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

            assert runner._resolve_user_from(InvokeFrom.EXPLORE) == UserFrom.ACCOUNT
            assert runner._resolve_user_from(InvokeFrom.DEBUGGER) == UserFrom.ACCOUNT
            assert runner._resolve_user_from(InvokeFrom.WEB_APP) == UserFrom.END_USER

        def test_init_graph_validates_graph_structure(self):
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

            runtime_state = RuntimeState(
                workflow_id="test-workflow",
                variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
                start_at=0.0,
            )

            with pytest.raises(ValidationError, match="nodes"):
                runner._init_graph(
                    graph_config={},
                    graph_runtime_state=runtime_state,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    call_depth=0,
                )

            with pytest.raises(ValidationError, match="nodes"):
                runner._init_graph(
                    graph_config={"nodes": {}, "edges": []},
                    graph_runtime_state=runtime_state,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    call_depth=0,
                )

            with pytest.raises(ValidationError, match="edges"):
                runner._init_graph(
                    graph_config={"nodes": [], "edges": {}},
                    graph_runtime_state=runtime_state,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    call_depth=0,
                )

        def test_init_graph_includes_trace_session_id_in_run_context(self, monkeypatch: pytest.MonkeyPatch):
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
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
                "core.app.apps.workflow_app_runner.DifyNodeFactory.from_graph_init_context",
                fake_from_graph_init_context,
            )
            monkeypatch.setattr("core.app.apps.workflow_app_runner.Graph.init", lambda **_kwargs: SimpleNamespace())

            runner._init_graph(
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
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
            runtime_state = RuntimeState(
                workflow_id="test-workflow",
                variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
                start_at=0.0,
            )
            graph_config = _nested_container_graph(ownership)
            original_config = deepcopy(graph_config)
            graph = runner._init_graph(
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
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")

            workflow = _workflow()

            with pytest.raises(ValueError, match="Neither single_iteration_run nor single_loop_run"):
                runner._prepare_single_node_execution(
                    workflow, None, None, user_id="00000000-0000-0000-0000-000000000001"
                )

        @pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
        @pytest.mark.parametrize("node_id", ["outer", "inner", "deep"])
        def test_single_container_debugging_preserves_descendants(self, ownership: str, node_id: str):
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
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
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
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

            from core.app.apps import workflow_app_runner

            monkeypatch.setattr("core.app.apps.workflow_app_runner.Graph.init", fake_graph_init)
            monkeypatch.setattr(workflow_app_runner, "resolve_workflow_node_class", lambda **_kwargs: _NodeCls)
            monkeypatch.setattr(
                "core.app.apps.workflow_app_runner.load_into_variable_pool",
                lambda **kwargs: kwargs["user_inputs"].update({"from_loader": "local-only"}),
            )
            monkeypatch.setattr(
                "core.app.apps.workflow_app_runner.WorkflowEntry.mapping_user_inputs_to_variable_pool",
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
            assert captured_graph_config["value"]["edges"] == [
                {"id": "edge-1", "source": "node-1", "target": "node-child"}
            ]

        def test_get_graph_and_variable_pool_for_single_node_run_includes_trace_session_id(
            self, monkeypatch: pytest.MonkeyPatch
        ):
            runner = WorkflowBasedAppRunner(queue_manager=SimpleNamespace(), app_id="app")
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

            from core.app.apps import workflow_app_runner

            monkeypatch.setattr(
                "core.app.apps.workflow_app_runner.DifyNodeFactory.from_graph_init_context",
                fake_from_graph_init_context,
            )
            monkeypatch.setattr("core.app.apps.workflow_app_runner.Graph.init", lambda **kwargs: SimpleNamespace())
            monkeypatch.setattr(workflow_app_runner, "resolve_workflow_node_class", lambda **_kwargs: _NodeCls)
            monkeypatch.setattr("core.app.apps.workflow_app_runner.load_into_variable_pool", lambda **kwargs: None)
            monkeypatch.setattr(
                "core.app.apps.workflow_app_runner.WorkflowEntry.mapping_user_inputs_to_variable_pool",
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
            runner = WorkflowBasedAppRunner(
                queue_manager=SimpleNamespace(),
                variable_loader=variable_loader,
                app_id="app",
            )
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
                "core.app.apps.workflow_app_runner.Graph.init",
                _graph_init,
            )
            monkeypatch.setattr(
                "core.app.apps.workflow_app_runner.resolve_workflow_node_class",
                lambda **_kwargs: _LoopNodeCls,
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

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
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
                "core.app.apps.workflow_app_runner.dispatch_human_input_email_task",
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

            runner.handle_event(workflow_entry, GraphRunStartedEvent())
            runner.handle_event(workflow_entry, GraphRunSucceededEvent(outputs={"ok": True}))
            runner.handle_event(
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

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
            workflow_entry = _workflow_entry(runner)

            runner.handle_event(workflow_entry, GraphRunAbortedEvent(reason="User requested stop", outputs={}))

            event = published[-1]
            assert isinstance(event, QueueStopEvent)
            assert event.get_stop_reason() == "User requested stop"

        def test_handle_node_events_publishes_queue_events(self):
            published: list[object] = []

            class _QueueManager:
                def publish(self, event, publish_from):
                    published.append(event)

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
            graph_runtime_state = RuntimeState(
                workflow_id="test-workflow",
                variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables()),
                start_at=0.0,
            )
            workflow_entry = _workflow_entry(runner, graph_runtime_state)

            runner.handle_event(
                workflow_entry,
                NodeRunStartedEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.START,
                    node_title="Start",
                    start_at=datetime.now(UTC),
                ),
            )
            runner.handle_event(
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
            runner.handle_event(
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
            runner.handle_event(
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
            runner.handle_event(
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
            runner.handle_event(
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

        @pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
        def test_nested_engine_events_retain_both_container_ancestors(self, ownership: str):
            from tests.unit_tests.services.test_workflow_persistence import _make_layer

            published: list[object] = []

            class _QueueManager:
                def publish(self, event, publish_from):
                    del publish_from
                    published.append(event)

            graph_config = _nested_container_graph(ownership)
            graph_config["nodes"].append(
                {
                    "id": "deep-end",
                    "data": {"type": "end", "title": "Nested End", "outputs": [], "container_id": "deep"},
                }
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
            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
            graph = runner._init_graph(
                graph_config=graph_config,
                graph_runtime_state=state,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            )
            entry = WorkflowEntry(graph_config=graph.graph_config, graph=graph, call_depth=0, graph_runtime_state=state)
            engine = entry.graph_engine
            index = WorkflowRunIndex(())
            layer.set_node_run_indices(index.indices)
            engine.add_layer(index)
            engine.add_layer(layer)
            engine.add_layer(_StartMetadataLayer())
            for event in iter_dify_graph_engine_events(engine):
                runner.handle_event(entry, event)

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
                    QueueIterationStartEvent
                    | QueueIterationCompletedEvent
                    | QueueLoopStartEvent
                    | QueueLoopCompletedEvent,
                ):
                    assert (event.metadata.get("iteration_id"), event.metadata.get("loop_id")) == expected[
                        event.node_id
                    ]

        def test_handle_nested_answer_success_publishes_text_chunk(self):
            published: list[object] = []

            class _QueueManager:
                def publish(self, event, publish_from):
                    published.append(event)

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
            workflow_entry = _workflow_entry(runner)

            runner.handle_event(
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

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
            workflow_entry = _workflow_entry(runner)

            runner.handle_event(
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

            runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
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

            runner.handle_event(workflow_entry, event_factory(result, started_at, finished_at))

            queue_event = published[-1]
            assert isinstance(queue_event, queue_event_cls)
            assert queue_event.outputs == {"question": "hello"}


class _DummyQueueManager:
    def __init__(self):
        self.published = []

    def publish(self, event, _from):
        self.published.append(event)


class _DummyRuntimeState:
    variable_pool = object()


class _DummyGraphEngine:
    def __init__(self):
        self.runtime_state = _DummyRuntimeState()


class _DummyWorkflowEntry:
    def __init__(self):
        self.graph_engine = _DummyGraphEngine()


class TestWorkflowAppRunnerNotificationsCases:
    @staticmethod
    def test_handle_pause_event_enqueues_email_task(monkeypatch: pytest.MonkeyPatch):
        queue_manager = _DummyQueueManager()
        runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app-id")
        workflow_entry = _DummyWorkflowEntry()

        graph_reason = HitlRequired(session_id="form-123", node_id="node-1", node_title="Review")
        event = GraphRunPausedEvent(reasons=[graph_reason], outputs={})

        email_task = MagicMock()
        enriched_reason = HumanInputRequired(
            form_id="form-123",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-1",
            node_title="Review",
        )
        monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_email_task", email_task)

        runner.handle_event(workflow_entry, event, pause_reasons=[enriched_reason])

        email_task.apply_async.assert_called_once()
        kwargs = email_task.apply_async.call_args.kwargs["kwargs"]
        assert kwargs["form_id"] == "form-123"
        assert kwargs["node_title"] == "Review"

        assert any(isinstance(evt, QueueWorkflowPausedEvent) for evt in queue_manager.published)


def _make_graph_state():
    variable_pool = VariablePool.from_bootstrap(
        system_variables=default_system_variables(),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return (
        MagicMock(),
        variable_pool,
        RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0),
    )


class TestWorkflowAppRunnerSingleNodeCases:
    @staticmethod
    @pytest.fixture
    def queue_manager() -> WorkflowAppQueueManager:
        return WorkflowAppQueueManager(
            task_id="task-id", user_id="user", invoke_from=InvokeFrom.SERVICE_API, app_mode=AppMode.WORKFLOW
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("single_iteration_run", "single_loop_run"),
        [
            (WorkflowAppGenerateEntity.SingleIterationRunEntity(node_id="iter", inputs={}), None),
            (None, WorkflowAppGenerateEntity.SingleLoopRunEntity(node_id="loop", inputs={})),
        ],
    )
    def test_run_uses_single_node_execution_branch(
        single_iteration_run: WorkflowAppGenerateEntity.SingleIterationRunEntity | None,
        single_loop_run: WorkflowAppGenerateEntity.SingleLoopRunEntity | None,
        queue_manager: WorkflowAppQueueManager,
    ) -> None:
        app_generate_entity = WorkflowAppGenerateEntity(
            app_config=WorkflowUIBasedAppConfig(
                app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
            ),
            inputs={},
            files=[],
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_execution_id="execution-id",
            task_id="task-id",
            stream=True,
            extras={"trace_session_id": "session-1"},
            single_iteration_run=single_iteration_run,
            single_loop_run=single_loop_run,
        )

        workflow = Workflow(
            tenant_id="tenant",
            app_id="app",
            id="workflow",
            type=ModelWorkflowType.WORKFLOW,
            version="v1",
            graph=json.dumps({"nodes": [], "edges": []}),
        )
        workflow.environment_variables = []

        runner = WorkflowAppRunner(
            application_generate_entity=app_generate_entity,
            queue_manager=queue_manager,
            variable_loader=MagicMock(),
            workflow=workflow,
            system_user_id="system-user",
        )

        graph, variable_pool, graph_runtime_state = _make_graph_state()
        mock_workflow_entry = MagicMock()
        mock_workflow_entry.graph_engine = MagicMock()
        mock_workflow_entry.graph_engine.layer = MagicMock()
        mock_workflow_entry.run.return_value = iter([])

        with (
            patch("core.app.apps.workflow.app_runner.RedisChannel"),
            patch("core.app.apps.workflow.app_runner.redis_client"),
            patch("core.app.apps.workflow.app_runner.WorkflowEntry", return_value=mock_workflow_entry) as entry_class,
            patch.object(
                runner,
                "_prepare_single_node_execution",
                return_value=(
                    graph,
                    variable_pool,
                    graph_runtime_state,
                ),
            ) as prepare_single,
            patch.object(runner, "_init_graph") as init_graph,
        ):
            runner.prepare()

        prepare_single.assert_called_once_with(
            workflow=workflow,
            single_iteration_run=single_iteration_run,
            single_loop_run=single_loop_run,
            user_id="user",
            app_type=CreditUsageAppType.WORKFLOW,
            trace_session_id="session-1",
        )
        init_graph.assert_not_called()

        assert entry_class.call_args.kwargs["graph_runtime_state"] is graph_runtime_state

    @staticmethod
    def test_single_node_run_validates_target_node_config(queue_manager: WorkflowAppQueueManager) -> None:
        runner = WorkflowBasedAppRunner(
            queue_manager=queue_manager,
            variable_loader=MagicMock(),
            app_id="app",
        )

        workflow = Workflow(
            id="workflow",
            tenant_id="tenant",
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "loop-node",
                            "data": {},
                        }
                    ],
                    "edges": [],
                }
            ),
        )

        _, _, graph_runtime_state = _make_graph_state()

        with pytest.raises(ValidationError, match="nodes.0.data.type"):
            runner._get_graph_and_variable_pool_for_single_node_run(
                workflow=workflow,
                node_id="loop-node",
                user_inputs={},
                graph_runtime_state=graph_runtime_state,
                node_type_label="loop",
                user_id="00000000-0000-0000-0000-000000000001",
            )

    @staticmethod
    def test_single_node_run_rejects_invalid_loop_count(queue_manager: WorkflowAppQueueManager) -> None:
        runner = WorkflowBasedAppRunner(
            queue_manager=queue_manager,
            app_id="app",
        )

        workflow = Workflow(
            id="workflow",
            tenant_id="tenant",
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "loop-node",
                            "data": {
                                "type": "loop",
                                "title": "Loop",
                                "loop_count": 0,
                                "start_node_id": "loop-start",
                                "break_conditions": [],
                                "logical_operator": "and",
                            },
                        },
                        {
                            "id": "loop-start",
                            "data": {"type": "loop-start", "title": "Loop start", "container_id": "loop-node"},
                        },
                    ],
                    "edges": [],
                }
            ),
        )

        _, _, graph_runtime_state = _make_graph_state()
        with pytest.raises(ValidationError, match="loop_count"):
            runner._get_graph_and_variable_pool_for_single_node_run(
                workflow=workflow,
                node_id="loop-node",
                user_inputs={},
                graph_runtime_state=graph_runtime_state,
                node_type_label="loop",
                user_id="00000000-0000-0000-0000-000000000001",
            )

    @staticmethod
    def test_run_adds_inputs_with_snippet_compatible_start_aliases(queue_manager: WorkflowAppQueueManager) -> None:
        app_generate_entity = WorkflowAppGenerateEntity(
            app_config=WorkflowUIBasedAppConfig(
                app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
            ),
            inputs={"question": "hello"},
            files=[],
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_execution_id="execution-id",
            task_id="task-id",
            stream=True,
            call_depth=4,
        )

        workflow = Workflow(
            tenant_id="tenant",
            app_id="app",
            id="workflow",
            type=ModelWorkflowType.WORKFLOW,
            version="v1",
            graph=json.dumps({"nodes": [], "edges": []}),
            kind=WorkflowKind.SNIPPET,
        )
        workflow.environment_variables = []

        runner = WorkflowAppRunner(
            application_generate_entity=app_generate_entity,
            queue_manager=queue_manager,
            variable_loader=MagicMock(),
            workflow=workflow,
            system_user_id="system-user",
        )

        mock_workflow_entry = MagicMock()
        mock_workflow_entry.graph_engine = MagicMock()
        mock_workflow_entry.graph_engine.layer = MagicMock()
        mock_workflow_entry.run.return_value = iter([])

        with (
            patch("core.app.apps.workflow.app_runner.RedisChannel"),
            patch("core.app.apps.workflow.app_runner.redis_client"),
            patch("core.app.apps.workflow.app_runner.WorkflowEntry", return_value=mock_workflow_entry),
            patch("core.app.apps.workflow.app_runner.build_system_variables", return_value={}),
            patch("core.app.apps.workflow.app_runner.build_bootstrap_variables", return_value=[]),
            patch("core.app.apps.workflow.app_runner.add_variables_to_pool"),
            patch("core.app.apps.workflow.app_runner.get_default_root_node_id", return_value="root-node"),
            patch(
                "core.app.apps.workflow.app_runner.get_compatible_start_aliases", return_value=("legacy-start",)
            ) as aliases,
            patch("core.app.apps.workflow.app_runner.add_node_inputs_to_pool") as add_inputs,
            patch.object(runner, "_init_graph", return_value=MagicMock()) as init_graph,
        ):
            runner.prepare()

        aliases.assert_called_once_with(workflow_kind="snippet", root_node_id="root-node")
        add_inputs.assert_called_once()
        assert add_inputs.call_args.kwargs["node_id"] == "root-node"
        assert add_inputs.call_args.kwargs["inputs"] == {"question": "hello"}
        assert add_inputs.call_args.kwargs["aliases"] == ("legacy-start",)
        assert init_graph.call_args.kwargs["call_depth"] == 4


def _save_form(session: Session, *, status: HumanInputFormStatus) -> HumanInputForm:
    now = datetime.now(UTC)
    definition = FormDefinition(
        form_content="Decision: {{#$output.answer#}}",
        rendered_content="Decision: {{#$output.answer#}}",
        inputs=[ParagraphInputConfig(output_variable_name="answer")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        expiration_time=now + timedelta(hours=1),
        node_title="Approval",
    )
    form = HumanInputForm(
        tenant_id="tenant",
        app_id="app",
        workflow_run_id="run-1",
        node_id="same-human-node",
        form_kind=HumanInputFormKind.RUNTIME,
        form_definition=definition.model_dump_json(),
        rendered_content=definition.rendered_content,
        expiration_time=definition.expiration_time,
        status=status,
        selected_action_id="approve" if status == HumanInputFormStatus.SUBMITTED else None,
        submitted_data=json.dumps({"answer": "approved"}) if status == HumanInputFormStatus.SUBMITTED else None,
        submitted_at=now if status == HumanInputFormStatus.SUBMITTED else None,
        created_at=now,
    )
    session.add(form)
    session.commit()
    return form


def _make_paused_workflow(
    runner: WorkflowBasedAppRunner, forms: list[HumanInputForm], *, human_input_form: HumanInputForm | None = None
) -> WorkflowEntry:
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=perf_counter())
    state.variable_pool.add(("sys", "workflow_run_id"), "run-1")
    state.variable_pool.add(("sys", "app_id"), "app")
    graph = runner._init_graph(
        graph_config={
            "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}],
            "edges": [],
        },
        graph_runtime_state=state,
        tenant_id="tenant",
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
    )
    if human_input_form is not None:
        node_data = HumanInputNodeData(
            title="Approval",
            form_content="Decision: {{#$output.answer#}}",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        )
        callback = DifyHITLCallback(
            form_repository=HumanInputFormRepositoryImpl(
                tenant_id="tenant", app_id="app", workflow_execution_id="run-1"
            ),
            node_data=node_data,
            execution_id_getter=lambda: human_input_form.id,
        )
        graph = (
            Graph.new()
            .add_root(graph.root_node)
            .add_node(
                HumanInputNode(
                    node_id=human_input_form.node_id,
                    data=GraphonHumanInputNodeData.model_validate(node_data.model_dump()),
                    init_params=build_test_graph_init_params(tenant_id="tenant", app_id="app"),
                    runtime_state=state,
                    hitl_callback=callback,
                ),
                from_node_id=graph.root_node.id,
            )
            .build()
        )
        # A resumed Human Input node keeps the execution identity used to create its form.
        state.graph_execution.get_or_create_node_execution(
            frame_id=ROOT_FRAME_ID, node_id=human_input_form.node_id
        ).execution_id = human_input_form.id
    state.graph_execution.start()
    for form in forms:
        state.graph_execution.pause(HitlRequired(session_id=form.id, node_id=form.node_id, node_title="Approval"))
        state.variable_pool.add(human_input_container_selector(form.id), "outer-tool")
    state.defer_ready_task(StartTask(frame_id=ROOT_FRAME_ID, node_id=graph.root_node.id))
    return WorkflowEntry(
        graph=graph,
        graph_config=graph.graph_config or {},
        call_depth=0,
        graph_runtime_state=state,
    )


def _resume_events(runner: WorkflowBasedAppRunner, entry: WorkflowEntry) -> Generator[EngineEvent]:
    """Resume through orchestration with actual repositories and the real Engine."""
    entity = WorkflowAppGenerateEntity(
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            workflow_id="workflow",
        ),
        inputs={},
        files=[],
        user_id="user",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id="run-1",
    )
    user = Account(name="Tester", email="tester@example.com")
    user.id = "user"
    factory = session_factory.get_session_maker()
    runs = SQLAlchemyWorkflowExecutionRepository(
        factory,
        tenant_id="tenant",
        app_id="app",
        user=user,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        factory,
        tenant_id="tenant",
        app_id="app",
        user=user,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    prepared = PreparedWorkflowRun(entry, WorkflowType.WORKFLOW, "draft", entity, ())
    return WorkflowRunAgg(
        prepared,
        runner,
        None,
        workflow_execution_repository=runs,
        workflow_node_execution_repository=nodes,
    ).iter_events()


class TestWorkflowHumanInputCompletionCases:
    @staticmethod
    @pytest.fixture
    def workflow_queue(mocker: MockerFixture) -> tuple[WorkflowAppQueueManager, MagicMock]:
        queue = WorkflowAppQueueManager("task", "user", InvokeFrom.DEBUGGER, AppMode.WORKFLOW)
        return queue, mocker.spy(queue, "publish")

    @staticmethod
    @pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
    @pytest.mark.parametrize("runs_human_input_node", [False, True], ids=["hidden-form", "direct-completion"])
    def test_resume_publishes_only_the_completed_form_among_repeated_node_invocations(
        sqlite_session: Session,
        workflow_queue: tuple[WorkflowAppQueueManager, MagicMock],
        status: HumanInputFormStatus,
        runs_human_input_node: bool,
    ) -> None:
        selected = _save_form(sqlite_session, status=status)
        waiting = _save_form(sqlite_session, status=HumanInputFormStatus.WAITING)
        expired = _save_form(sqlite_session, status=HumanInputFormStatus.EXPIRED)
        _save_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
        queue, publish_spy = workflow_queue
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
        entry = _make_paused_workflow(
            runner, [selected, waiting, selected, expired], human_input_form=selected if runs_human_input_node else None
        )
        original_reasons = tuple(entry.graph_engine.runtime_state.graph_execution.pause_reasons)

        for event in _resume_events(runner, entry):
            runner.handle_event(entry, event)

        published = [call.args[0] for call in publish_spy.call_args_list]
        assert isinstance(published[0], QueueWorkflowStartedEvent)
        completions = [
            item
            for item in published
            if isinstance(item, QueueHumanInputFormFilledEvent | QueueHumanInputFormTimeoutEvent)
        ]
        assert len(completions) == 1
        completion = completions[0]
        assert completion.form_id == selected.id
        assert completion.node_id == "outer-tool"
        if status == HumanInputFormStatus.SUBMITTED:
            assert isinstance(completion, QueueHumanInputFormFilledEvent)
            assert (completion.action_id, completion.action_text, completion.rendered_content) == (
                "approve",
                "Approve",
                "Decision: approved",
            )
            assert completion.submitted_data is not None
            assert completion.submitted_data["answer"].to_object() == "approved"
        else:
            assert isinstance(completion, QueueHumanInputFormTimeoutEvent)
        assert len(original_reasons) == 4
        assert all(
            isinstance(reason, HitlRequired) and reason.node_id == "same-human-node" for reason in original_reasons
        )
        assert entry.graph_engine.runtime_state.graph_execution.pause_reasons == []

    @staticmethod
    @pytest.mark.parametrize("owner_field", ["tenant_id", "app_id", "workflow_run_id"])
    def test_resume_rejects_form_outside_the_trusted_execution_owner(
        sqlite_session: Session, workflow_queue: tuple[WorkflowAppQueueManager, MagicMock], owner_field: str
    ) -> None:
        form = _save_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
        setattr(form, owner_field, "another-owner")
        sqlite_session.commit()
        queue, publish_spy = workflow_queue
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
        entry = _make_paused_workflow(runner, [form])

        events = list(_resume_events(runner, entry))
        assert isinstance(events[-1], GraphRunFailedEvent)
        assert "does not belong" in events[-1].error

        assert not any(isinstance(call.args[0], QueueHumanInputFormFilledEvent) for call in publish_spy.call_args_list)

    @staticmethod
    def test_resume_refreshes_expired_file_and_file_list_urls_before_form_completion(
        sqlite_session: Session,
        workflow_queue: tuple[WorkflowAppQueueManager, MagicMock],
        monkeypatch: pytest.MonkeyPatch,
        mocker: MockerFixture,
    ) -> None:
        mocker.patch.object(
            type(workflow_response_converter.db),
            "engine",
            new_callable=PropertyMock,
            return_value=sqlite_session.get_bind(),
        )
        submitted_at = 1_700_000_000
        monkeypatch.setattr("core.app.workflow.file_runtime.time.time", lambda: submitted_at)
        factory = DifyFileReferenceFactory(build_test_run_context())
        saved_files = []
        for name in ("first.txt", "second.txt"):
            upload = UploadFile(
                tenant_id="tenant",
                storage_type=StorageType.LOCAL,
                key=name,
                name=name,
                size=12,
                extension="txt",
                mime_type="text/plain",
                created_by="user",
                created_by_role=CreatorUserRole.END_USER,
                created_at=datetime.now(UTC),
                used=False,
            )
            sqlite_session.add(upload)
            sqlite_session.commit()
            saved_files.append(
                factory.build_from_mapping(
                    mapping={"transfer_method": "local_file", "upload_file_id": upload.id}
                ).to_dict()
            )

        def url_is_valid(file: Mapping[str, object]) -> bool:
            url, file_id = file["url"], file["related_id"]
            assert isinstance(url, str)
            assert isinstance(file_id, str)
            query = parse_qs(urlparse(url).query)
            return verify_file_signature(
                upload_file_id=file_id,
                timestamp=query["timestamp"][0],
                nonce=query["nonce"][0],
                sign=query["sign"][0],
            )

        assert all(url_is_valid(file) for file in saved_files)
        form = _save_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
        definition = FormDefinition.model_validate_json(form.form_definition)
        definition.inputs.extend(
            [
                FileInputConfig(output_variable_name="attachment"),
                FileListInputConfig(output_variable_name="attachments"),
            ]
        )
        form.form_definition = definition.model_dump_json()
        form.submitted_data = json.dumps(
            {"answer": "approved", "attachment": saved_files[0], "attachments": saved_files}
        )
        sqlite_session.commit()

        monkeypatch.setattr(
            "core.app.workflow.file_runtime.time.time", lambda: submitted_at + dify_config.FILES_ACCESS_TIMEOUT + 1
        )
        assert not any(url_is_valid(file) for file in saved_files)
        queue, publish_spy = workflow_queue
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
        entry = _make_paused_workflow(runner, [form])
        for event in _resume_events(runner, entry):
            runner.handle_event(entry, event)

        completions = [
            call.args[0]
            for call in publish_spy.call_args_list
            if isinstance(call.args[0], QueueHumanInputFormFilledEvent)
        ]
        assert len(completions) == 1
        converter = _build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task", workflow_run_id="run-1", workflow_id="workflow", reason=WorkflowStartReason.RESUMPTION
        )
        response = converter.human_input_form_filled_to_stream_response(event=completions[0], task_id="task")
        data = response.data.submitted_data
        assert data is not None
        assert data["answer"] == "approved"
        assert response.data.rendered_content == "Decision: approved"
        restored_files = [data["attachment"], *data["attachments"]]
        for restored, saved in zip(restored_files, [saved_files[0], *saved_files], strict=True):
            assert (restored["related_id"], restored["filename"]) == (saved["related_id"], saved["filename"])
            assert url_is_valid(restored)

    @staticmethod
    @pytest.mark.parametrize("late_status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
    def test_form_completed_during_resume_is_published_once_before_the_terminal_event(
        sqlite_session: Session,
        workflow_queue: tuple[WorkflowAppQueueManager, MagicMock],
        late_status: HumanInputFormStatus,
    ) -> None:
        first = _save_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
        second = _save_form(sqlite_session, status=HumanInputFormStatus.WAITING)
        queue, publish_spy = workflow_queue
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
        entry = _make_paused_workflow(runner, [first, second])

        def complete_second_form_during_execution(event: AppQueueEvent, publish_from: PublishFrom) -> None:
            WorkflowAppQueueManager.publish(queue, event, publish_from)
            # The second submission arrives after the initial completion query,
            # while this real Engine attempt is already processing node events.
            if not isinstance(event, QueueNodeStartedEvent):
                return
            repository = HumanInputFormSubmissionRepository()
            if late_status == HumanInputFormStatus.SUBMITTED:
                repository.mark_submitted(
                    form_id=second.id,
                    recipient_id=None,
                    selected_action_id="approve",
                    form_data={"answer": "approved"},
                    submission_user_id=None,
                    submission_end_user_id="user",
                )
            else:
                repository.mark_timeout(form_id=second.id, timeout_status=late_status)

        publish_spy.side_effect = complete_second_form_during_execution
        for event in _resume_events(runner, entry):
            runner.handle_event(entry, event)

        published = [call.args[0] for call in publish_spy.call_args_list]
        completions = [
            event
            for event in published
            if isinstance(event, QueueHumanInputFormFilledEvent | QueueHumanInputFormTimeoutEvent)
        ]
        assert [event.form_id for event in completions] == [first.id, second.id]
        assert isinstance(published[0], QueueWorkflowStartedEvent)
        assert isinstance(published[-1], QueueWorkflowSucceededEvent)
        assert published.index(completions[-1]) < len(published) - 1

    @staticmethod
    def test_waiting_form_expiring_during_resume_publishes_timeout_before_success(
        sqlite_session: Session, workflow_queue: tuple[WorkflowAppQueueManager, MagicMock]
    ) -> None:
        form = _save_form(sqlite_session, status=HumanInputFormStatus.WAITING)
        form.expiration_time = datetime.now(UTC) - timedelta(seconds=1)
        sqlite_session.commit()
        queue, publish_spy = workflow_queue
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
        entry = _make_paused_workflow(runner, [form], human_input_form=form)

        for event in _resume_events(runner, entry):
            runner.handle_event(entry, event)

        published = [call.args[0] for call in publish_spy.call_args_list]
        assert isinstance(published[-1], QueueWorkflowSucceededEvent)
        timeouts = [event for event in published if isinstance(event, QueueHumanInputFormTimeoutEvent)]
        assert [event.form_id for event in timeouts] == [form.id]
        assert timeouts[0].node_id == "outer-tool"
        assert published.index(timeouts[0]) < len(published) - 1
        sqlite_session.refresh(form)
        assert form.status == HumanInputFormStatus.TIMEOUT

    @staticmethod
    def test_chat_history_keeps_repeated_forms_by_form_id(sqlite_session: Session) -> None:
        pipeline = _build_pipeline()
        pipeline._workflow_tenant_id = "tenant"
        pipeline._application_generate_entity = _build_generate_entity()
        pipeline._workflow_response_converter = _build_converter()
        pipeline._workflow_response_converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="workflow-1", reason=WorkflowStartReason.INITIAL
        )
        for form_id in ("first-form", "second-form", "first-form"):
            event = QueueHumanInputFormFilledEvent(
                form_id=form_id,
                node_id="same-human-node",
                node_type=BuiltinNodeTypes.HUMAN_INPUT,
                node_title="Approval",
                rendered_content="Decision: approved",
                action_id="approve",
                action_text="Approve",
            )
            list(pipeline._handle_human_input_form_filled_event(event))

        contents = sqlite_session.scalars(select(HumanInputContent)).all()
        assert {(content.form_id, content.message_id) for content in contents} == {
            ("first-form", "message-1"),
            ("second-form", "message-1"),
        }
        assert len(contents) == 2
