from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from typing import TYPE_CHECKING, cast, override

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.execution_coordinator import app_task_command_channel_key
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    StopFlagCommandChannel,
)
from core.app.apps.workflow.stop_aware_ready_queue import attach_stop_aware_ready_queue
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
    get_credit_usage_app_type,
)
from core.workflow.snippet_start import get_compatible_start_aliases
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from extensions.ext_redis import redis_client
from extensions.workflow_warm_shutdown import WORKFLOW_WARM_SHUTDOWN_ABORT_REASON, celery_warm_shutdown_started
from graphon.engine.command import RedisChannel
from graphon.engine.filter import ResponseStreamFilter
from graphon.engine.layer import Layer
from graphon.enums import WorkflowType
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import VariableLoader
from libs.datetime_utils import naive_utc_now
from models.workflow import Workflow
from runtime_contracts.builder.execution import (
    BuilderExecutionContext,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    ConfirmedToolExecutionContext,
    JsonToolExecutionContext,
    scalar_inputs_digest,
)
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge
from services.workflow_runtime.base_runner import PreparedWorkflowRun, WorkflowBasedAppRunner, WorkflowRunDriver
from services.workflow_runtime.entry import WorkflowEntry
from services.workflow_runtime.node_factory import get_default_root_node_id

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

logger = logging.getLogger(__name__)


