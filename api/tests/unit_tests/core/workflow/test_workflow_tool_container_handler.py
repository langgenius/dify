from __future__ import annotations

import json
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager
from contextvars import ContextVar
from dataclasses import replace
from datetime import UTC, datetime
from functools import partial
from threading import Event, get_ident
from types import TracebackType
from typing import override

import pytest
from flask import current_app, g
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import get_current_span
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend import FakeAgentBackendRunClient
from context import capture_current_context
from context.flask_app_context import capture_flask_context
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.app.layers import execution_context_layer as module
from core.app.layers.execution_context_layer import ExecutionContextLayer
from core.app.workflow.file_runtime import init_app
from core.app.workflow.layers.observability import ObservabilityLayer
from core.helper.code_executor.code_executor import CodeExecutionError
from core.repositories.human_input_repository import (
    HumanInputFormRepositoryImpl,
    HumanInputFormSubmissionRepository,
)
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.tools.workflow_as_tool.tool import WorkflowTool
from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
)
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import DifyToolFileManager, DifyToolNodeRuntime
from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingResolver
from core.workflow.nodes.human_input.boundary import resolve_human_input_node_id
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.system_variables import SystemVariableKey, system_variable_selector
from core.workflow.workflow_entry import WorkflowEntry
from core.workflow.workflow_tool_container_handler import (
    WorkflowToolContainerHandler,
    WorkflowToolNestedContainerHandler,
)
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from core.workflow.workflow_tool_node import DifyWorkflowToolNode
from dify_app import DifyApp
from enums import WorkflowKind
from extensions.storage.storage_type import StorageType
from graphon.engine import Engine
from graphon.engine.command import AbortCommand, InMemoryChannel
from graphon.engine.container_handler.builtin.loop import LoopContainerHandler
from graphon.engine.event.node_failure import NodeFailureHandler
from graphon.engine.event.processor import NodeEventProcessor
from graphon.engine.event.stream import EventStream
from graphon.engine.frame import ExecutionFrame, FrameRegistry
from graphon.engine.layer import Layer
from graphon.engine.ready_queue import ResumeTask, StartTask
from graphon.engine.scheduler import Scheduler
from graphon.engine.worker import NodeEventTask
from graphon.engine_events import (
    GraphRunSucceededEvent as _workflow_tool_event_delivery_GraphRunSucceededEvent,
)
from graphon.engine_events import GraphRunSucceededEvent as _workflow_tool_file_access_GraphRunSucceededEvent
from graphon.engine_events import GraphRunSucceededEvent as _workflow_tool_observability_GraphRunSucceededEvent
from graphon.engine_events import NodeEvent as _workflow_tool_observability_NodeEvent
from graphon.engine_events import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.engine_events.base import EngineEvent
from graphon.engine_events.base import NodeEvent as _workflow_tool_container_NodeEvent
from graphon.engine_events.base import NodeEvent as _workflow_tool_event_delivery_NodeEvent
from graphon.engine_events.graph import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
)
from graphon.engine_events.graph import (
    GraphRunSucceededEvent as _workflow_tool_container_GraphRunSucceededEvent,
)
from graphon.engine_events.node import NodeRunPauseRequestedEvent
from graphon.entities import WorkflowNodeExecution
from graphon.entities.base_node_data import BaseNodeData, DefaultValue, DefaultValueType
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from graphon.graph import Graph
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from graphon.node_events.base import NodeEventPayload
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
    ContainerExecutionResult,
    ContainerNodeRunResult,
    ContainerRunResult,
    CustomContainerRequest,
    LoopFrameRequest,
    build_container_value,
)
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool.exc import ToolNodeError
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.container_state import create_container_run_state
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.variables.segments import ArrayFileSegment
from graphon.variables.types import SegmentType
from models import Account, ToolFile, UploadFile, WorkflowRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow_run_index import WorkflowRunIndex
from tests.helpers.unit.config_override import apply_config_overrides
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context


def _workflow_tool_container_workflow_tool_node(
    runtime_state: RuntimeState | None = None,
    *,
    app_id: str = "outer-app",
    version: str = "1",
    tool_node_version: str | None = None,
) -> tuple[DifyWorkflowToolNode, DifyToolNodeRuntime, WorkflowToolContainerPayload]:
    graph_config = {
        "nodes": [
            {
                "id": "tool",
                "data": {
                    "type": "tool",
                    "title": "Workflow Tool",
                    "provider_id": "workflow-provider",
                    "provider_type": "workflow",
                    "provider_name": "workflow-provider",
                    "tool_name": "nested-workflow",
                    "tool_label": "Nested Workflow",
                    "tool_configurations": dict[str, object](),
                    "tool_parameters": dict[str, object](),
                    "version": version,
                    "tool_node_version": tool_node_version,
                },
            }
        ],
        "edges": list[dict[str, object]](),
    }
    init_params = build_test_graph_init_params(
        workflow_id="outer-workflow",
        graph_config=graph_config,
        call_depth=2,
        app_id=app_id,
    )
    if runtime_state is None:
        runtime_state = RuntimeState(
            workflow_id="outer-workflow",
            variable_pool=VariablePool(),
            start_at=1,
        )
    payload = WorkflowToolContainerPayload(
        source_app_id="source-app",
        source_workflow_id="source-workflow",
        source_workflow_version="1",
        inputs={"question": "hello"},
        inputs_for_log={},
        call_depth=3,
    )
    tool = WorkflowTool(
        workflow_app_id=payload.source_app_id,
        workflow_id=payload.source_workflow_id,
        workflow_as_tool_id="workflow-provider",
        version=payload.source_workflow_version,
        workflow_call_depth=2,
        entity=ToolEntity(
            identity=ToolIdentity(
                author="test",
                name="nested-workflow",
                label=I18nObject(en_US="Nested Workflow"),
                provider="workflow-provider",
            ),
            parameters=[],
            description=None,
            has_runtime_parameters=False,
        ),
        runtime=ToolRuntime(tenant_id="tenant", invoke_from=InvokeFrom.DEBUGGER),
    )
    tool.prepare_container_inputs = lambda *_args, **_kwargs: (payload.inputs, [])
    runtime = DifyToolNodeRuntime(init_params.run_context)
    runtime.get_runtime = lambda **_kwargs: ToolRuntimeHandle(raw=tool)
    node = DifyWorkflowToolNode(
        node_id="tool",
        data=ToolNodeData.model_validate(graph_config["nodes"][0]["data"]),
        init_params=init_params,
        runtime_state=runtime_state,
        tool_file_manager=DifyToolFileManager(init_params.run_context),
        runtime=runtime,
    )
    node.bind_execution_id("tool-execution")
    return node, runtime, payload


def _workflow_tool_container_outer_graph(node: DifyWorkflowToolNode) -> Graph:
    start = StartNode(
        node_id="outer-start",
        data=StartNodeData(title="Start", variables=[]),
        init_params=node.init_params,
        runtime_state=node.runtime_state,
    )
    return Graph.new().add_root(start).add_node(node, from_node_id=start.id).build()


def _workflow_tool_container_workflow_tool_source() -> WorkflowToolSource:
    source_graph = {
        "nodes": [
            {
                "id": "source-start",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [
                        {
                            "variable": "answer",
                            "label": "Answer",
                            "type": "text-input",
                            "required": False,
                            "default": "fallback",
                        }
                    ],
                },
            },
            {
                "id": "source-end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "answer",
                            "value_selector": ["source-start", "answer"],
                        }
                    ],
                },
            },
        ],
        "edges": [
            {
                "id": "source-edge",
                "source": "source-start",
                "target": "source-end",
            }
        ],
    }
    return WorkflowToolSource(
        app_id="source-app",
        workflow_id="source-workflow",
        graph_config=source_graph,
        features_dict={},
        environment_variables=[],
        workflow_kind=WorkflowKind.STANDARD,
    )


def _human_input_workflow_tool_source() -> WorkflowToolSource:
    human_input = HumanInputNodeData(
        title="Approval",
        form_content="Approve this run?",
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    source_graph = {
        "nodes": [
            {
                "id": "source-start",
                "data": {"type": "start", "title": "Start", "variables": list[object]()},
            },
            {
                "id": "source-human",
                "data": human_input.model_dump(mode="json"),
            },
            {
                "id": "source-end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "decision",
                            "value_selector": ["source-human", "__action_id"],
                        }
                    ],
                },
            },
        ],
        "edges": [
            {
                "id": "source-edge-start-human",
                "source": "source-start",
                "target": "source-human",
            },
            {
                "id": "source-edge-human-end",
                "source": "source-human",
                "sourceHandle": "approve",
                "target": "source-end",
            },
        ],
    }
    return replace(_workflow_tool_container_workflow_tool_source(), graph_config=source_graph)


