from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any, final

from configs import dify_config
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom
from core.app.file_access import DatabaseFileAccessController
from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from core.workflow.node_factory import DifyGraphInitContext, DifyNodeFactory, get_default_root_node_id
from core.workflow.node_runtime import resolve_dify_run_context
from core.workflow.snippet_start import get_compatible_start_aliases
from core.workflow.system_variables import (
    SystemVariableKey,
    get_all_system_variables,
    system_variable_selector,
)
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from factories import file_factory
from graphon.engine.container_handler.protocol import ContainerHandler
from graphon.engine.frame import ExecutionFrame, FrameRegistry
from graphon.engine.ready_queue import ResumeTask
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import NodeRunFailedEvent, NodeRunPauseRequestedEvent
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file import File
from graphon.graph import Graph
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
    ContainerExecutionResult,
    ContainerNodeRunResult,
    CustomContainerRequest,
    build_container_value,
)
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.container_state import (
    ContainerFrameState,
    CustomContainerFrameState,
    CustomContainerRunState,
    FrameRuntimeData,
)
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter

from .workflow_tool_container_types import WorkflowToolContainerPayload

_file_access_controller = DatabaseFileAccessController()
_RESERVED_TOOL_OUTPUTS = frozenset(("text", "json", "files"))
_FAILURE_SELECTOR_PREFIX = "__workflow_tool_container__"
_HIDDEN_CHILD_EVENT_KEY = "__dify_workflow_tool_child__"


@final
class WorkflowToolNestedContainerHandler:
    """Suppress Workflow Tool events emitted through a nested built-in container."""

    def __init__(
        self,
        frame_registry: FrameRegistry,
        *,
        handler_factory: Callable[[FrameRegistry], ContainerHandler],
        hidden_event_listener: Callable[[NodeEvent], None] | None = None,
    ) -> None:
        self._handler = handler_factory(frame_registry)
        self._hidden_event_listener = hidden_event_listener
        self.node_type = self._handler.node_type

    def restore_frame(self, frame_state: ContainerFrameState) -> None:
        self._handler.restore_frame(frame_state)

    def handle_request(self, *, invocation_id: str, request: ContainerAwaitRequest) -> None:
        self._handler.handle_request(invocation_id=invocation_id, request=request)

    def prepare_frame_event(self, *, frame: ExecutionFrame, event: NodeEvent) -> None:
        self._handler.prepare_frame_event(frame=frame, event=event)

    def should_emit(self, *, event: NodeEvent) -> bool:
        should_emit = self._handler.should_emit(event=event)
        if should_emit and event.node_run_result.process_data.get(_HIDDEN_CHILD_EVENT_KEY) is True:
            if self._hidden_event_listener is not None:
                self._hidden_event_listener(event)
            return False
        return should_emit

    def record_frame_failure(self, *, frame: ExecutionFrame, event: NodeRunFailedEvent) -> None:
        self._handler.record_frame_failure(frame=frame, event=event)

    def complete_frame_if_ready(self, frame: ExecutionFrame) -> None:
        self._handler.complete_frame_if_ready(frame)