class WorkflowAppRunner(WorkflowBasedAppRunner):
    """
    Workflow Application Runner
    """

    def __init__(
        self,
        *,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
        root_node_id: str | None = None,
        execution_driver: WorkflowRunDriver | None = None,
        graph_engine_layers: Sequence[Layer] = (),
        graph_runtime_state: RuntimeState | None = None,
        response_stream_filter: ResponseStreamFilter | None = None,
        execution_recorder: BuilderExecutionRecorder | None = None,
        native_runtime: NativeRuntimeBridge | None = None,
        native_host: NativeHostLaunch | None = None,
    ):
        from services.dify_builder.native_testing.generation_wiring import validate_native_host

        validate_native_host(
            required=application_generate_entity.native_test_required
            or application_generate_entity.native_test_ref is not None,
            ref=application_generate_entity.native_test_ref,
            runtime=native_runtime,
            host=native_host,
        )
        if native_host is not None and (graph_engine_layers or application_generate_entity.trace_manager is not None):
            raise NativeContextUnavailable("native_observation_unqualified")
        self._native_host = native_host
        super().__init__(
            queue_manager=queue_manager,
            execution_driver=execution_driver,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
            graph_engine_layers=graph_engine_layers,
        )
        self._execution_recorder = execution_recorder
        self._native_runtime = native_runtime
        self.application_generate_entity = application_generate_entity
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._root_node_id = root_node_id
        self._resume_graph_runtime_state = graph_runtime_state
        self._response_stream_filter = response_stream_filter

    @override
    def prepare(self) -> PreparedWorkflowRun | None:
        """Prepare graph execution and passive application observers."""
        app_config = self.application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)
        entity = self.application_generate_entity
        native_prepared = None
        if entity.native_test_required or entity.native_test_ref is not None:
            if entity.native_test_ref is None:
                raise NativeContextUnavailable("native_context_missing")
            if self._native_runtime is None:
                raise NativeContextUnavailable("native_runtime_unavailable")
            resolved = self._native_runtime.resolve(entity.native_test_ref)
            if (
                entity.builder_execution is not None
                or entity.single_iteration_run
                or entity.single_loop_run
                or (
                    app_config.tenant_id,
                    app_config.app_id,
                    app_config.workflow_id,
                    entity.user_id,
                    entity.workflow_execution_id,
                    entity.call_depth,
                    self._workflow.graph_dict,
                )
                != (
                    resolved.tenant_id,
                    resolved.app_id,
                    resolved.workflow_id,
                    resolved.actor_id,
                    resolved.native_run_id,
                    resolved.call_depth,
                    resolved.graph,
                )
            ):
                raise NativeContextUnavailable("native_context_mismatch")
            if self._native_host is None or self._native_host.generation_bindings.entity is not entity:
                raise NativeContextUnavailable("native_host_identity_mismatch")
            if self._resume_graph_runtime_state is not None:
                self._native_host.require_resume_bindings(
                    entity=entity,
                    runtime_state=self._resume_graph_runtime_state,
                    response_filter=self._response_stream_filter,
                )
            native_prepared = self._native_runtime.prepare_inputs(resolved)
            if self._resume_graph_runtime_state is None:
                entity.inputs = native_prepared.inputs
                entity.files = list(native_prepared.files)
        context = entity.builder_execution

        if context is not None:
            # Both Builder variants share the owner/input/transport checks below; the
            # factory then admits each variant's exact node set and collaborators.
            if not isinstance(
                context, (BuilderExecutionContext, ConfirmedToolExecutionContext, JsonToolExecutionContext)
            ):
                raise BuilderExecutionPolicyError("unsupported_execution_policy")
            if self._execution_recorder is None or not self._execution_recorder.healthy:
                raise BuilderExecutionPolicyError("missing_execution_recorder")
            if (
                entity.files
                or entity.single_iteration_run
                or entity.single_loop_run
                or self._resume_graph_runtime_state is not None
                or entity.call_depth != 0
                or self._workflow.kind_or_standard != "standard"
                or entity.invoke_from != InvokeFrom.DEBUGGER
                or (
                    app_config.app_id,
                    app_config.tenant_id,
                    app_config.workflow_id,
                    entity.user_id,
                    self._workflow.app_id,
                    self._workflow.tenant_id,
                    self._workflow.id,
                )
                != (
                    context.app_id,
                    context.tenant_id,
                    context.workflow_id,
                    context.actor_id,
                    context.app_id,
                    context.tenant_id,
                    context.workflow_id,
                )
                or scalar_inputs_digest(dict(entity.inputs)) != context.effective_inputs_digest
            ):
                raise BuilderExecutionPolicyError("execution_owner_mismatch")
            root = self._root_node_id or get_default_root_node_id(self._workflow.graph_dict)
            if self._workflow.get_node_type_from_node_config(self._workflow.get_node_config_by_id(root)) != "start":
                raise BuilderExecutionPolicyError("unsupported_execution_root")
        invoke_from = self.application_generate_entity.invoke_from
        # if only single iteration or single loop run is requested
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            invoke_from = InvokeFrom.DEBUGGER
        user_from = self._resolve_user_from(invoke_from)

        resume_state = self._resume_graph_runtime_state

        if resume_state is not None:
            graph_runtime_state = resume_state
            variable_pool = graph_runtime_state.variable_pool
            graph = self._init_graph(
                builder_execution=entity.builder_execution,
                builder_agent_execution=entity.builder_agent_execution,
                native_test_required=entity.native_test_required,
                native_test_ref=entity.native_test_ref,
                native_runtime=self._native_runtime,
                builder_mocked_node_ids=entity.builder_mocked_node_ids,
                builder_tool_credential_bindings=entity.builder_tool_credential_bindings,
                execution_recorder=self._execution_recorder,
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=self._root_node_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
                call_depth=self.application_generate_entity.call_depth,
            )
        elif self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
                user_id=self.application_generate_entity.user_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )
        else:
            inputs = self.application_generate_entity.inputs

            # Create a variable pool.
            system_inputs = build_system_variables(
                files=self.application_generate_entity.files,
                user_id=self._sys_user_id,
                app_id=app_config.app_id,
                timestamp=int(naive_utc_now().timestamp()),
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_execution_id,
            )
            variable_pool = VariablePool()
            add_variables_to_pool(
                variable_pool,
                build_bootstrap_variables(
                    system_variables=system_inputs,
                    environment_variables=(
                        native_prepared.environment_variables
                        if native_prepared is not None
                        else self._workflow.environment_variables
                    ),
                ),
            )
            root_node_id = self._root_node_id or get_default_root_node_id(self._workflow.graph_dict)
            add_node_inputs_to_pool(
                variable_pool,
                node_id=root_node_id,
                inputs=inputs,
                aliases=get_compatible_start_aliases(
                    workflow_kind=getattr(self._workflow, "kind_or_standard", None),
                    root_node_id=root_node_id,
                ),
            )

            if self._native_host is not None:
                from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState

                # The actual worker entered the exact host's bounded context.
                guard = self._native_host.native_observation
                from services.dify_builder.native_testing.context_runtime import current_native_observation

                if current_native_observation() is not guard:
                    guard.fail()
                graph_runtime_state = NativeGraphRuntimeState(
                    workflow_id=self._workflow.id, variable_pool=variable_pool, start_at=time.perf_counter()
                )
            else:
                graph_runtime_state = RuntimeState(
                    workflow_id=self._workflow.id, variable_pool=variable_pool, start_at=time.perf_counter()
                )
            graph = self._init_graph(
                builder_execution=entity.builder_execution,
                builder_agent_execution=entity.builder_agent_execution,
                native_test_required=entity.native_test_required,
                native_test_ref=entity.native_test_ref,
                native_runtime=self._native_runtime,
                builder_mocked_node_ids=entity.builder_mocked_node_ids,
                builder_tool_credential_bindings=entity.builder_tool_credential_bindings,
                execution_recorder=self._execution_recorder,
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=root_node_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
                call_depth=self.application_generate_entity.call_depth,
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = app_task_command_channel_key(task_id)
        celery_signal_channel = CelerySignalCommandChannel(
            shutdown_state_getter=celery_warm_shutdown_started,
            abort_reason=WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
        )
        attach_stop_aware_ready_queue(graph_runtime_state, task_id=task_id)
        command_channel = CombinedCommandChannel(
            (
                RedisChannel(redis_client, channel_key),
                StopFlagCommandChannel(task_id=task_id),
                celery_signal_channel,
            )
        )

        if self._native_host is not None:
            command_channel = self._native_host.wrap_commands(channel=command_channel)

        self._queue_manager.graph_runtime_state = graph_runtime_state

        workflow_entry = WorkflowEntry(
            graph=graph,
            graph_config=self._workflow.graph_dict,
            call_depth=self.application_generate_entity.call_depth,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            response_stream_filter=self._response_stream_filter,
            native_host=self._native_host,
        )

        if self._native_host is not None:
            assert self._response_stream_filter is not None
            self._native_host.bind_engine(
                entry=workflow_entry,
                runtime_state=graph_runtime_state,
                response_filter=self._response_stream_filter,
                commands=command_channel,
            )

        return PreparedWorkflowRun(
            entry=workflow_entry,
            application_layers=self._graph_engine_layers,
            generate_entity=self.application_generate_entity,
            workflow_type=WorkflowType(self._workflow.type),
            workflow_version=self._workflow.version,
            native_host=self._native_host,
        )