def _workflow_tool_container_container_handler(
    *,
    inputs: dict[str, object] | None = None,
) -> tuple[
    WorkflowToolContainerHandler,
    FrameRegistry,
    RuntimeState,
    CustomContainerRequest,
    dict[str, WorkflowToolSource],
]:
    source = _workflow_tool_container_workflow_tool_source()
    parent_pool = VariablePool()
    parent_pool.add(system_variable_selector(SystemVariableKey.USER_ID), "user")
    parent_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "outer-execution")
    parent_pool.add(("env", "outer-secret"), "must-not-leak")
    parent_pool.add(("source-start", "stale"), "must-not-leak")
    parent_state = RuntimeState(
        workflow_id="outer-workflow",
        variable_pool=parent_pool,
        start_at=1,
    )
    parent_node, _, _ = _workflow_tool_container_workflow_tool_node(parent_state)
    parent_graph = _workflow_tool_container_outer_graph(parent_node)
    frame_registry = FrameRegistry()
    frame_registry.register(
        ExecutionFrame(
            frame_id=ROOT_FRAME_ID,
            graph=parent_graph,
            state=parent_state,
            scheduler=Scheduler(parent_graph, parent_state, ROOT_FRAME_ID),
            failure_handler=NodeFailureHandler(parent_graph, parent_state.graph_execution),
        )
    )
    source_repository = {}
    source_repository["source-workflow"] = source
    payload = WorkflowToolContainerPayload(
        source_app_id=source.app_id,
        source_workflow_id=source.workflow_id,
        source_workflow_version="1",
        inputs={"answer": "ok"} if inputs is None else inputs,
        inputs_for_log={"answer": "ok"} if inputs is None else inputs,
        call_depth=1,
    )
    request = CustomContainerRequest(payload=payload.model_dump_json())
    parent_state.put_container_run(
        create_container_run_state(
            invocation_id="invocation",
            frame_id=ROOT_FRAME_ID,
            node_id="tool",
            started_at=datetime.now(UTC).replace(tzinfo=None),
            request=request,
        )
    )
    return (
        WorkflowToolContainerHandler(frame_registry, sources=source_repository),
        frame_registry,
        parent_state,
        request,
        source_repository,
    )


def _dispatch_next_node(
    *,
    expected_node_id: str,
    runtime_state: RuntimeState,
    frame_registry: FrameRegistry,
    processor: NodeEventProcessor,
) -> None:
    task = runtime_state.ready_queue.get(timeout=0.01)
    assert isinstance(task, StartTask)
    assert task.node_id == expected_node_id
    frame = frame_registry[task.frame_id]
    node = frame.graph.nodes[task.node_id]
    execution = runtime_state.graph_execution.get_or_create_node_execution(
        frame_id=frame.frame_id,
        node_id=node.id,
    )
    node.bind_execution_id(execution.execution_id)
    for event in node.run():
        assert isinstance(event, _workflow_tool_container_NodeEvent)
        processor.dispatch(NodeEventTask(frame_id=frame.frame_id, event=event))


