from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendInternalEventType,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamError,
    AgentBackendStreamInternalEvent,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import NodeEventBase, NodeRunResult, StreamCompletedEvent
from graphon.nodes.base.node import Node

from .binding_resolver import WorkflowAgentBindingError, WorkflowAgentBindingResolver
from .entities import DifyAgentNodeData
from .output_adapter import WorkflowAgentOutputAdapter
from .runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
)

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState


class DifyAgentNode(Node[DifyAgentNodeData]):
    node_type = BuiltinNodeTypes.AGENT

    def __init__(
        self,
        node_id: str,
        data: DifyAgentNodeData,
        *,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        binding_resolver: WorkflowAgentBindingResolver,
        runtime_request_builder: WorkflowAgentRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        output_adapter: WorkflowAgentOutputAdapter,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._binding_resolver = binding_resolver
        self._runtime_request_builder = runtime_request_builder
        self._agent_backend_client = agent_backend_client
        self._event_adapter = event_adapter
        self._output_adapter = output_adapter

    @classmethod
    def version(cls) -> str:
        return "2"

    def populate_start_event(self, event) -> None:
        event.extras["agent_node"] = {"version": "2", "agent_node_kind": self.node_data.agent_node_kind}

    def _run(self) -> Generator[NodeEventBase, None, None]:
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        workflow_id = self.graph_init_params.workflow_id
        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        inputs: dict[str, Any] = {}
        process_data: dict[str, Any] = {}
        metadata: dict[str, Any] = {
            "agent_backend": {
                "status": "not_started",
            }
        }

        try:
            bundle = self._binding_resolver.resolve(
                tenant_id=dify_ctx.tenant_id,
                app_id=dify_ctx.app_id,
                workflow_id=workflow_id,
                node_id=self._node_id,
            )
            runtime_request = self._runtime_request_builder.build(
                WorkflowAgentRuntimeBuildContext(
                    dify_context=dify_ctx,
                    workflow_id=workflow_id,
                    workflow_run_id=workflow_run_id,
                    node_id=self._node_id,
                    node_execution_id=self.id,
                    variable_pool=self.graph_runtime_state.variable_pool,
                    binding=bundle.binding,
                    agent=bundle.agent,
                    snapshot=bundle.snapshot,
                )
            )
            inputs = {"agent_backend_request": runtime_request.redacted_request}
            metadata = dict(runtime_request.metadata)
            process_data = {
                "agent_id": bundle.agent.id,
                "agent_config_snapshot_id": bundle.snapshot.id,
                "binding_id": bundle.binding.id,
            }
            create_response = self._agent_backend_client.create_run(runtime_request.request)
            metadata["agent_backend"] = {
                **dict(metadata.get("agent_backend") or {}),
                "run_id": create_response.run_id,
                "status": create_response.status,
            }
        except WorkflowAgentBindingError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=error.error_code,
            )
            return
        except WorkflowAgentRuntimeRequestBuildError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=error.error_code,
            )
            return
        except AgentBackendError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=self._agent_backend_error_type(error),
            )
            return
        except Exception as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_workflow_node_runtime_error",
            )
            return

        stream_event_count = 0
        try:
            for public_event in self._agent_backend_client.stream_events(create_response.run_id):
                stream_event_count += 1
                for internal_event in self._event_adapter.adapt(public_event):
                    if internal_event.type == AgentBackendInternalEventType.RUN_STARTED:
                        continue
                    if internal_event.type == AgentBackendInternalEventType.STREAM_EVENT:
                        if isinstance(internal_event, AgentBackendStreamInternalEvent):
                            self._record_stream_metadata(metadata, internal_event)
                        continue
                    metadata["agent_backend"] = {
                        **dict(metadata.get("agent_backend") or {}),
                        "stream_event_count": stream_event_count,
                    }
                    if isinstance(internal_event, AgentBackendRunSucceededInternalEvent):
                        yield StreamCompletedEvent(
                            node_run_result=self._output_adapter.build_success_result(
                                event=internal_event,
                                inputs=inputs,
                                process_data=process_data,
                                metadata=metadata,
                            )
                        )
                        return
                    if isinstance(
                        internal_event,
                        AgentBackendRunFailedInternalEvent,
                    ) or internal_event.type in {
                        AgentBackendInternalEventType.RUN_CANCELLED,
                        AgentBackendInternalEventType.RUN_PAUSED,
                    }:
                        yield StreamCompletedEvent(
                            node_run_result=self._output_adapter.build_failure_result(
                                event=internal_event,
                                inputs=inputs,
                                process_data=process_data,
                                metadata=metadata,
                            )
                        )
                        return
        except AgentBackendError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=self._agent_backend_error_type(error),
            )
            return
        except Exception as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_backend_stream_error",
            )
            return

        yield StreamCompletedEvent(
            node_run_result=self._output_adapter.build_stream_exhausted_result(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
            )
        )

    @staticmethod
    def _failure_event(
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        error: str,
        error_type: str,
    ) -> StreamCompletedEvent:
        return StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                metadata={WorkflowNodeExecutionMetadataKey.AGENT_LOG: metadata},
                outputs={},
                error=error,
                error_type=error_type,
            )
        )

    @staticmethod
    def _agent_backend_error_type(error: AgentBackendError) -> str:
        if isinstance(error, AgentBackendValidationError):
            return "agent_backend_validation_error"
        if isinstance(error, AgentBackendHTTPError):
            return "agent_backend_http_error"
        if isinstance(error, AgentBackendStreamError):
            return "agent_backend_stream_error"
        if isinstance(error, AgentBackendTransportError):
            return "agent_backend_transport_error"
        return "agent_backend_error"

    @staticmethod
    def _record_stream_metadata(metadata: dict[str, Any], event: AgentBackendStreamInternalEvent) -> None:
        agent_backend = dict(metadata.get("agent_backend") or {})
        agent_backend["last_stream_event_id"] = event.source_event_id
        if event.event_kind:
            agent_backend["last_stream_event_kind"] = event.event_kind
        if isinstance(event.data, Mapping):
            usage = event.data.get("usage") or event.data.get("model_usage")
            if isinstance(usage, Mapping):
                agent_backend["usage"] = dict(usage)
        metadata["agent_backend"] = agent_backend

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DifyAgentNodeData,
    ) -> Mapping[str, Sequence[str]]:
        del graph_config, node_id, node_data
        return {}
