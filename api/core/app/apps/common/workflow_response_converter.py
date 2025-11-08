import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, NewType, Union

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.app.entities.task_entities import (
    AgentLogStreamResponse,
    IterationNodeCompletedStreamResponse,
    IterationNodeNextStreamResponse,
    IterationNodeStartStreamResponse,
    LoopNodeCompletedStreamResponse,
    LoopNodeNextStreamResponse,
    LoopNodeStartStreamResponse,
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from core.file import FILE_MODEL_IDENTITY, File
from core.plugin.impl.datasource import PluginDatasourceManager
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from core.variables.segments import ArrayFileSegment, FileSegment, Segment
from core.workflow.enums import (
    NodeType,
    SystemVariableKey,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.runtime import GraphRuntimeState
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser
from services.variable_truncator import BaseTruncator, DummyVariableTruncator, VariableTruncator

NodeExecutionId = NewType("NodeExecutionId", str)


@dataclass(slots=True)
class _NodeSnapshot:
    """In-memory cache for node metadata between start and completion events."""

    title: str
    index: int
    start_at: datetime
    iteration_id: str = ""
    """Empty string means the node is not executing inside an iteration."""
    loop_id: str = ""
    """Empty string means the node is not executing inside a loop."""


class WorkflowResponseConverter:
    _truncator: BaseTruncator

    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        user: Union[Account, EndUser],
        system_variables: SystemVariable,
    ):
        self._application_generate_entity = application_generate_entity
        self._user = user
        self._system_variables = system_variables
        self._workflow_inputs = self._prepare_workflow_inputs()

        # Disable truncation for SERVICE_API calls to keep backward compatibility.
        if application_generate_entity.invoke_from == InvokeFrom.SERVICE_API:
            self._truncator = DummyVariableTruncator()
        else:
            self._truncator = VariableTruncator.default()

        self._node_snapshots: dict[NodeExecutionId, _NodeSnapshot] = {}
        self._workflow_execution_id: str | None = None
        self._workflow_started_at: datetime | None = None

    # ------------------------------------------------------------------
    # Workflow lifecycle helpers
    # ------------------------------------------------------------------
    def _prepare_workflow_inputs(self) -> Mapping[str, Any]:
        inputs = dict(self._application_generate_entity.inputs)
        for field_name, value in self._system_variables.to_dict().items():
            # TODO(@future-refactor): store system variables separately from user inputs so we don't
            # need to flatten `sys.*` entries into the input payload just for rerun/export tooling.
            if field_name == SystemVariableKey.CONVERSATION_ID:
                # Conversation IDs are session-scoped; omitting them keeps workflow inputs
                # reusable without pinning new runs to a prior conversation.
                continue
            inputs[f"sys.{field_name}"] = value
        handled = WorkflowEntry.handle_special_values(inputs)
        return dict(handled or {})

    def _ensure_workflow_run_id(self, workflow_run_id: str | None = None) -> str:
        """Return the memoized workflow run id, optionally seeding it during start events."""
        if workflow_run_id is not None:
            self._workflow_execution_id = workflow_run_id
        if not self._workflow_execution_id:
            raise ValueError("workflow_run_id missing before streaming workflow events")
        return self._workflow_execution_id

    # ------------------------------------------------------------------
    # Node snapshot helpers
    # ------------------------------------------------------------------
    def _store_snapshot(self, event: QueueNodeStartedEvent) -> _NodeSnapshot:
        snapshot = _NodeSnapshot(
            title=event.node_title,
            index=event.node_run_index,
            start_at=event.start_at,
            iteration_id=event.in_iteration_id or "",
            loop_id=event.in_loop_id or "",
        )
        node_execution_id = NodeExecutionId(event.node_execution_id)
        self._node_snapshots[node_execution_id] = snapshot
        return snapshot

    def _get_snapshot(self, node_execution_id: str) -> _NodeSnapshot | None:
        return self._node_snapshots.get(NodeExecutionId(node_execution_id))

    def _pop_snapshot(self, node_execution_id: str) -> _NodeSnapshot | None:
        return self._node_snapshots.pop(NodeExecutionId(node_execution_id), None)

    @staticmethod
    def _merge_metadata(
        base_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None,
        snapshot: _NodeSnapshot | None,
    ) -> Mapping[WorkflowNodeExecutionMetadataKey, Any] | None:
        if not base_metadata and not snapshot:
            return base_metadata

        merged: dict[WorkflowNodeExecutionMetadataKey, Any] = {}
        if base_metadata:
            merged.update(base_metadata)

        if snapshot:
            if snapshot.iteration_id:
                merged[WorkflowNodeExecutionMetadataKey.ITERATION_ID] = snapshot.iteration_id
            if snapshot.loop_id:
                merged[WorkflowNodeExecutionMetadataKey.LOOP_ID] = snapshot.loop_id

        return merged or None

    def _truncate_mapping(
        self,
        mapping: Mapping[str, Any] | None,
    ) -> tuple[Mapping[str, Any] | None, bool]:
        if mapping is None:
            return None, False
        if not mapping:
            return {}, False

        normalized = WorkflowEntry.handle_special_values(dict(mapping))
        if normalized is None:
            return None, False

        truncated, is_truncated = self._truncator.truncate_variable_mapping(dict(normalized))
        return truncated, is_truncated

    @staticmethod
    def _encode_outputs(outputs: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
        if outputs is None:
            return None
        converter = WorkflowRuntimeTypeConverter()
        return converter.to_json_encodable(outputs)

    def workflow_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_run_id: str,
        workflow_id: str,
    ) -> WorkflowStartStreamResponse:
        run_id = self._ensure_workflow_run_id(workflow_run_id)
        started_at = naive_utc_now()
        self._workflow_started_at = started_at

        return WorkflowStartStreamResponse(
            task_id=task_id,
            workflow_run_id=run_id,
            data=WorkflowStartStreamResponse.Data(
                id=run_id,
                workflow_id=workflow_id,
                inputs=self._workflow_inputs,
                created_at=int(started_at.timestamp()),
            ),
        )

    def workflow_finish_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_id: str,
        status: WorkflowExecutionStatus,
        graph_runtime_state: GraphRuntimeState,
        error: str | None = None,
        exceptions_count: int = 0,
    ) -> WorkflowFinishStreamResponse:
        run_id = self._ensure_workflow_run_id()
        started_at = self._workflow_started_at
        if started_at is None:
            raise ValueError(
                "workflow_finish_to_stream_response called before workflow_start_to_stream_response",
            )

        finished_at = naive_utc_now()
        elapsed_time = (finished_at - started_at).total_seconds()

        outputs_mapping = graph_runtime_state.outputs or {}
        encoded_outputs = WorkflowRuntimeTypeConverter().to_json_encodable(outputs_mapping)

        created_by: Mapping[str, object] | None
        user = self._user
        if isinstance(user, Account):
            created_by = {
                "id": user.id,
                "name": user.name,
                "email": user.email,
            }
        else:
            created_by = {
                "id": user.id,
                "user": user.session_id,
            }

        return WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=run_id,
            data=WorkflowFinishStreamResponse.Data(
                id=run_id,
                workflow_id=workflow_id,
                status=status.value,
                outputs=encoded_outputs,
                error=error,
                elapsed_time=elapsed_time,
                total_tokens=graph_runtime_state.total_tokens,
                total_steps=graph_runtime_state.node_run_steps,
                created_by=created_by,
                created_at=int(started_at.timestamp()),
                finished_at=int(finished_at.timestamp()),
                files=self.fetch_files_from_node_outputs(outputs_mapping),
                exceptions_count=exceptions_count,
            ),
        )

    def workflow_node_start_to_stream_response(
        self,
        *,
        event: QueueNodeStartedEvent,
        task_id: str,
    ) -> NodeStartStreamResponse | None:
        if event.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        run_id = self._ensure_workflow_run_id()
        snapshot = self._store_snapshot(event)

        response = NodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=run_id,
            data=NodeStartStreamResponse.Data(
                id=event.node_execution_id,
                node_id=event.node_id,
                node_type=event.node_type,
                title=snapshot.title,
                index=snapshot.index,
                created_at=int(snapshot.start_at.timestamp()),
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                agent_strategy=event.agent_strategy,
            ),
        )

        if event.node_type == NodeType.TOOL:
            response.data.extras["icon"] = ToolManager.get_tool_icon(
                tenant_id=self._application_generate_entity.app_config.tenant_id,
                provider_type=ToolProviderType(event.provider_type),
                provider_id=event.provider_id,
            )
        elif event.node_type == NodeType.DATASOURCE:
            manager = PluginDatasourceManager()
            provider_entity = manager.fetch_datasource_provider(
                self._application_generate_entity.app_config.tenant_id,
                event.provider_id,
            )
            response.data.extras["icon"] = provider_entity.declaration.identity.generate_datasource_icon_url(
                self._application_generate_entity.app_config.tenant_id
            )

        return response

    def workflow_node_finish_to_stream_response(
        self,
        *,
        event: QueueNodeSucceededEvent | QueueNodeFailedEvent | QueueNodeExceptionEvent,
        task_id: str,
    ) -> NodeFinishStreamResponse | None:
        if event.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        run_id = self._ensure_workflow_run_id()
        snapshot = self._pop_snapshot(event.node_execution_id)

        start_at = snapshot.start_at if snapshot else event.start_at
        finished_at = naive_utc_now()
        elapsed_time = (finished_at - start_at).total_seconds()

        inputs, inputs_truncated = self._truncate_mapping(event.inputs)
        process_data, process_data_truncated = self._truncate_mapping(event.process_data)
        encoded_outputs = self._encode_outputs(event.outputs)
        outputs, outputs_truncated = self._truncate_mapping(encoded_outputs)
        metadata = self._merge_metadata(event.execution_metadata, snapshot)

        if isinstance(event, QueueNodeSucceededEvent):
            status = WorkflowNodeExecutionStatus.SUCCEEDED.value
            error_message = event.error
        elif isinstance(event, QueueNodeFailedEvent):
            status = WorkflowNodeExecutionStatus.FAILED.value
            error_message = event.error
        else:
            status = WorkflowNodeExecutionStatus.EXCEPTION.value
            error_message = event.error

        return NodeFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=run_id,
            data=NodeFinishStreamResponse.Data(
                id=event.node_execution_id,
                node_id=event.node_id,
                node_type=event.node_type,
                index=snapshot.index if snapshot else 0,
                title=snapshot.title if snapshot else "",
                inputs=inputs,
                inputs_truncated=inputs_truncated,
                process_data=process_data,
                process_data_truncated=process_data_truncated,
                outputs=outputs,
                outputs_truncated=outputs_truncated,
                status=status,
                error=error_message,
                elapsed_time=elapsed_time,
                execution_metadata=metadata,
                created_at=int(start_at.timestamp()),
                finished_at=int(finished_at.timestamp()),
                files=self.fetch_files_from_node_outputs(event.outputs or {}),
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
            ),
        )

    def workflow_node_retry_to_stream_response(
        self,
        *,
        event: QueueNodeRetryEvent,
        task_id: str,
    ) -> NodeRetryStreamResponse | None:
        if event.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        run_id = self._ensure_workflow_run_id()

        snapshot = self._get_snapshot(event.node_execution_id)
        if snapshot is None:
            raise AssertionError("node retry event arrived without a stored snapshot")
        finished_at = naive_utc_now()
        elapsed_time = (finished_at - event.start_at).total_seconds()

        inputs, inputs_truncated = self._truncate_mapping(event.inputs)
        process_data, process_data_truncated = self._truncate_mapping(event.process_data)
        encoded_outputs = self._encode_outputs(event.outputs)
        outputs, outputs_truncated = self._truncate_mapping(encoded_outputs)
        metadata = self._merge_metadata(event.execution_metadata, snapshot)

        return NodeRetryStreamResponse(
            task_id=task_id,
            workflow_run_id=run_id,
            data=NodeRetryStreamResponse.Data(
                id=event.node_execution_id,
                node_id=event.node_id,
                node_type=event.node_type,
                index=snapshot.index,
                title=snapshot.title,
                inputs=inputs,
                inputs_truncated=inputs_truncated,
                process_data=process_data,
                process_data_truncated=process_data_truncated,
                outputs=outputs,
                outputs_truncated=outputs_truncated,
                status=WorkflowNodeExecutionStatus.RETRY.value,
                error=event.error,
                elapsed_time=elapsed_time,
                execution_metadata=metadata,
                created_at=int(snapshot.start_at.timestamp()),
                finished_at=int(finished_at.timestamp()),
                files=self.fetch_files_from_node_outputs(event.outputs or {}),
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                retry_index=event.retry_index,
            ),
        )

    def workflow_iteration_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationStartEvent,
    ) -> IterationNodeStartStreamResponse:
        new_inputs, truncated = self._truncator.truncate_variable_mapping(event.inputs or {})
        return IterationNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeStartStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                created_at=int(time.time()),
                extras={},
                inputs=new_inputs,
                inputs_truncated=truncated,
                metadata=event.metadata or {},
            ),
        )

    def workflow_iteration_next_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationNextEvent,
    ) -> IterationNodeNextStreamResponse:
        return IterationNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeNextStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                index=event.index,
                created_at=int(time.time()),
                extras={},
            ),
        )

    def workflow_iteration_completed_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationCompletedEvent,
    ) -> IterationNodeCompletedStreamResponse:
        json_converter = WorkflowRuntimeTypeConverter()

        new_inputs, inputs_truncated = self._truncator.truncate_variable_mapping(event.inputs or {})
        new_outputs, outputs_truncated = self._truncator.truncate_variable_mapping(
            json_converter.to_json_encodable(event.outputs) or {}
        )
        return IterationNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeCompletedStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                outputs=new_outputs,
                outputs_truncated=outputs_truncated,
                created_at=int(time.time()),
                extras={},
                inputs=new_inputs,
                inputs_truncated=inputs_truncated,
                status=WorkflowNodeExecutionStatus.SUCCEEDED
                if event.error is None
                else WorkflowNodeExecutionStatus.FAILED,
                error=None,
                elapsed_time=(naive_utc_now() - event.start_at).total_seconds(),
                total_tokens=(lambda x: x if isinstance(x, int) else 0)(event.metadata.get("total_tokens", 0)),
                execution_metadata=event.metadata,
                finished_at=int(time.time()),
                steps=event.steps,
            ),
        )

    def workflow_loop_start_to_stream_response(
        self, *, task_id: str, workflow_execution_id: str, event: QueueLoopStartEvent
    ) -> LoopNodeStartStreamResponse:
        new_inputs, truncated = self._truncator.truncate_variable_mapping(event.inputs or {})
        return LoopNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeStartStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                created_at=int(time.time()),
                extras={},
                inputs=new_inputs,
                inputs_truncated=truncated,
                metadata=event.metadata or {},
            ),
        )

    def workflow_loop_next_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueLoopNextEvent,
    ) -> LoopNodeNextStreamResponse:
        return LoopNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeNextStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                index=event.index,
                # The `pre_loop_output` field is not utilized by the frontend.
                # Previously, it was assigned the value of `event.output`.
                pre_loop_output={},
                created_at=int(time.time()),
                extras={},
            ),
        )

    def workflow_loop_completed_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueLoopCompletedEvent,
    ) -> LoopNodeCompletedStreamResponse:
        json_converter = WorkflowRuntimeTypeConverter()
        new_inputs, inputs_truncated = self._truncator.truncate_variable_mapping(event.inputs or {})
        new_outputs, outputs_truncated = self._truncator.truncate_variable_mapping(
            json_converter.to_json_encodable(event.outputs) or {}
        )
        return LoopNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeCompletedStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_title,
                outputs=new_outputs,
                outputs_truncated=outputs_truncated,
                created_at=int(time.time()),
                extras={},
                inputs=new_inputs,
                inputs_truncated=inputs_truncated,
                status=WorkflowNodeExecutionStatus.SUCCEEDED
                if event.error is None
                else WorkflowNodeExecutionStatus.FAILED,
                error=None,
                elapsed_time=(naive_utc_now() - event.start_at).total_seconds(),
                total_tokens=(lambda x: x if isinstance(x, int) else 0)(event.metadata.get("total_tokens", 0)),
                execution_metadata=event.metadata,
                finished_at=int(time.time()),
                steps=event.steps,
            ),
        )

    def fetch_files_from_node_outputs(self, outputs_dict: Mapping[str, Any] | None) -> Sequence[Mapping[str, Any]]:
        """
        Fetch files from node outputs
        :param outputs_dict: node outputs dict
        :return:
        """
        if not outputs_dict:
            return []

        files = [self._fetch_files_from_variable_value(output_value) for output_value in outputs_dict.values()]
        # Remove None
        files = [file for file in files if file]
        # Flatten list
        # Flatten the list of sequences into a single list of mappings
        flattened_files = [file for sublist in files if sublist for file in sublist]

        # Convert to tuple to match Sequence type
        return tuple(flattened_files)

    @classmethod
    def _fetch_files_from_variable_value(cls, value: Union[dict, list, Segment]) -> Sequence[Mapping[str, Any]]:
        """
        Fetch files from variable value
        :param value: variable value
        :return:
        """
        if not value:
            return []

        files: list[Mapping[str, Any]] = []
        if isinstance(value, FileSegment):
            files.append(value.value.to_dict())
        elif isinstance(value, ArrayFileSegment):
            files.extend([i.to_dict() for i in value.value])
        elif isinstance(value, File):
            files.append(value.to_dict())
        elif isinstance(value, list):
            for item in value:
                file = cls._get_file_var_from_value(item)
                if file:
                    files.append(file)
        elif isinstance(
            value,
            dict,
        ):
            file = cls._get_file_var_from_value(value)
            if file:
                files.append(file)

        return files

    @classmethod
    def _get_file_var_from_value(cls, value: Union[dict, list]) -> Mapping[str, Any] | None:
        """
        Get file var from value
        :param value: variable value
        :return:
        """
        if not value:
            return None

        if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
            return value
        elif isinstance(value, File):
            return value.to_dict()

        return None

    def handle_agent_log(self, task_id: str, event: QueueAgentLogEvent) -> AgentLogStreamResponse:
        """
        Handle agent log
        :param task_id: task id
        :param event: agent log event
        :return:
        """
        return AgentLogStreamResponse(
            task_id=task_id,
            data=AgentLogStreamResponse.Data(
                node_execution_id=event.node_execution_id,
                id=event.id,
                parent_id=event.parent_id,
                label=event.label,
                error=event.error,
                status=event.status,
                data=event.data,
                metadata=event.metadata,
                node_id=event.node_id,
            ),
        )