class TestWorkflowToolContainerCases:
    @staticmethod
    def test_workflow_tool_node_requests_child_container_and_resumes_successfully(mocker: MockerFixture) -> None:
        node, runtime, payload = _workflow_tool_container_workflow_tool_node()
        get_runtime = mocker.spy(runtime, "get_runtime")
        build_payload = mocker.spy(runtime, "build_workflow_tool_container_payload")

        initial_events = list(node._run())

        assert initial_events == [CustomContainerRequest(payload=payload.model_dump_json())]
        get_runtime.assert_called_once_with(
            node_id="tool",
            node_data=node.node_data,
            variable_pool=None,
            node_execution_id="tool-execution",
        )
        build_payload.assert_called_once_with(
            tool_runtime=get_runtime.spy_return,
            tool_parameters={},
            inputs_for_log={},
            workflow_call_depth=2,
        )

        result = ContainerExecutionResult(
            metadata={},
            steps=2,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"question": build_container_value("hello")},
                outputs={
                    "text": build_container_value("done"),
                    "answer": build_container_value(42),
                    "files": WorkflowToolContainerHandler._build_tool_outputs({})["files"],
                },
            ),
        )
        assert result.node_run_result.outputs["files"].value_type == SegmentType.ARRAY_FILE
        node.runtime_state.enqueue_ready_task(ResumeTask(invocation_id="invocation", result=result))
        restored_state = RuntimeState.from_snapshot(node.runtime_state.dumps())
        resume_task = restored_state.ready_queue.get(timeout=0.01)
        assert isinstance(resume_task, ResumeTask)
        assert isinstance(resume_task.result, ContainerExecutionResult)
        assert resume_task.result.node_run_result.outputs["files"].value_type == SegmentType.ARRAY_FILE
        restored_node, _, _ = _workflow_tool_container_workflow_tool_node(restored_state)

        resumed_events = list(restored_node._resume_container_events(result=resume_task.result))

        assert resumed_events[:2] == [
            StreamChunkEvent(selector=["tool", "text"], chunk="done", is_final=False),
            StreamChunkEvent(selector=["tool", "text"], chunk="", is_final=True),
        ]
        completed = resumed_events[2]
        assert isinstance(completed, StreamCompletedEvent)
        assert completed.node_run_result.inputs == {"question": "hello"}
        assert {key: value.to_object() for key, value in completed.node_run_result.outputs.items()} == {
            "text": "done",
            "answer": 42,
            "files": [],
        }
        assert isinstance(completed.node_run_result.outputs["files"], ArrayFileSegment)
        for key, value in completed.node_run_result.outputs.items():
            restored_state.variable_pool.add(("tool", key), value)
        files = restored_state.variable_pool.get(("tool", "files"))
        assert files is not None
        assert files.value_type == SegmentType.ARRAY_FILE
        assert files.to_object() == []
        assert node.runtime_state.node_run_steps == 0
        assert completed.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOOL_INFO] == {
            "provider_type": ToolProviderType.WORKFLOW.value,
            "provider_id": "workflow-provider",
            "plugin_unique_identifier": None,
        }

    @staticmethod
    def test_workflow_tool_node_returns_failure_when_runtime_cannot_be_loaded(mocker: MockerFixture) -> None:
        node, runtime, _ = _workflow_tool_container_workflow_tool_node(version="2")
        get_runtime = mocker.patch.object(runtime, "get_runtime", side_effect=ToolNodeError("runtime unavailable"))

        events = list(node._run())

        assert len(events) == 1
        completed = events[0]
        assert isinstance(completed, StreamCompletedEvent)
        assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
        assert completed.node_run_result.error == "Failed to get tool runtime: runtime unavailable"
        get_runtime.assert_called_once_with(
            node_id="tool",
            node_data=node.node_data,
            variable_pool=node.runtime_state.variable_pool,
            node_execution_id="tool-execution",
        )

    @staticmethod
    def test_workflow_tool_node_returns_failure_when_payload_cannot_be_built(mocker: MockerFixture) -> None:
        node, runtime, _ = _workflow_tool_container_workflow_tool_node(tool_node_version="1")
        mocker.patch.object(
            runtime, "build_workflow_tool_container_payload", side_effect=ToolNodeError("invalid source workflow")
        )

        events = list(node._run())

        assert len(events) == 1
        completed = events[0]
        assert isinstance(completed, StreamCompletedEvent)
        assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
        assert completed.node_run_result.error == "Failed to prepare Workflow Tool: invalid source workflow"

    @staticmethod
    def test_workflow_tool_node_rejects_non_execution_result() -> None:
        node, _, _ = _workflow_tool_container_workflow_tool_node()
        result = LoopFrameRequest(
            inputs={},
            outputs={},
            loop_count=0,
            root_node_id="loop",
            loop_variable_selectors={},
            loop_node_ids=frozenset(),
            index=0,
        )

        with pytest.raises(TypeError, match="Unsupported Workflow Tool container result LoopFrameRequest"):
            list(node._resume_container_events(result=result))

    @staticmethod
    def test_workflow_tool_node_resumes_failed_result_without_chunks() -> None:
        node, _, _ = _workflow_tool_container_workflow_tool_node()
        result = ContainerExecutionResult(
            metadata={},
            steps=1,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="child failed",
            ),
        )

        events = list(node._resume_container_events(result=result))

        assert len(events) == 1
        assert isinstance(events[0], StreamCompletedEvent)
        assert events[0].node_run_result.error == "child failed"

    @staticmethod
    def test_workflow_tool_node_resumes_empty_text_with_final_chunk_only() -> None:
        node, _, _ = _workflow_tool_container_workflow_tool_node()
        result = ContainerExecutionResult(
            metadata={},
            steps=0,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": build_container_value("")},
            ),
        )

        events = list(node._resume_container_events(result=result))

        assert events[:1] == [StreamChunkEvent(selector=["tool", "text"], chunk="", is_final=True)]
        assert isinstance(events[1], StreamCompletedEvent)

    @staticmethod
    def test_node_factory_can_keep_workflow_tool_direct_for_single_step_debug() -> None:
        node, _, _ = _workflow_tool_container_workflow_tool_node()
        factory = DifyNodeFactory(node.init_params, node.runtime_state, use_workflow_tool_containers=True)
        assert (
            factory._resolve_node_class_for_factory(
                node_type=BuiltinNodeTypes.TOOL,
                node_version="1",
                node_data=node.node_data,
            )
            is DifyWorkflowToolNode
        )

        factory._use_workflow_tool_containers = False
        assert (
            factory._resolve_node_class_for_factory(
                node_type=BuiltinNodeTypes.TOOL,
                node_version="1",
                node_data=node.node_data,
            )
            is ToolNode
        )

    @staticmethod
    def test_workflow_tool_handler_runs_child_graph_with_internal_name_collision() -> None:
        handler, frame_registry, runtime_state, request, _ = _workflow_tool_container_container_handler()
        handler.handle_request(invocation_id="invocation", request=request)
        frame_registry["invocation:workflow-tool"].state.variable_pool.add(
            ("__workflow_tool_container__", "failure"),
            {"legitimate": True},
        )
        event_stream = EventStream(layers=[])
        processor = NodeEventProcessor(
            graph_execution=runtime_state.graph_execution,
            event_stream=event_stream,
            frame_registry=frame_registry,
            container_handlers={BuiltinNodeTypes.TOOL: handler},
        )

        _dispatch_next_node(
            expected_node_id="source-start",
            runtime_state=runtime_state,
            frame_registry=frame_registry,
            processor=processor,
        )
        _dispatch_next_node(
            expected_node_id="source-end",
            runtime_state=runtime_state,
            frame_registry=frame_registry,
            processor=processor,
        )

        resume_task = runtime_state.ready_queue.get(timeout=0.01)
        assert isinstance(resume_task, ResumeTask)
        assert isinstance(resume_task.result, ContainerExecutionResult)
        assert resume_task.result.steps == 2
        assert resume_task.result.node_run_result.outputs["files"].value_type == SegmentType.ARRAY_FILE
        outputs = {key: value.to_object() for key, value in resume_task.result.node_run_result.outputs.items()}
        assert outputs == {
            "answer": "ok",
            "text": '{"answer": "ok"}',
            "files": [],
            "json": [{"answer": "ok"}],
        }
        event_stream.mark_complete()
        assert not any(isinstance(event, _workflow_tool_container_NodeEvent) for event in event_stream.emit_events())
        with pytest.raises(KeyError):
            frame_registry["invocation:workflow-tool"]
        with pytest.raises(KeyError):
            runtime_state.get_container_frame("invocation:workflow-tool")

    @staticmethod
    def test_workflow_tool_handler_restores_child_failure() -> None:
        handler, frame_registry, runtime_state, request, source_repository = (
            _workflow_tool_container_container_handler()
        )
        handler.handle_request(invocation_id="invocation", request=request)
        frame_id = "invocation:workflow-tool"
        frame = frame_registry[frame_id]
        now = datetime.now(UTC).replace(tzinfo=None)
        handler.record_frame_failure(
            frame=frame,
            event=NodeRunFailedEvent(
                id="failed-execution",
                node_id="source-start",
                node_type=BuiltinNodeTypes.START,
                error="source failed",
                start_at=now,
                finished_at=now,
                node_run_result=ContainerNodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error="source failed",
                    error_type="RuntimeError",
                ).to_node_run_result(),
            ),
        )
        frame_state = runtime_state.get_container_frame(frame_id)
        frame_state = frame_state.model_copy(update={"runtime_data": frame.state.snapshot_frame()})
        runtime_state.put_container_frame(frame_state)
        frame_registry.remove(frame_id)

        restored_handler = WorkflowToolContainerHandler(frame_registry, sources=source_repository)
        restored_handler.restore_frame(frame_state)
        restored_handler.complete_frame_if_ready(frame_registry[frame_id])

        tasks = [runtime_state.ready_queue.get(timeout=0.01) for _ in range(2)]
        resume_task = next(task for task in tasks if isinstance(task, ResumeTask))
        assert isinstance(resume_task.result, ContainerExecutionResult)
        assert resume_task.result.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
        assert {key: value.to_object() for key, value in resume_task.result.node_run_result.inputs.items()} == {
            "answer": "ok"
        }
        assert resume_task.result.node_run_result.error == "source failed"
        assert resume_task.result.node_run_result.error_type == "RuntimeError"

    @staticmethod
    def test_workflow_tool_handler_isolates_child_variable_pool() -> None:
        handler, frame_registry, _, request, _ = _workflow_tool_container_container_handler()

        handler.handle_request(invocation_id="invocation", request=request)

        child_pool = frame_registry["invocation:workflow-tool"].state.variable_pool
        assert child_pool.get(system_variable_selector(SystemVariableKey.USER_ID)).to_object() == "user"  # type: ignore[union-attr]
        assert child_pool.get(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID)).to_object() == (  # type: ignore[union-attr]
            "outer-execution"
        )
        assert child_pool.get(system_variable_selector(SystemVariableKey.APP_ID)).to_object() == (  # type: ignore[union-attr]
            "source-app"
        )
        assert child_pool.get(("env", "outer-secret")) is None
        assert child_pool.get(("source-start", "stale")) is None

    @staticmethod
    def test_workflow_tool_handler_applies_start_input_defaults() -> None:
        handler, frame_registry, _, request, _ = _workflow_tool_container_container_handler(inputs={})

        handler.handle_request(invocation_id="invocation", request=request)

        answer = frame_registry["invocation:workflow-tool"].state.variable_pool.get(("source-start", "answer"))
        assert answer is not None
        assert answer.to_object() == "fallback"

    @staticmethod
    def test_workflow_tool_handler_preserves_inputs_when_start_validation_fails() -> None:
        handler, _, runtime_state, request, _ = _workflow_tool_container_container_handler(inputs={"answer": 42})

        handler.handle_request(invocation_id="invocation", request=request)

        resume_task = runtime_state.ready_queue.get(timeout=0.01)
        assert isinstance(resume_task, ResumeTask)
        assert isinstance(resume_task.result, ContainerExecutionResult)
        assert resume_task.result.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
        assert {key: value.to_object() for key, value in resume_task.result.node_run_result.inputs.items()} == {
            "answer": 42
        }
        assert resume_task.result.node_run_result.error_type == "ValueError"

    @staticmethod
    def test_workflow_tool_nested_handler_hides_and_persists_marked_child_events() -> None:
        _, frame_registry, _, request, repository = _workflow_tool_container_container_handler()
        persisted: list[_workflow_tool_container_NodeEvent] = []
        event_listeners: dict[str, Callable[[_workflow_tool_container_NodeEvent], None]] = {}
        workflow_tool_handler = WorkflowToolContainerHandler(
            frame_registry,
            sources=repository,
            event_listener_factory=lambda *_: persisted.append,
            event_listeners=event_listeners,
        )
        workflow_tool_handler.handle_request(invocation_id="invocation", request=request)
        built_in_handler = LoopContainerHandler(frame_registry)
        hidden_events: list[_workflow_tool_container_NodeEvent] = []
        nested_handler = WorkflowToolNestedContainerHandler(
            frame_registry,
            handler_factory=lambda _: built_in_handler,
            hidden_event_listener=hidden_events.append,
            event_listeners=event_listeners,
        )
        event = NodeRunSucceededEvent(
            id="source-execution",
            node_id="source-start",
            node_type=BuiltinNodeTypes.START,
            start_at=datetime.now(UTC).replace(tzinfo=None),
            container_id="nested-container",
        )

        workflow_tool_handler.prepare_frame_event(
            frame=frame_registry["invocation:workflow-tool"],
            event=event,
        )

        assert nested_handler.should_emit(event=event) is False
        assert hidden_events == [event]
        assert len(persisted) == 1
        assert persisted[0].container_id == "nested-container"
        assert persisted[0].node_run_result.process_data["workflow_tool_invocation_id"] == "invocation"
        assert "__dify_workflow_tool_child__" not in persisted[0].node_run_result.process_data

        # Another Workflow Tool inside this container owns its own source events.
        inner_events: list[_workflow_tool_container_NodeEvent] = []
        event_listeners["inner-tool-frame"] = inner_events.append
        inner_event = event.model_copy(deep=True)
        inner_event.node_run_result.process_data = {}
        workflow_tool_handler.prepare_frame_event(
            frame=replace(frame_registry["invocation:workflow-tool"], frame_id="inner-tool-frame"), event=inner_event
        )
        workflow_tool_handler.prepare_frame_event(frame=frame_registry["invocation:workflow-tool"], event=inner_event)
        assert nested_handler.should_emit(event=inner_event) is False
        assert inner_events == [inner_event]
        assert len(persisted) == 1

        unmarked_event = event.model_copy(deep=True)
        unmarked_event.node_run_result.process_data = {}
        assert nested_handler.should_emit(event=unmarked_event) is True
        assert len(persisted) == 1

    @staticmethod
    @pytest.mark.parametrize(
        "source_metadata",
        [{}, {WorkflowNodeExecutionMetadataKey.LOOP_ID: "source-loop", WorkflowNodeExecutionMetadataKey.LOOP_INDEX: 1}],
    )
    def test_workflow_tool_persistence_keeps_source_container_metadata(
        source_metadata: dict[WorkflowNodeExecutionMetadataKey, str | int],
    ) -> None:
        _, frames, _, request, repository = _workflow_tool_container_container_handler()
        persisted: list[_workflow_tool_container_NodeEvent] = []
        handler = WorkflowToolContainerHandler(
            frames, sources=repository, event_listener_factory=lambda *_: persisted.append
        )
        handler.handle_request(invocation_id="invocation", request=request)
        event = NodeRunSucceededEvent(
            id="source-execution",
            node_id="source-start",
            node_type=BuiltinNodeTypes.START,
            start_at=datetime.now(UTC).replace(tzinfo=None),
        )
        event.node_run_result.metadata = source_metadata.copy()
        handler.prepare_frame_event(frame=frames["invocation:workflow-tool"], event=event)
        # Ancestors outside the Tool source add their own ownership before collection.
        event.node_run_result.metadata.update(
            {
                WorkflowNodeExecutionMetadataKey.ITERATION_ID: "outer-iteration",
                WorkflowNodeExecutionMetadataKey.ITERATION_INDEX: 2,
            }
        )
        event.node_run_result.outputs = {"normalized": True}

        assert handler.should_emit(event=event) is False

        assert persisted[0].node_run_result.metadata == source_metadata
        assert persisted[0].node_run_result.outputs == {"normalized": True}

    @staticmethod
    @pytest.mark.parametrize(
        (
            "child_error_strategy",
            "tool_error_strategy",
            "terminal_type",
            "expected_count",
            "expected_output",
            "retry_once",
        ),
        [
            pytest.param(
                ErrorStrategy.DEFAULT_VALUE,
                None,
                _workflow_tool_container_GraphRunSucceededEvent,
                0,
                '{"answer": "child fallback"}',
                False,
                id="child-handles-failure",
            ),
            pytest.param(None, None, GraphRunFailedEvent, 1, None, False, id="unhandled-failure"),
            pytest.param(
                None,
                ErrorStrategy.DEFAULT_VALUE,
                GraphRunPartialSucceededEvent,
                1,
                "tool fallback",
                False,
                id="tool-default-value",
            ),
            pytest.param(
                None,
                ErrorStrategy.FAIL_BRANCH,
                GraphRunPartialSucceededEvent,
                1,
                "source code failed",
                False,
                id="tool-fail-branch",
            ),
            pytest.param(
                None,
                None,
                _workflow_tool_container_GraphRunSucceededEvent,
                0,
                '{"answer": "retried output"}',
                True,
                id="child-retries",
            ),
        ],
    )
    def test_workflow_tool_failure_accounting_uses_outer_tool_policy(
        monkeypatch: pytest.MonkeyPatch,
        child_error_strategy: ErrorStrategy | None,
        tool_error_strategy: ErrorStrategy | None,
        terminal_type: type[
            _workflow_tool_container_GraphRunSucceededEvent | GraphRunFailedEvent | GraphRunPartialSucceededEvent
        ],
        expected_count: int,
        expected_output: str | None,
        retry_once: bool,
    ) -> None:
        attempts = 0

        def execute(**_kwargs: object) -> dict[str, str]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise CodeExecutionError("source code failed")
            return {"output": "retried output"}

        monkeypatch.setattr("core.workflow.node_factory.CodeExecutor.execute_workflow_code_template", execute)
        source = _workflow_tool_container_workflow_tool_source()
        source_graph = dict(source.graph_config)
        source_graph["nodes"].insert(
            1,
            {
                "id": "source-code",
                "data": {
                    "type": "code",
                    "title": "Code",
                    "code_language": "python3",
                    "code": "def main(): return {'output': 'retried output'}",
                    "outputs": {"output": {"type": "string"}},
                    "variables": [],
                    "error_strategy": child_error_strategy,
                    "default_value": [{"key": "output", "type": "string", "value": "child fallback"}],
                    "retry_config": {"retry_enabled": retry_once, "max_retries": 1, "retry_interval": 0},
                },
            },
        )
        source_graph["nodes"][-1]["data"]["outputs"][0]["value_selector"] = ["source-code", "output"]
        source_graph["edges"] = [
            {"id": "start-code", "source": "source-start", "target": "source-code"},
            {"id": "code-end", "source": "source-code", "target": "source-end"},
        ]
        repository = {}
        repository["source-workflow"] = replace(source, graph_config=source_graph)
        node, _, _ = _workflow_tool_container_workflow_tool_node()
        node.node_data.error_strategy = tool_error_strategy
        node.node_data.default_value = [DefaultValue(key="text", type=DefaultValueType.STRING, value="tool fallback")]
        start = StartNode(
            node_id="outer-start",
            data=StartNodeData(title="Start", variables=[]),
            init_params=node.init_params,
            runtime_state=node.runtime_state,
        )
        end = EndNode(
            node_id="outer-end",
            data=EndNodeData.model_validate(
                {
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "answer",
                            "value_selector": [
                                "tool",
                                "error_message" if tool_error_strategy == ErrorStrategy.FAIL_BRANCH else "text",
                            ],
                        }
                    ],
                }
            ),
            init_params=node.init_params,
            runtime_state=node.runtime_state,
        )
        graph = (
            Graph.new()
            .add_root(start)
            .add_node(node)
            .add_node(
                end, source_handle="fail-branch" if tool_error_strategy == ErrorStrategy.FAIL_BRANCH else "source"
            )
            .build()
        )
        persisted: list[_workflow_tool_container_NodeEvent] = []
        engine = Engine(
            graph=graph,
            runtime_state=node.runtime_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(
                partial(
                    WorkflowToolContainerHandler,
                    sources=repository,
                    event_listener_factory=lambda *_: persisted.append,
                ),
            ),
        )
        events: list[EngineEvent] = []
        if terminal_type is GraphRunFailedEvent:
            with pytest.raises(RuntimeError, match="source code failed"):
                events.extend(engine.run())
        else:
            events.extend(engine.run())

        assert attempts == (2 if retry_once else 1)
        assert isinstance(events[-1], terminal_type)
        assert node.runtime_state.graph_execution.exceptions_count == expected_count
        if isinstance(events[-1], GraphRunFailedEvent):
            assert events[-1].error == "source code failed"
            assert not any(isinstance(event, NodeRunSucceededEvent) and event.node_id == end.id for event in events)
        else:
            assert isinstance(
                events[-1], _workflow_tool_container_GraphRunSucceededEvent | GraphRunPartialSucceededEvent
            )
            assert events[-1].outputs == {"answer": expected_output}
        if tool_error_strategy is not None:
            assert any(isinstance(event, NodeRunExceptionEvent) and event.node_id == node.id for event in events)
        if isinstance(events[-1], GraphRunFailedEvent | GraphRunPartialSucceededEvent):
            assert events[-1].exceptions_count == expected_count
        if child_error_strategy is not None:
            assert any(
                isinstance(event, NodeRunExceptionEvent) and event.node_id == "source-code" for event in persisted
            )
        if retry_once:
            assert [event.retry_index for event in persisted if isinstance(event, NodeRunRetryEvent)] == [1]
            assert any(
                isinstance(event, NodeRunSucceededEvent) and event.node_id == "source-code" for event in persisted
            )

    @staticmethod
    @pytest.mark.parametrize("outcome", ["paused", "resumed", "abort-on-resume", "stopped"])
    def test_workflow_tool_human_input_pauses_and_resumes_without_duplicate_form(
        monkeypatch: pytest.MonkeyPatch,
        mocker: MockerFixture,
        outcome: str,
    ) -> None:
        command_channel = InMemoryChannel()

        def stop_on_human_input(
            event: _workflow_tool_container_NodeEvent, *, channel: InMemoryChannel, should_stop: bool
        ) -> None:
            if should_stop and isinstance(event, NodeRunPauseRequestedEvent):
                channel.send_command(AbortCommand())

        source_repository = {"source-workflow": _human_input_workflow_tool_source()}
        handler_factory = partial(
            WorkflowToolContainerHandler,
            sources=source_repository,
            hidden_event_listener=partial(
                stop_on_human_input, channel=command_channel, should_stop=outcome == "stopped"
            ),
        )
        form_repository = HumanInputFormRepositoryImpl(
            tenant_id="tenant", app_id="outer-app", workflow_execution_id="outer-execution"
        )
        create_form_spy = mocker.spy(form_repository, "create_form")
        human_input_app_ids: list[str] = []

        def build_human_input_callback(
            factory: DifyNodeFactory,
            *,
            node_data: HumanInputNodeData,
            execution_id_getter: Callable[[], str | None],
        ) -> DifyHITLCallback:
            human_input_app_ids.append(factory._human_input_runtime._run_context.app_id)
            return DifyHITLCallback(
                form_repository=form_repository,
                node_data=node_data,
                execution_id_getter=execution_id_getter,
            )

        monkeypatch.setattr(DifyNodeFactory, "_build_human_input_callback", build_human_input_callback)

        outer_pool = VariablePool()
        outer_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "outer-execution")
        outer_pool.add(system_variable_selector(SystemVariableKey.APP_ID), "outer-app")
        outer_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_ID), "outer-workflow")
        initial_state = RuntimeState(
            workflow_id="outer-workflow",
            variable_pool=outer_pool,
            start_at=1,
        )
        initial_node, _, _ = _workflow_tool_container_workflow_tool_node(initial_state, app_id="intermediate-app")
        initial_graph = _workflow_tool_container_outer_graph(initial_node)
        initial_owner_factory = DifyNodeFactory(
            initial_node.init_params, initial_state, human_input_run_context=build_test_run_context(app_id="outer-app")
        )
        initial_graph.node_factory = initial_owner_factory
        initial_events = list(
            Engine(
                graph=initial_graph,
                runtime_state=initial_state,
                command_channel=command_channel,
                workers=1,
                container_handler_factories=(handler_factory,),
            ).run()
        )

        paused = initial_events[-1]
        if outcome == "stopped":
            assert isinstance(paused, GraphRunAbortedEvent)
            return
        assert isinstance(paused, GraphRunPausedEvent)
        assert len(paused.reasons) == 1
        reason = paused.reasons[0]
        assert isinstance(reason, HitlRequired)
        assert reason.node_id == "source-human"
        assert reason.node_title == "Approval"
        assert all(
            not isinstance(event, _workflow_tool_container_NodeEvent)
            or event.node_id not in {"source-start", "source-human"}
            for event in initial_events
        )
        create_form_spy.assert_called_once()
        create_params = create_form_spy.call_args.args[0]
        assert create_params.node_id == "source-human"
        assert create_params.workflow_execution_id == "outer-execution"
        child_frames = list(initial_state.container_frames())
        assert len(child_frames) == 1
        child_execution = initial_state.graph_execution.node_executions[(child_frames[0].frame_id, "source-human")]
        assert create_params.form_id == child_execution.execution_id
        assert human_input_app_ids == ["outer-app"]

        if outcome == "paused":
            return

        restored_state = RuntimeState.from_snapshot(initial_state.dumps())
        assert (
            resolve_human_input_node_id(
                node_id=reason.node_id,
                form_id=reason.session_id,
                variable_pool=restored_state.variable_pool,
            )
            == "tool"
        )
        restored_node, _, _ = _workflow_tool_container_workflow_tool_node(restored_state, app_id="intermediate-app")
        restored_graph = _workflow_tool_container_outer_graph(restored_node)
        restored_owner_factory = DifyNodeFactory(
            restored_node.init_params,
            restored_state,
            human_input_run_context=initial_owner_factory.human_input_run_context,
        )
        restored_graph.node_factory = restored_owner_factory
        if outcome == "resumed":
            HumanInputFormSubmissionRepository().mark_submitted(
                form_id=reason.session_id,
                recipient_id=None,
                selected_action_id="approve",
                form_data={},
                submission_user_id="user",
                submission_end_user_id=None,
            )
        resumed_channel = InMemoryChannel()
        resumed_handler_factory = partial(
            WorkflowToolContainerHandler,
            sources=source_repository,
            hidden_event_listener=partial(
                stop_on_human_input, channel=resumed_channel, should_stop=outcome == "abort-on-resume"
            ),
        )
        resumed_events = list(
            Engine(
                graph=restored_graph,
                runtime_state=restored_state,
                command_channel=resumed_channel,
                workers=1,
                container_handler_factories=(resumed_handler_factory,),
            ).run()
        )

        if outcome == "abort-on-resume":
            assert isinstance(resumed_events[-1], GraphRunAbortedEvent)
            return
        assert isinstance(resumed_events[-1], _workflow_tool_container_GraphRunSucceededEvent)
        tool_succeeded = next(
            event for event in resumed_events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "tool"
        )
        assert tool_succeeded.node_run_result.outputs["decision"].to_object() == "approve"
        assert json.loads(tool_succeeded.node_run_result.outputs["text"].to_object()) == {"decision": "approve"}
        files = restored_state.variable_pool.get(("tool", "files"))
        assert files is not None
        assert files.value_type == SegmentType.ARRAY_FILE
        assert files.to_object() == []
        create_form_spy.assert_called_once()
        assert human_input_app_ids == ["outer-app", "outer-app"]
        assert all(
            not isinstance(event, _workflow_tool_container_NodeEvent)
            or event.node_id not in {"source-human", "source-end"}
            for event in resumed_events
        )
        assert list(restored_state.container_frames()) == []
        assert list(restored_state.container_runs()) == []