@final
class WorkflowToolContainerHandler:
    """Execute Workflow Tools as dynamic child frames owned by a Tool node."""

    node_type = BuiltinNodeTypes.TOOL

    def __init__(
        self,
        frame_registry: FrameRegistry,
        *,
        source_repository: WorkflowToolSourceRepository,
        hidden_event_listener: Callable[[NodeEvent], None] | None = None,
    ) -> None:
        self._frame_registry = frame_registry
        self._source_repository = source_repository
        self._hidden_event_listener = hidden_event_listener

    def restore_frame(self, frame_state: ContainerFrameState) -> None:
        if not isinstance(frame_state, CustomContainerFrameState):
            raise TypeError(f"Workflow Tool handler cannot restore {frame_state.kind} frame")
        variable_pool = frame_state.runtime_data.variable_pool
        if isinstance(variable_pool, str):
            raise TypeError(f"Workflow Tool frame {frame_state.frame_id} requires a local variable pool")

        run_state = self._custom_run(frame_state.parent_invocation_id)
        payload = WorkflowToolContainerPayload.model_validate_json(run_state.payload)
        self._create_frame(
            run_state=run_state,
            payload=payload,
            frame_id=frame_state.frame_id,
            runtime_data=frame_state.runtime_data,
            variable_pool=variable_pool.model_copy(deep=True),
        )

    def handle_request(
        self,
        *,
        invocation_id: str,
        request: ContainerAwaitRequest,
    ) -> None:
        if not isinstance(request, CustomContainerRequest):
            raise TypeError(f"Workflow Tool handler cannot handle {type(request).__name__}")

        run_state = self._custom_run(invocation_id)
        payload = WorkflowToolContainerPayload.model_validate_json(request.payload)
        frame_id = f"{invocation_id}:workflow-tool"
        try:
            child_frame = self._create_frame(
                run_state=run_state,
                payload=payload,
                frame_id=frame_id,
            )
        except Exception as error:
            self._root_runtime_state().enqueue_ready_task(
                ResumeTask(
                    invocation_id=invocation_id,
                    result=ContainerExecutionResult(
                        metadata={},
                        steps=0,
                        node_run_result=ContainerNodeRunResult(
                            status=WorkflowNodeExecutionStatus.FAILED,
                            inputs={key: build_container_value(value) for key, value in payload.inputs_for_log.items()},
                            error=str(error),
                            error_type=type(error).__name__,
                        ),
                    ),
                )
            )
            return
        self._root_runtime_state().put_container_frame(
            CustomContainerFrameState(
                frame_id=frame_id,
                parent_invocation_id=invocation_id,
                runtime_data=child_frame.state.snapshot_frame(copy_variable_pool=False),
            )
        )
        child_frame.scheduler.enqueue_node(child_frame.graph.root_node.id)

    def prepare_frame_event(self, *, frame: ExecutionFrame, event: NodeEvent) -> None:
        is_direct_workflow_tool_child = event.node_run_result.process_data.get(_HIDDEN_CHILD_EVENT_KEY) is not True
        if is_direct_workflow_tool_child and isinstance(event, NodeRunFailedEvent):
            # Graphon increments immediately after container preparation; only the outer Tool failure belongs here.
            frame.state.graph_execution.exceptions_count -= 1
        if isinstance(event, NodeRunPauseRequestedEvent) and isinstance(event.reason, HitlRequired):
            event.reason = event.reason.model_copy(update={"node_id": frame.container_id})
        event.node_run_result.process_data = {
            **event.node_run_result.process_data,
            _HIDDEN_CHILD_EVENT_KEY: True,
        }

    def should_emit(self, *, event: NodeEvent) -> bool:
        if self._hidden_event_listener is not None:
            self._hidden_event_listener(event)
        return False

    def record_frame_failure(self, *, frame: ExecutionFrame, event: NodeRunFailedEvent) -> None:
        # ponytail: Graphon custom frames have no metadata slot; scope the pool key to this invocation.
        frame.state.variable_pool.add(
            self._failure_selector(frame.frame_id),
            [event.error, event.node_run_result.error_type],
        )

    def complete_frame_if_ready(self, frame: ExecutionFrame) -> None:
        if not frame.scheduler.is_execution_complete():
            return

        frame_state = self._custom_frame(frame.frame_id)
        run_state = self._custom_run(frame_state.parent_invocation_id)
        payload = WorkflowToolContainerPayload.model_validate_json(run_state.payload)
        parent_frame = self._frame_registry[run_state.frame_id]
        failure_variable = frame.state.variable_pool.get(self._failure_selector(frame.frame_id))
        if failure_variable is None:
            result = self._build_success_result(frame=frame, run_state=run_state)
        else:
            failure = failure_variable.to_object()
            if (
                not isinstance(failure, list)
                or len(failure) != 2
                or not isinstance(failure[0], str)
                or not isinstance(failure[1], str | None)
            ):
                raise ValueError("Invalid Workflow Tool failure state")
            error, error_type = failure
            result = ContainerExecutionResult(
                metadata={},
                steps=frame.state.node_run_steps,
                node_run_result=ContainerNodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={key: build_container_value(value) for key, value in payload.inputs_for_log.items()},
                    error=error,
                    error_type=error_type,
                    llm_usage=frame.state.llm_usage,
                ),
            )

        parent_frame.state.enqueue_ready_task(ResumeTask(invocation_id=run_state.invocation_id, result=result))
        self._root_runtime_state().pop_container_frame(frame.frame_id)
        self._frame_registry.remove(frame.frame_id)

    def _create_frame(
        self,
        *,
        run_state: CustomContainerRunState,
        payload: WorkflowToolContainerPayload,
        frame_id: str,
        runtime_data: FrameRuntimeData | None = None,
        variable_pool: VariablePool | None = None,
    ) -> ExecutionFrame:
        if payload.call_depth > dify_config.WORKFLOW_CALL_MAX_DEPTH:
            raise ValueError(f"Max workflow call depth {dify_config.WORKFLOW_CALL_MAX_DEPTH} reached.")

        parent_frame = self._frame_registry[run_state.frame_id]
        parent_node = parent_frame.graph.nodes[run_state.node_id]
        run_context = resolve_dify_run_context(parent_node.run_context)
        source = self._source_repository.get_source(
            tenant_id=run_context.tenant_id,
            app_id=payload.source_app_id,
            workflow_id=payload.source_workflow_id,
            version=payload.source_workflow_version,
        )
        if source is None:
            raise ValueError("Workflow Tool source was not found")
        graph_config = source.graph_config
        root_node_id = get_default_root_node_id(graph_config)

        if variable_pool is None:
            variable_pool = self._build_variable_pool(
                parent_frame=parent_frame,
                source=source,
                root_node_id=root_node_id,
                payload=payload,
                run_context=run_context,
            )
        state = self._build_runtime_state(
            parent_frame=parent_frame,
            variable_pool=variable_pool,
            runtime_data=runtime_data,
        )
        source_run_context = dict(parent_node.run_context)
        source_run_context[DIFY_RUN_CONTEXT_KEY] = run_context.model_copy(update={"app_id": source.app_id})
        graph_init_context = DifyGraphInitContext(
            workflow_id=source.workflow_id,
            graph_config=graph_config,
            run_context=source_run_context,
            call_depth=payload.call_depth,
        )
        parent_factory = parent_frame.graph.node_factory
        human_input_run_context = (
            parent_factory.human_input_run_context
            if isinstance(parent_factory, DifyNodeFactory)
            else parent_node.run_context
        )
        node_factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=graph_init_context,
            graph_runtime_state=state,
            human_input_run_context=human_input_run_context,
        )
        graph = Graph.init(
            graph_config=graph_config,
            node_factory=node_factory,
            root_node_id=root_node_id,
        )
        return self._frame_registry.create(
            frame_id=frame_id,
            container_id=run_state.node_id,
            graph=graph,
            state=state,
        )

    @staticmethod
    def _build_runtime_state(
        *,
        parent_frame: ExecutionFrame,
        variable_pool: VariablePool,
        runtime_data: FrameRuntimeData | None,
    ) -> RuntimeState:
        state = RuntimeState(
            variable_pool=variable_pool,
            start_at=parent_frame.state.start_at,
            llm_usage=None if runtime_data is None else runtime_data.llm_usage,
            outputs=None if runtime_data is None else dict(runtime_data.outputs),
            node_run_steps=0 if runtime_data is None else runtime_data.node_run_steps,
            ready_queue=parent_frame.state.ready_queue,
            deferred_ready_queue=parent_frame.state.deferred_ready_queue,
            graph_execution=parent_frame.state.graph_execution,
            execution_context=parent_frame.state.execution_context,
        )
        if runtime_data is not None:
            state.restore_graph_state(
                node_states=runtime_data.graph_node_states,
                edge_states=runtime_data.graph_edge_states,
            )
        return state

    def _build_variable_pool(
        self,
        *,
        parent_frame: ExecutionFrame,
        source: WorkflowToolSource,
        root_node_id: str,
        payload: WorkflowToolContainerPayload,
        run_context: DifyRunContext,
    ) -> VariablePool:
        variable_pool = VariablePool()
        for name, value in get_all_system_variables(parent_frame.state.variable_pool).items():
            variable_pool.add(system_variable_selector(name), value)
        add_variables_to_pool(variable_pool, source.environment_variables)

        system_files = file_factory.build_from_mappings(
            mappings=payload.system_files,
            tenant_id=run_context.tenant_id,
            config=FileUploadConfigManager.convert(source.features_dict, is_vision=False),
            strict_type_validation=run_context.invoke_from == InvokeFrom.SERVICE_API,
            access_controller=_file_access_controller,
        )
        variable_pool.add(system_variable_selector(SystemVariableKey.APP_ID), source.app_id)
        variable_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_ID), source.workflow_id)
        variable_pool.add(system_variable_selector(SystemVariableKey.FILES), list(system_files))

        root_config = next(
            (
                node
                for node in source.graph_config.get("nodes", [])
                if isinstance(node, Mapping) and node.get("id") == root_node_id
            ),
            None,
        )
        if not isinstance(root_config, Mapping) or not isinstance(root_config.get("data"), Mapping):
            raise ValueError(f"Workflow Tool root node {root_node_id} is unavailable")
        root_data = StartNodeData.model_validate(root_config["data"])
        inputs = BaseAppGenerator()._prepare_user_inputs(
            user_inputs=payload.inputs,
            variables=root_data.variables,
            tenant_id=run_context.tenant_id,
            strict_type_validation=run_context.invoke_from == InvokeFrom.SERVICE_API,
        )
        variable_pool.remove((root_node_id,))
        add_node_inputs_to_pool(
            variable_pool,
            node_id=root_node_id,
            inputs=inputs,
            aliases=get_compatible_start_aliases(
                workflow_kind=source.workflow_kind,
                root_node_id=root_node_id,
            ),
        )
        return variable_pool

    @staticmethod
    def _build_success_result(
        *,
        frame: ExecutionFrame,
        run_state: CustomContainerRunState,
    ) -> ContainerExecutionResult:
        payload = WorkflowToolContainerPayload.model_validate_json(run_state.payload)
        workflow_outputs = frame.state.outputs
        json_outputs = WorkflowRuntimeTypeConverter().to_json_encodable(workflow_outputs) or {}
        files = WorkflowToolContainerHandler._collect_files(workflow_outputs)
        tool_outputs: dict[str, Any] = {
            key: value for key, value in workflow_outputs.items() if key not in _RESERVED_TOOL_OUTPUTS
        }
        tool_outputs.update(
            {
                "text": json.dumps(json_outputs, ensure_ascii=False),
                "files": files,
                "json": [json_outputs] if json_outputs else [{}],
            }
        )
        return ContainerExecutionResult(
            metadata={},
            steps=frame.state.node_run_steps,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={key: build_container_value(value) for key, value in payload.inputs_for_log.items()},
                outputs={key: build_container_value(value) for key, value in tool_outputs.items()},
                llm_usage=frame.state.llm_usage,
            ),
        )

    @staticmethod
    def _collect_files(values: Mapping[str, object]) -> list[File]:
        files: list[File] = []

        def visit(value: object) -> None:
            if isinstance(value, File):
                files.append(value)
            elif isinstance(value, Mapping):
                for item in value.values():
                    visit(item)
            elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
                for item in value:
                    visit(item)

        visit(values)
        return files

    def _root_runtime_state(self) -> RuntimeState:
        return self._frame_registry[ROOT_FRAME_ID].state

    @staticmethod
    def _failure_selector(frame_id: str) -> tuple[str, str]:
        return (f"{_FAILURE_SELECTOR_PREFIX}:{frame_id}", "failure")

    def _custom_run(self, invocation_id: str) -> CustomContainerRunState:
        run_state = self._root_runtime_state().get_container_run(invocation_id)
        if not isinstance(run_state, CustomContainerRunState):
            raise TypeError(f"Workflow Tool handler cannot use {run_state.kind} run")
        return run_state

    def _custom_frame(self, frame_id: str) -> CustomContainerFrameState:
        frame_state = self._root_runtime_state().get_container_frame(frame_id)
        if not isinstance(frame_state, CustomContainerFrameState):
            raise TypeError(f"Workflow Tool handler cannot use {frame_state.kind} frame")
        return frame_state