_workflow_tool_observability_outer_graph = _workflow_tool_container_outer_graph
_workflow_tool_observability_workflow_tool_node = _workflow_tool_container_workflow_tool_node
_workflow_tool_observability_workflow_tool_source = _workflow_tool_container_workflow_tool_source


class TestWorkflowToolObservabilityCases:
    from tests.unit_tests.core.app.workflow.layers.conftest import memory_span_exporter

    memory_span_exporter = staticmethod(memory_span_exporter)

    from tests.unit_tests.core.app.workflow.layers.conftest import tracer_provider_with_memory_exporter

    tracer_provider_with_memory_exporter = staticmethod(tracer_provider_with_memory_exporter)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_start_node

    mock_start_node = staticmethod(mock_start_node)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_llm_node

    mock_llm_node = staticmethod(mock_llm_node)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_tool_node

    mock_tool_node = staticmethod(mock_tool_node)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_is_instrument_flag_enabled_false

    mock_is_instrument_flag_enabled_false = staticmethod(mock_is_instrument_flag_enabled_false)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_is_instrument_flag_enabled_true

    mock_is_instrument_flag_enabled_true = staticmethod(mock_is_instrument_flag_enabled_true)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_retrieval_node

    mock_retrieval_node = staticmethod(mock_retrieval_node)

    from tests.unit_tests.core.app.workflow.layers.conftest import mock_result_event

    mock_result_event = staticmethod(mock_result_event)

    @staticmethod
    def test_workflow_tool_tracing_survives_worker_handoff(
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        tracer_provider_with_memory_exporter: TracerProvider,
        memory_span_exporter: InMemorySpanExporter,
    ) -> None:
        apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
        tool_started_on: list[int] = []
        tool_finished_on: list[int] = []
        completed = Event()

        class HandoffLayer(Layer):
            @override
            def node_run_context(
                self, node: Node[BaseNodeData], *, parent_execution_id: str | None = None
            ) -> AbstractContextManager[None]:
                return HandoffContext()

            @override
            def on_node_run_start(self, node: Node[BaseNodeData]) -> None:
                if node.id == "tool":
                    tool_started_on.append(get_ident())

            @override
            def on_node_run_end(
                self,
                node: Node[BaseNodeData],
                error: Exception | None,
                result_event: _workflow_tool_observability_NodeEvent | None = None,
            ) -> None:
                if node.id == "tool":
                    tool_finished_on.append(get_ident())
                    completed.set()

        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
        with tracer.start_as_current_span("workflow") as root_span:
            captured_context = capture_current_context()

            class HandoffContext(AbstractContextManager[None]):
                @override
                def __enter__(self) -> None:
                    captured_context.__enter__()

                @override
                def __exit__(
                    self,
                    exc_type: type[BaseException] | None,
                    exc: BaseException | None,
                    traceback: TracebackType | None,
                ) -> None:
                    captured_context.__exit__(exc_type, exc, traceback)
                    if tool_started_on == [get_ident()] and not completed.is_set():
                        # Keep the starting worker occupied after suspension so another
                        # worker must execute the child graph and resume the Tool.
                        assert completed.wait(10), "Workflow Tool did not resume on the available worker"

            state = RuntimeState(workflow_id="outer-workflow", variable_pool=VariablePool(), start_at=1)
            tool, _, _ = _workflow_tool_observability_workflow_tool_node(state)
            original_resume = tool._resume_container_events

            def instrument_resume(*, result: ContainerRunResult) -> Generator[NodeEventPayload | ContainerAwaitRequest]:
                with tracer.start_as_current_span("resume-operation"):
                    yield from original_resume(result=result)

            monkeypatch.setattr(tool, "_resume_container_events", instrument_resume)
            source = _workflow_tool_observability_workflow_tool_source()
            sources = {source.workflow_id: source}
            engine = Engine(
                graph=_workflow_tool_observability_outer_graph(tool),
                runtime_state=state,
                workers=2,
                container_handler_factories=(partial(WorkflowToolContainerHandler, sources=sources),),
            )
            engine.add_layer(HandoffLayer())
            engine.add_layer(ObservabilityLayer())

            events = list(engine.run())

        assert isinstance(events[-1], _workflow_tool_observability_GraphRunSucceededEvent)
        assert len(tool_started_on) == len(tool_finished_on) == 1
        assert tool_started_on != tool_finished_on
        spans = memory_span_exporter.get_finished_spans()
        tool_spans = [span for span in spans if (span.attributes or {}).get("node.id") == "tool"]
        assert len(tool_spans) == 1
        tool_span = tool_spans[0]
        assert tool_span.parent == root_span.get_span_context()
        resumed_operations = [span for span in spans if span.name == "resume-operation"]
        assert len(resumed_operations) == 1
        assert resumed_operations[0].parent == tool_span.context
        assert "was created in a different Context" not in caplog.text
        children = [span for span in spans if (span.attributes or {}).get("node.id") in {"source-start", "source-end"}]
        assert len(children) == 2
        assert all(span.parent == tool_span.context for span in children)

    @staticmethod
    def test_standalone_node_uses_worker_scoped_tracing_context(
        monkeypatch: pytest.MonkeyPatch,
        tracer_provider_with_memory_exporter: TracerProvider,
        memory_span_exporter: InMemorySpanExporter,
    ) -> None:
        apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
        tool, _, _ = _workflow_tool_observability_workflow_tool_node()
        node = _workflow_tool_observability_outer_graph(tool).root_node
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
        with tracer.start_as_current_span("standalone") as parent:
            events = list(WorkflowEntry._run_node_with_layers(node))
            assert get_current_span() is parent

        assert isinstance(events[-1], _workflow_tool_observability_NodeEvent)
        assert events[-1].node_run_result.status == "succeeded"
        node_spans = [span for span in memory_span_exporter.get_finished_spans() if span.name == node.title]
        assert len(node_spans) == 1
        assert node_spans[0].parent == parent.get_span_context()

    @staticmethod
    def test_interleaved_snippets_restore_caller_flask_context(
        monkeypatch: pytest.MonkeyPatch,
        tracer_provider_with_memory_exporter: TracerProvider,
        memory_span_exporter: InMemorySpanExporter,
    ) -> None:
        apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
        monkeypatch.setattr(module, "capture_current_context", capture_flask_context)
        request_id: ContextVar[str] = ContextVar("snippet_request_id")
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
        parents = []
        snippets = []
        observed = []
        for name in ("first", "second"):
            app = DifyApp(name)
            init_app(app)
            with app.app_context(), tracer.start_as_current_span(name) as parent:
                parents.append(parent.get_span_context())
                g._login_user = name
                request_id.set(name)
                tool, _, _ = _workflow_tool_observability_workflow_tool_node()
                node = _workflow_tool_observability_outer_graph(tool).root_node

                def run_node() -> Generator[NodeRunStreamChunkEvent]:
                    observed.append((current_app.name, g._login_user, request_id.get()))
                    yield NodeRunStreamChunkEvent(
                        id="snippet-execution",
                        node_id="outer-start",
                        node_type=BuiltinNodeTypes.START,
                        selector=["outer-start", "text"],
                        chunk="part",
                        is_final=False,
                    )
                    observed.append((current_app.name, g._login_user, request_id.get()))
                    yield NodeRunStreamChunkEvent(
                        id="snippet-execution",
                        node_id="outer-start",
                        node_type=BuiltinNodeTypes.START,
                        selector=["outer-start", "text"],
                        chunk="part",
                        is_final=False,
                    )

                monkeypatch.setattr(node, "run", run_node)
                snippets.append(WorkflowEntry._run_node_with_layers(node))

        caller = DifyApp("caller")
        init_app(caller)
        with caller.app_context(), tracer.start_as_current_span("caller") as caller_span:
            g._login_user = "caller"
            request_id.set("caller")
            for _ in range(2):
                for snippet in snippets:
                    next(snippet)
                    assert current_app == caller
                    assert g._login_user == request_id.get() == "caller"
                    assert get_current_span() is caller_span
            for snippet in snippets:
                snippet.close()
                assert current_app == caller
                assert g._login_user == request_id.get() == "caller"
                assert get_current_span() is caller_span

        assert observed == [(name, name, name) for name in ("first", "second", "first", "second")]
        spans = memory_span_exporter.get_finished_spans()
        node_spans = [span for span in spans if (span.attributes or {}).get("node.id") == "outer-start"]
        assert len(node_spans) == 2
        assert [span.parent for span in node_spans] == parents


_workflow_tool_event_delivery_container_handler = _workflow_tool_container_container_handler
_workflow_tool_event_delivery_outer_graph = _workflow_tool_container_outer_graph
_workflow_tool_event_delivery_workflow_tool_node = _workflow_tool_container_workflow_tool_node


class TestWorkflowToolEventDeliveryCases:
    @staticmethod
    def test_workflow_tool_loop_break_does_not_escape_into_enclosing_loop(monkeypatch: pytest.MonkeyPatch) -> None:
        def node(node_id: str, node_type: str, **data: object) -> dict[str, object]:
            return {"id": node_id, "data": {"type": node_type, "title": node_id, **data}}

        def edge(source: str, target: str, handle: str = "source") -> dict[str, str]:
            return {"id": f"{source}-{target}", "source": source, "target": target, "sourceHandle": handle}

        tool_node, runtime, _ = _workflow_tool_event_delivery_workflow_tool_node()
        monkeypatch.setattr("core.workflow.node_factory.DifyToolNodeRuntime", lambda _, **_kwargs: runtime)
        outer_graph = {
            "nodes": [
                node("start", "start", variables=[]),
                node(
                    "outer-loop",
                    "loop",
                    loop_count=3,
                    start_node_id="outer-loop-start",
                    break_conditions=[],
                    logical_operator="and",
                    loop_variables=[
                        {"id": "guard", "label": "guard", "var_type": "number", "value_type": "constant", "value": 0}
                    ],
                ),
                node("outer-loop-start", "loop-start", loop_id="outer-loop"),
                node(
                    "condition",
                    "if-else",
                    loop_id="outer-loop",
                    cases=[
                        {
                            "case_id": "true",
                            "logical_operator": "and",
                            "conditions": [
                                {"comparison_operator": "=", "variable_selector": ["outer-loop", "guard"], "value": "1"}
                            ],
                        }
                    ],
                ),
                {"id": "tool", "data": {**tool_node.node_data.model_dump(), "loop_id": "outer-loop"}},
                node("shared-loop-end", "loop-end", loop_id="outer-loop"),
                node(
                    "end",
                    "end",
                    outputs=[
                        {"variable": "rounds", "value_selector": ["outer-loop", "loop_round"], "value_type": "number"}
                    ],
                ),
            ],
            "edges": [
                edge("start", "outer-loop"),
                edge("outer-loop", "end"),
                edge("outer-loop-start", "condition"),
                edge("condition", "tool", "false"),
                edge("condition", "shared-loop-end", "true"),
            ],
        }
        _, _, _, _, repository = _workflow_tool_event_delivery_container_handler()
        repository["source-workflow"] = replace(
            repository["source-workflow"],
            graph_config={
                "nodes": [
                    node("source-start", "start", variables=[]),
                    node(
                        "source-loop",
                        "loop",
                        loop_count=3,
                        start_node_id="source-loop-start",
                        break_conditions=[],
                        logical_operator="and",
                    ),
                    node("source-loop-start", "loop-start", loop_id="source-loop"),
                    node("shared-loop-end", "loop-end", loop_id="source-loop"),
                    node("source-end", "end", outputs=[]),
                ],
                "edges": [
                    edge("source-start", "source-loop"),
                    edge("source-loop", "source-end"),
                    edge("source-loop-start", "shared-loop-end"),
                ],
            },
        )
        state = tool_node.runtime_state
        graph = Graph.init(
            graph_config=outer_graph,
            node_factory=DifyNodeFactory(
                init_params=build_test_graph_init_params(workflow_id="outer-workflow", graph_config=outer_graph),
                runtime_state=state,
            ),
            root_node_id="start",
        )
        persisted: list[_workflow_tool_event_delivery_NodeEvent] = []
        events = list(
            Engine(
                graph=graph,
                runtime_state=state,
                workers=1,
                container_handler_factories=(
                    partial(WorkflowToolNestedContainerHandler, handler_factory=LoopContainerHandler),
                    partial(
                        WorkflowToolContainerHandler,
                        sources=repository,
                        event_listener_factory=lambda *_: persisted.append,
                    ),
                ),
            ).run()
        )

        assert isinstance(events[-1], _workflow_tool_event_delivery_GraphRunSucceededEvent)
        assert state.outputs == {"rounds": 3}
        assert [
            event.node_run_result.outputs["loop_round"].to_object()
            for event in persisted
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == "source-loop"
        ] == [1, 1, 1]

    @staticmethod
    def test_workflow_tool_persists_loop_outputs_after_graphon_normalizes_them() -> None:
        _, frames, state, request, repository = _workflow_tool_event_delivery_container_handler()
        source = repository["source-workflow"]
        repository["source-workflow"] = replace(
            source,
            graph_config={
                "nodes": [
                    {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                    {
                        "id": "loop",
                        "data": {
                            "type": "loop",
                            "title": "Loop",
                            "loop_count": 1,
                            "start_node_id": "loop-start",
                            "break_conditions": [],
                            "logical_operator": "and",
                        },
                    },
                    {"id": "loop-start", "data": {"type": "loop-start", "title": "Loop start", "loop_id": "loop"}},
                ],
                "edges": [{"id": "start-loop", "source": "start", "target": "loop"}],
            },
        )
        persisted: list[_workflow_tool_event_delivery_NodeEvent] = []
        handler = WorkflowToolContainerHandler(
            frames, sources=repository, event_listener_factory=lambda *_: persisted.append
        )
        handler.handle_request(invocation_id="invocation", request=request)
        frame = frames["invocation:workflow-tool"]
        frame.state.variable_pool.add(("loop", "counter"), 2)
        processor = NodeEventProcessor(
            graph_execution=state.graph_execution,
            event_stream=EventStream(layers=[]),
            frame_registry=frames,
            container_handlers={BuiltinNodeTypes.TOOL: handler},
        )
        event = NodeRunSucceededEvent(
            id="loop-execution",
            node_id="loop",
            node_type=BuiltinNodeTypes.LOOP,
            start_at=datetime.now(UTC).replace(tzinfo=None),
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"counter": 1}),
        )

        processor.dispatch(NodeEventTask(frame_id=frame.frame_id, event=event))

        assert {key: value.to_object() for key, value in event.node_run_result.outputs.items()} == {"counter": 2}
        assert {key: value.to_object() for key, value in persisted[0].node_run_result.outputs.items()} == {"counter": 2}
        assert persisted[0].container_id == ""

    @staticmethod
    @pytest.mark.parametrize("listener_fails", [False, True])
    def test_workflow_tool_delivers_source_events_to_persistence_without_exposing_them(
        listener_fails: bool, caplog: pytest.LogCaptureFixture
    ) -> None:
        node, _, payload = _workflow_tool_event_delivery_workflow_tool_node()
        source = WorkflowToolSource(
            app_id=payload.source_app_id,
            workflow_id=payload.source_workflow_id,
            graph_config={
                "nodes": [
                    {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": []}},
                    {"id": "source-end", "data": {"type": "end", "title": "End", "outputs": []}},
                ],
                "edges": [{"id": "source-edge", "source": "source-start", "target": "source-end"}],
            },
            features_dict={},
            environment_variables=[],
            workflow_kind=WorkflowKind.STANDARD,
        )
        repository = {}
        repository["source-workflow"] = source
        persisted: list[_workflow_tool_event_delivery_NodeEvent] = []

        def persist_event(event: _workflow_tool_event_delivery_NodeEvent) -> None:
            persisted.append(event)
            if listener_fails:
                raise RuntimeError("Trace store unavailable")

        listener_requests: list[tuple[WorkflowToolSource, str, str]] = []

        def listener_factory(
            tool_source: WorkflowToolSource, workflow_id: str, execution_id: str
        ) -> Callable[[_workflow_tool_event_delivery_NodeEvent], None]:
            listener_requests.append((tool_source, workflow_id, execution_id))
            return persist_event

        events = list(
            Engine(
                graph=_workflow_tool_event_delivery_outer_graph(node),
                runtime_state=node.runtime_state,
                command_channel=InMemoryChannel(),
                workers=1,
                container_handler_factories=(
                    partial(
                        WorkflowToolContainerHandler,
                        sources=repository,
                        event_listener_factory=listener_factory,
                    ),
                ),
            ).run()
        )

        assert isinstance(events[-1], _workflow_tool_event_delivery_GraphRunSucceededEvent)
        caller_event = next(
            event for event in events if isinstance(event, NodeRunStartedEvent) and event.node_id == "tool"
        )
        assert listener_requests == [(source, node.workflow_id, caller_event.id)]
        assert [event.node_id for event in persisted if isinstance(event, NodeRunStartedEvent)] == [
            "source-start",
            "source-end",
        ]
        assert [event.node_id for event in persisted if isinstance(event, NodeRunSucceededEvent)] == [
            "source-start",
            "source-end",
        ]
        assert all(not event.container_id for event in persisted)
        completed_tool = next(
            event for event in events if isinstance(event, NodeRunSucceededEvent) and event.node_id == node.id
        )
        assert completed_tool.node_run_result.outputs["json"].to_object() == [{}]
        assert len({event.node_run_result.process_data[WORKFLOW_TOOL_INVOCATION_ID_KEY] for event in persisted}) == 1
        assert all(
            event.node_id not in {"source-start", "source-end"}
            for event in events
            if isinstance(event, _workflow_tool_event_delivery_NodeEvent)
        )
        if listener_fails:
            assert "Failed to persist Workflow Tool event" in caplog.text

    @staticmethod
    @pytest.mark.parametrize("caller_save_fails", [False, True])
    def test_workflow_tool_agent_finds_its_persisted_caller_before_resolving_binding(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
        caller_save_fails: bool,
    ) -> None:
        binding_resolver = WorkflowAgentBindingResolver()
        resolution_calls: list[dict[str, object]] = []
        if caller_save_fails:

            def reject_resolution(**kwargs: object) -> None:
                resolution_calls.append(kwargs)
                pytest.fail("Binding resolution must wait for a persisted caller")

            monkeypatch.setattr(binding_resolver, "resolve", reject_resolution)
            monkeypatch.setattr("core.workflow.node_factory.WorkflowAgentBindingResolver", lambda: binding_resolver)
            save = SQLAlchemyWorkflowNodeExecutionRepository.save

            def fail_caller_save(
                repository: SQLAlchemyWorkflowNodeExecutionRepository, execution: WorkflowNodeExecution
            ) -> None:
                if execution.node_id == "source-agent" and execution.status == WorkflowNodeExecutionStatus.RUNNING:
                    raise RuntimeError("Caller store unavailable")
                save(repository, execution)

            monkeypatch.setattr(SQLAlchemyWorkflowNodeExecutionRepository, "save", fail_caller_save)
        monkeypatch.setattr(
            "clients.agent_backend.factory.create_agent_backend_run_client",
            lambda **_kwargs: FakeAgentBackendRunClient(),
        )
        node, _, payload = _workflow_tool_event_delivery_workflow_tool_node()
        source = WorkflowToolSource(
            app_id=payload.source_app_id,
            workflow_id=payload.source_workflow_id,
            graph_config={
                "nodes": [
                    {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": []}},
                    {
                        "id": "source-agent",
                        "data": {
                            "type": "agent",
                            "version": "2",
                            "agent_node_kind": "dify_agent",
                            "title": "Unconfigured Agent",
                            "error_strategy": "default-value",
                            "default_value": [],
                        },
                    },
                ],
                "edges": [{"id": "source-edge", "source": "source-start", "target": "source-agent"}],
            },
            features_dict={},
            environment_variables=[],
            workflow_kind=WorkflowKind.STANDARD,
        )
        source_repository = {}
        source_repository["source-workflow"] = source
        user = Account(name="Test", email="test@example.com")
        user.id = "user"
        layer = WorkflowPersistenceLayer(
            application_generate_entity=WorkflowAppGenerateEntity(
                task_id="task",
                app_config=WorkflowAppConfig(
                    app_id="outer-app",
                    tenant_id="tenant",
                    workflow_id="outer-workflow",
                    app_mode=AppMode.WORKFLOW,
                ),
                inputs={},
                files=[],
                user_id=user.id,
                stream=True,
                invoke_from=InvokeFrom.SERVICE_API,
                extras={},
                workflow_execution_id="outer-run",
            ),
            workflow_info=PersistenceWorkflowInfo(
                workflow_id="outer-workflow",
                workflow_type=WorkflowType.WORKFLOW,
                version="1",
                graph_data=node.init_params.graph_config,
            ),
            workflow_execution_repository=SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id="tenant",
                user=user,
                app_id="outer-app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            ),
            workflow_node_execution_repository=SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id="tenant",
                user=user,
                app_id="outer-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            ),
        )
        index = WorkflowRunIndex(())
        index.seed_source(source.app_id, source.workflow_id, ())
        layer.set_node_run_indices(index.indices)
        node.runtime_state.variable_pool.add(("sys", "workflow_run_id"), "outer-run")
        engine = Engine(
            graph=_workflow_tool_event_delivery_outer_graph(node),
            runtime_state=node.runtime_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(
                partial(
                    WorkflowToolContainerHandler,
                    sources=source_repository,
                    event_listener_factory=layer.create_workflow_tool_event_listener,
                ),
            ),
        )
        engine.add_layer(index)
        engine.add_layer(layer)

        events = list(engine.run())

        assert isinstance(events[-1], _workflow_tool_event_delivery_GraphRunSucceededEvent)
        with sqlite_session_factory() as session:
            execution = session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "source-agent")
            ).one()
            assert (execution.app_id, execution.workflow_id, execution.workflow_run_id) == (
                "source-app",
                "source-workflow",
                "outer-run",
            )
            assert execution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
            caller = session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "tool")
            ).one()
            assert (execution.triggered_from_workflow_id, execution.triggered_from_node_execution_id) == (
                "outer-workflow",
                caller.node_execution_id,
            )
            assert execution.status == "exception"
            if caller_save_fails:
                assert resolution_calls == []
                assert execution.error == "Workflow node execution caller is unavailable"
                assert execution.outputs_dict["error_type"] == "agent_workflow_node_runtime_error"
            else:
                # The real workspace store must see the caller synchronously before
                # the binding resolver reports this deliberately unconfigured Agent.
                assert execution.error == "Workflow Agent binding not found for node source-agent."
                assert execution.outputs_dict["error_type"] == "agent_binding_not_found"
            run = session.scalars(select(WorkflowRun)).one()
            assert (run.app_id, run.workflow_id, run.status) == ("outer-app", "outer-workflow", "succeeded")
        assert not any(
            isinstance(event, _workflow_tool_event_delivery_NodeEvent) and event.node_id == "source-agent"
            for event in events
        )


_workflow_tool_file_access_workflow_tool_node = _workflow_tool_container_workflow_tool_node


class TestWorkflowToolFileAccessCases:
    @staticmethod
    @pytest.mark.parametrize("input_kind", ["system_files", "file", "file-list"])
    @pytest.mark.parametrize("container_type", [None, "loop", "iteration"])
    @pytest.mark.parametrize(
        ("transfer_method", "permission"),
        [
            ("local_file", "owned"),
            ("local_file", "other-user"),
            ("local_file", "granted"),
            ("tool_file", "owned"),
            ("tool_file", "other-user"),
        ],
    )
    def test_workflow_tool_dispatcher_enforces_file_ownership(
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        input_kind: str,
        container_type: str | None,
        transfer_method: str,
        permission: str,
    ) -> None:
        owner_id = "user" if permission == "owned" else "other-user"
        stored_file: UploadFile | ToolFile
        if transfer_method == "local_file":
            stored_file = UploadFile(
                tenant_id="tenant",
                storage_type=StorageType.LOCAL,
                key="stored-file.txt",
                name="attachment.txt",
                size=12,
                extension="txt",
                mime_type="text/plain",
                created_by=owner_id,
                created_by_role=CreatorUserRole.ACCOUNT if permission == "granted" else CreatorUserRole.END_USER,
                created_at=datetime.now(UTC),
                used=False,
            )
        else:
            stored_file = ToolFile(
                tenant_id="tenant",
                user_id=owner_id,
                conversation_id=None,
                file_key="stored-file.txt",
                name="attachment.txt",
                mimetype="text/plain",
                size=12,
            )
        sqlite_session.add(stored_file)
        sqlite_session.commit()
        mapping = {"transfer_method": transfer_method, "type": "document", "related_id": stored_file.id}
        scope = FileAccessScope(
            tenant_id="tenant",
            user_id="user",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.SERVICE_API,
            granted_upload_file_ids=frozenset({stored_file.id}) if permission == "granted" else frozenset(),
        )
        with bind_file_access_scope(scope):
            execution_context_layer = ExecutionContextLayer()
            runtime_state = RuntimeState(
                workflow_id="outer-workflow",
                variable_pool=VariablePool(),
                start_at=1,
            )
        template_node, runtime, payload = _workflow_tool_file_access_workflow_tool_node(runtime_state)
        monkeypatch.setattr("core.workflow.node_factory.DifyToolNodeRuntime", lambda _, **_kwargs: runtime)
        tool_data = template_node.node_data.model_dump(mode="python")
        nodes = [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
            {"id": "tool", "data": tool_data},
        ]
        edges = [{"id": "outer", "source": "start", "target": "tool"}]
        if container_type is not None:
            tool_data[f"{container_type}_id"] = container_type
            container_data: dict[str, object] = {
                "type": container_type,
                "title": container_type,
                "start_node_id": "body-start",
            }
            if container_type == "loop":
                container_data.update(loop_count=1, break_conditions=[], logical_operator="and")
            else:
                runtime_state.variable_pool.add(("start", "items"), ["one"])
                container_data.update(
                    iterator_selector=["start", "items"], output_selector=["tool", "text"], output_type="array[string]"
                )
            nodes.extend(
                [
                    {"id": container_type, "data": container_data},
                    {
                        "id": "body-start",
                        "data": {
                            "type": f"{container_type}-start",
                            "title": "Body start",
                            f"{container_type}_id": container_type,
                        },
                    },
                ]
            )
            edges = [
                {"id": "outer", "source": "start", "target": container_type},
                {"id": "inner", "source": "body-start", "target": "tool"},
            ]
        graph_config = {"nodes": nodes, "edges": edges}
        node_factory = DifyNodeFactory(
            init_params=template_node.init_params.model_copy(
                update={
                    "graph_config": graph_config,
                    "run_context": build_test_run_context(
                        app_id="outer-app", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.SERVICE_API
                    ),
                }
            ),
            runtime_state=runtime_state,
        )
        variables: list[dict[str, object]] = []
        if input_kind == "system_files":
            payload = payload.model_copy(update={"system_files": [mapping], "inputs": {}})
            output_selector = ["sys", "files"]
        else:
            variables = [
                {
                    "variable": "attachment",
                    "label": "Attachment",
                    "type": input_kind,
                    "allowed_file_types": ["document"],
                    "allowed_file_upload_methods": ["local_file"],
                }
            ]
            value = mapping if input_kind == "file" else [mapping]
            payload = payload.model_copy(update={"inputs": {"attachment": value}})
            output_selector = ["source-start", "attachment"]
        monkeypatch.setattr(runtime, "build_workflow_tool_container_payload", lambda **_kwargs: payload)
        source = WorkflowToolSource(
            app_id="source-app",
            workflow_id="source-workflow",
            graph_config={
                "nodes": [
                    {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": variables}},
                    {
                        "id": "source-end",
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "accepted", "value_selector": output_selector}],
                        },
                    },
                ],
                "edges": [{"id": "source-edge", "source": "source-start", "target": "source-end"}],
            },
            features_dict={},
            environment_variables=[],
            workflow_kind=WorkflowKind.STANDARD,
        )
        sources = {source.workflow_id: source}
        engine = Engine(
            graph=Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start"),
            runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(
                partial(
                    WorkflowToolContainerHandler,
                    sources=sources,
                    execution_context_factory=execution_context_layer.enter_context,
                ),
            ),
        )
        engine.add_layer(execution_context_layer)

        if permission == "other-user":
            expected_error = (
                "Invalid upload file" if transfer_method == "local_file" else f"ToolFile {stored_file.id} not found"
            )
            with pytest.raises(RuntimeError, match=expected_error):
                list(engine.run())
        else:
            events = list(engine.run())
            assert isinstance(events[-1], _workflow_tool_file_access_GraphRunSucceededEvent)
            tool_completed = next(
                event for event in events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "tool"
            )
            files_output = tool_completed.node_run_result.outputs["files"]
            assert isinstance(files_output, ArrayFileSegment)
            accepted_files = files_output.value
            assert len(accepted_files) == 1
            assert accepted_files[0].filename == stored_file.name
