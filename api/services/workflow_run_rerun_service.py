from __future__ import annotations

import copy
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

import contexts
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories import DifyCoreRepositoryFactory
from dify_graph.entities.workflow_execution import WorkflowRunRerunMetadata, WorkflowRunRerunScope
from dify_graph.enums import WorkflowExecutionStatus, WorkflowType
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models import Account, App, EndUser, WorkflowNodeExecutionTriggeredFrom, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import Workflow, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)


class WorkflowRunRerunServiceError(ValueError):
    def __init__(self, *, code: str, status: int, message: str):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


class WorkflowRunRerunOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selector: list[str] = Field(min_length=2)
    value: Any


@dataclass(slots=True)
class _WorkflowRunRerunPlan:
    app_model: App
    workflow: Workflow
    source_run: WorkflowRun
    workflow_run_id: str
    task_id: str
    target_node_id: str
    user_inputs: dict[str, Any]
    execution_graph_config: dict[str, Any]
    scope: WorkflowRunRerunScope
    normalized_overrides: list[dict[str, Any]]
    graph_runtime_state: GraphRuntimeState
    rerun_metadata: WorkflowRunRerunMetadata


class WorkflowRunRerunService:
    _ENDED_STATUSES = {
        WorkflowExecutionStatus.SUCCEEDED.value,
        WorkflowExecutionStatus.FAILED.value,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
        WorkflowExecutionStatus.STOPPED.value,
    }

    _FAILED_STATUSES = {
        WorkflowExecutionStatus.FAILED.value,
        WorkflowExecutionStatus.STOPPED.value,
    }

    _EMPTY_ERROR_STATUSES = {
        WorkflowExecutionStatus.SUCCEEDED.value,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
        WorkflowExecutionStatus.PAUSED.value,
    }

    _BLOCKING_ALLOWED_STATUSES = {
        WorkflowExecutionStatus.SUCCEEDED.value,
        WorkflowExecutionStatus.FAILED.value,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
        WorkflowExecutionStatus.STOPPED.value,
        WorkflowExecutionStatus.PAUSED.value,
    }

    def __init__(self, session_factory: Engine | sessionmaker | None = None):
        if session_factory is None:
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        elif isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)

        self._session_factory = session_factory
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            session_maker=session_factory
        )
        self._sql_workflow_run_repo = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=session_factory)
        self._node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=session_factory
        )

    def execute_rerun(
        self,
        *,
        app_model: App,
        user: Account | EndUser,
        source_run_id: str,
        target_node_id: str,
        overrides: Sequence[WorkflowRunRerunOverride],
        streaming: bool,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
        plan = self._build_plan_or_raise(
            app_model=app_model,
            source_run_id=source_run_id,
            target_node_id=target_node_id,
            overrides=overrides,
        )

        if streaming:
            return self._execute_streaming_with_plan(plan=plan, user=user)
        return self._execute_blocking_with_plan(plan=plan, user=user)

    def _build_plan_or_raise(
        self,
        *,
        app_model: App,
        source_run_id: str,
        target_node_id: str,
        overrides: Sequence[WorkflowRunRerunOverride],
    ) -> _WorkflowRunRerunPlan:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            self._raise_error("unsupported_app_mode", 422, "Only workflow mode supports rerun.")

        source_run = self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            run_id=source_run_id,
        )
        if source_run is None:
            self._raise_error("workflow_run_not_found", 404, "Workflow run not found.")

        if source_run.type != WorkflowType.WORKFLOW.value:
            self._raise_error("unsupported_app_mode", 422, "Only workflow type run supports rerun.")

        status = self._status_to_value(source_run.status)
        if status not in self._ENDED_STATUSES:
            self._raise_error("workflow_run_not_ended", 409, "Workflow run is not in ended status.")

        source_graph = self._load_source_graph_or_raise(
            app_model=app_model,
            source_run=source_run,
        )
        nodes = source_graph.get("nodes")
        edges = source_graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            self._raise_error("rerun_execution_failed", 500, "Invalid workflow graph data in source run.")

        nodes_by_id = {
            str(node["id"]): node
            for node in nodes
            if isinstance(node, Mapping) and isinstance(node.get("id"), str)
        }
        target_node = nodes_by_id.get(target_node_id)
        if target_node is None:
            self._raise_error("target_node_not_found", 404, "Target node not found in source run graph.")

        if not self._is_main_flow_node(target_node):
            self._raise_error(
                "unsupported_target_node_scope",
                422,
                "Target node in loop/iteration internal scope is not supported.",
            )

        main_node_ids = [node_id for node_id, node in nodes_by_id.items() if self._is_main_flow_node(node)]
        main_node_id_set = set(main_node_ids)

        descendants_main, ancestors = self._analyze_main_flow_scope(
            target_node_id=target_node_id,
            edges=edges,
            main_node_ids=main_node_ids,
            main_node_id_set=main_node_id_set,
        )
        descendants_main_set = set(descendants_main)

        rerun_node_id_set = set(descendants_main_set)
        self._expand_container_internal_nodes(
            rerun_node_id_set=rerun_node_id_set,
            nodes_by_id=nodes_by_id,
            all_nodes=nodes,
        )

        filtered_nodes = [node for node in nodes if isinstance(node, Mapping) and node.get("id") in rerun_node_id_set]
        rerun_node_ids = [
            node_id
            for node in filtered_nodes
            if isinstance((node_id := node.get("id")), str)
        ]
        filtered_edges = [
            edge
            for edge in edges
            if isinstance(edge, Mapping)
            and edge.get("source") in rerun_node_id_set
            and edge.get("target") in rerun_node_id_set
        ]

        execution_graph_config: dict[str, Any] = {
            "nodes": filtered_nodes,
            "edges": filtered_edges,
        }

        workflow = self._load_workflow(
            app_model=app_model,
            workflow_id=source_run.workflow_id,
        )
        workflow_run_id = str(uuid.uuid4())
        task_id = str(uuid.uuid4())

        user_inputs, variable_pool = self._rebuild_variable_pool(
            app_model=app_model,
            workflow=workflow,
            source_run=source_run,
            workflow_run_id=workflow_run_id,
            rerun_node_ids=rerun_node_ids,
            overrides=overrides,
            ancestors=ancestors,
        )

        override_payload = [override.model_dump(mode="json") for override in overrides]
        scope = WorkflowRunRerunScope(
            target_node_id=target_node_id,
            ancestor_node_ids=ancestors,
            rerun_node_ids=rerun_node_ids,
            overrideable_node_ids=ancestors,
        )
        rerun_chain_root_workflow_run_id = self._resolve_rerun_chain_root(
            app_model=app_model,
            source_run=source_run,
        )
        rerun_metadata = WorkflowRunRerunMetadata(
            rerun_from_workflow_run_id=source_run.id,
            rerun_from_node_id=target_node_id,
            rerun_overrides=override_payload,
            rerun_scope=scope,
            rerun_chain_root_workflow_run_id=rerun_chain_root_workflow_run_id,
            rerun_kind="manual-node-rerun",
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        return _WorkflowRunRerunPlan(
            app_model=app_model,
            workflow=workflow,
            source_run=source_run,
            workflow_run_id=workflow_run_id,
            task_id=task_id,
            target_node_id=target_node_id,
            user_inputs=user_inputs,
            execution_graph_config=execution_graph_config,
            scope=scope,
            normalized_overrides=override_payload,
            graph_runtime_state=graph_runtime_state,
            rerun_metadata=rerun_metadata,
        )

    def _resolve_rerun_chain_root(self, *, app_model: App, source_run: WorkflowRun) -> str:
        """
        Resolve rerun chain root with defensive fallback for partially populated source runs.

        Some repository backends may miss `rerun_chain_root_workflow_run_id` on old records.
        In that case we traverse `rerun_from_workflow_run_id` links to preserve the original
        chain root instead of resetting to the immediate source run id.
        """
        current_run = source_run
        visited_run_ids: set[str] = set()

        while True:
            current_run_id = cast("str | None", getattr(current_run, "id", None))
            if not current_run_id:
                return source_run.id

            if current_run_id in visited_run_ids:
                return current_run_id
            visited_run_ids.add(current_run_id)

            chain_root_run_id = cast("str | None", getattr(current_run, "rerun_chain_root_workflow_run_id", None))
            if chain_root_run_id:
                return chain_root_run_id

            parent_run_id = cast("str | None", getattr(current_run, "rerun_from_workflow_run_id", None))
            if not parent_run_id:
                return current_run_id

            if parent_run_id in visited_run_ids:
                return parent_run_id

            parent_run = self._workflow_run_repo.get_workflow_run_by_id(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                run_id=parent_run_id,
            )
            if parent_run is None:
                return parent_run_id

            current_run = parent_run

    def _load_source_graph_or_raise(
        self,
        *,
        app_model: App,
        source_run: WorkflowRun,
    ) -> Mapping[str, Any]:
        """
        Load source graph with source_run as primary source and SQL repository as fallback.

        Rerun must follow the graph stored on the source run. For mixed storage deployments,
        we only fallback to SQL when the source run graph is unavailable or malformed.
        """
        source_graph = source_run.graph_dict
        if isinstance(source_graph, Mapping):
            nodes = source_graph.get("nodes")
            edges = source_graph.get("edges")
            if isinstance(nodes, list) and isinstance(edges, list):
                return source_graph
            logger.warning(
                "Invalid source run graph structure, fallback to SQL graph. tenant_id=%s app_id=%s source_run_id=%s",
                app_model.tenant_id,
                app_model.id,
                source_run.id,
            )

        sql_source_run = self._sql_workflow_run_repo.get_workflow_run_by_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            run_id=source_run.id,
        )
        if sql_source_run is None:
            self._raise_error("rerun_execution_failed", 500, "Source workflow run graph not found in SQL repository.")

        source_graph = sql_source_run.graph_dict
        if not isinstance(source_graph, Mapping):
            self._raise_error("rerun_execution_failed", 500, "Invalid workflow graph data in source run.")
        return source_graph

    def _execute_streaming_with_plan(
        self,
        *,
        plan: _WorkflowRunRerunPlan,
        user: Account | EndUser,
    ) -> Generator[str | Mapping[str, Any], None, None]:
        from tasks.app_generate.workflow_rerun_task import WorkflowRunRerunTaskPayload, workflow_run_rerun_task

        payload = WorkflowRunRerunTaskPayload(
            app_id=plan.app_model.id,
            workflow_id=plan.workflow.id,
            tenant_id=plan.app_model.tenant_id,
            user_id=user.id,
            user_role=("account" if isinstance(user, Account) else "end_user"),
            task_id=plan.task_id,
            workflow_run_id=plan.workflow_run_id,
            target_node_id=plan.target_node_id,
            user_inputs=plan.user_inputs,
            execution_graph_config=plan.execution_graph_config,
            rerun_metadata=plan.rerun_metadata,
            graph_runtime_state_snapshot=plan.graph_runtime_state.dumps(),
        )
        payload_json = payload.model_dump_json()

        def on_subscribe() -> None:
            workflow_run_rerun_task.delay(payload_json)

        on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(on_subscribe)
        return WorkflowAppGenerator.convert_to_event_stream(
            MessageBasedAppGenerator.retrieve_events(
                AppMode.WORKFLOW,
                plan.workflow_run_id,
                on_subscribe=on_subscribe,
            )
        )

    def _execute_blocking_with_plan(
        self,
        *,
        plan: _WorkflowRunRerunPlan,
        user: Account | EndUser,
    ) -> Mapping[str, Any]:
        response = self._execute_generator_with_plan(
            plan=plan,
            user=user,
            streaming=False,
            graph_runtime_state=plan.graph_runtime_state,
        )
        if not isinstance(response, Mapping):
            self._raise_error("rerun_execution_failed", 500, "Invalid rerun blocking response.")

        data = response.get("data")
        if not isinstance(data, Mapping):
            self._raise_error("rerun_execution_failed", 500, "Invalid rerun blocking response data.")

        status = self._status_to_value(data.get("status"))
        if status not in self._BLOCKING_ALLOWED_STATUSES:
            self._raise_error("rerun_execution_failed", 500, "Invalid rerun blocking response status.")

        error: str | None = cast("str | None", data.get("error"))
        if status in self._FAILED_STATUSES and not error:
            error = "Workflow rerun failed."
        if status in self._EMPTY_ERROR_STATUSES:
            error = None

        return {
            "workflow_run_id": response.get("workflow_run_id", plan.workflow_run_id),
            "task_id": response.get("task_id", plan.task_id),
            "source_workflow_run_id": plan.source_run.id,
            "target_node_id": plan.target_node_id,
            "status": status,
            "outputs": data.get("outputs"),
            "error": error,
            "scope": plan.scope.model_dump(mode="json"),
            "elapsed_time": data.get("elapsed_time", 0),
            "total_tokens": data.get("total_tokens", 0),
            "total_steps": data.get("total_steps", 0),
            "created_at": data.get("created_at"),
            "finished_at": data.get("finished_at"),
        }

    def _execute_generator_with_plan(
        self,
        *,
        plan: _WorkflowRunRerunPlan,
        user: Account | EndUser,
        streaming: bool,
        graph_runtime_state: GraphRuntimeState,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
        invoke_from = self._resolve_invoke_from(user)
        app_config = WorkflowAppConfigManager.get_app_config(app_model=plan.app_model, workflow=plan.workflow)
        file_upload_config = FileUploadConfigManager.convert(plan.workflow.features_dict, is_vision=False)
        trace_user_id = user.id if isinstance(user, Account) else user.session_id
        trace_manager = TraceQueueManager(app_id=plan.app_model.id, user_id=trace_user_id)

        generate_entity = WorkflowAppGenerateEntity(
            task_id=plan.task_id,
            app_config=app_config,
            file_upload_config=file_upload_config,
            inputs=plan.user_inputs,
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            call_depth=0,
            trace_manager=trace_manager,
            workflow_execution_id=plan.workflow_run_id,
        )

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=self._session_factory,
            user=user,
            app_id=plan.app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.RERUN,
        )
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=self._session_factory,
            user=user,
            app_id=plan.app_model.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        pause_state_config = PauseStateLayerConfig(
            session_factory=self._session_factory,
            state_owner_user_id=plan.workflow.created_by,
        )

        return WorkflowAppGenerator().rerun(
            app_model=plan.app_model,
            workflow=plan.workflow,
            user=user,
            application_generate_entity=generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            execution_graph_config=plan.execution_graph_config,
            graph_runtime_state=graph_runtime_state,
            rerun_metadata=plan.rerun_metadata,
            root_node_id=plan.target_node_id,
            streaming=streaming,
            pause_state_config=pause_state_config,
        )

    def _load_workflow(self, *, app_model: App, workflow_id: str) -> Workflow:
        with self._session_factory() as session:
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == workflow_id,
                    Workflow.tenant_id == app_model.tenant_id,
                    Workflow.app_id == app_model.id,
                )
            )
        if workflow is None:
            self._raise_error("rerun_execution_failed", 500, "Source workflow not found.")
        return workflow

    def _rebuild_variable_pool(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        source_run: WorkflowRun,
        workflow_run_id: str,
        rerun_node_ids: Sequence[str],
        overrides: Sequence[WorkflowRunRerunOverride],
        ancestors: Sequence[str],
    ) -> tuple[dict[str, Any], VariablePool]:
        source_inputs = source_run.inputs_dict
        if not isinstance(source_inputs, Mapping):
            self._raise_error("rerun_execution_failed", 500, "Invalid source workflow run inputs.")

        user_inputs: dict[str, Any] = {}
        raw_system_values: dict[str, Any] = {}
        for key, value in source_inputs.items():
            if not isinstance(key, str):
                continue
            if key.startswith("sys."):
                raw_system_values[key[4:]] = value
            else:
                user_inputs[key] = value

        raw_system_values["workflow_run_id"] = workflow_run_id
        raw_system_values["timestamp"] = int(naive_utc_now().timestamp())
        raw_system_values.pop("conversation_id", None)

        supported_system_keys = set(SystemVariable.model_fields.keys()) | {"workflow_run_id"}
        system_payload = {k: v for k, v in raw_system_values.items() if k in supported_system_keys}
        system_variables = SystemVariable.model_validate(system_payload)
        system_variables.workflow_execution_id = workflow_run_id
        system_variables.timestamp = int(naive_utc_now().timestamp())
        system_variables.conversation_id = None

        variable_pool = VariablePool(
            system_variables=system_variables,
            user_inputs=user_inputs,
            environment_variables=workflow.environment_variables,
            conversation_variables=[],
        )

        node_executions = self._node_execution_repo.get_executions_by_workflow_run(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_run_id=source_run.id,
        )
        with self._session_factory() as session:
            for node_execution in sorted(node_executions, key=self._node_execution_replay_sort_key):
                outputs = node_execution.load_full_outputs(session=session, storage=storage)
                if not outputs:
                    continue
                for variable_name, value in outputs.items():
                    variable_pool.add([node_execution.node_id, str(variable_name)], value)

        for node_id in rerun_node_ids:
            variable_pool.remove([node_id])

        self._apply_overrides(variable_pool=variable_pool, overrides=overrides, ancestors=ancestors)
        return user_inputs, variable_pool

    def _apply_overrides(
        self,
        *,
        variable_pool: VariablePool,
        overrides: Sequence[WorkflowRunRerunOverride],
        ancestors: Sequence[str],
    ) -> None:
        ancestor_set = set(ancestors)
        for override in overrides:
            selector = override.selector
            if not selector or len(selector) < 2 or not all(isinstance(part, str) and part for part in selector):
                self._raise_error("override_selector_invalid", 422, "Override selector is invalid.")
            if selector[0] not in ancestor_set:
                self._raise_error("override_out_of_scope", 422, "Override selector is out of rerun scope.")

            if len(selector) == 2:
                variable_pool.add(selector, override.value)
                continue

            root_selector = selector[:2]
            segment = variable_pool.get(root_selector)
            if segment is None:
                self._raise_error("override_selector_invalid", 422, "Override selector path does not exist.")

            root_value = copy.deepcopy(segment.value)
            if not isinstance(root_value, dict):
                self._raise_error("override_type_mismatch", 422, "Override selector path type mismatch.")

            current: dict[str, Any] = root_value
            for key in selector[2:-1]:
                if key not in current:
                    self._raise_error("override_selector_invalid", 422, "Override selector path does not exist.")
                next_value = current[key]
                if not isinstance(next_value, dict):
                    self._raise_error("override_type_mismatch", 422, "Override selector path type mismatch.")
                current = next_value

            leaf = selector[-1]
            if leaf not in current:
                self._raise_error("override_selector_invalid", 422, "Override selector path does not exist.")
            current[leaf] = override.value
            variable_pool.add(root_selector, root_value)

    def _expand_container_internal_nodes(
        self,
        *,
        rerun_node_id_set: set[str],
        nodes_by_id: Mapping[str, Mapping[str, Any]],
        all_nodes: Sequence[Any],
    ) -> None:
        pending = deque([node_id for node_id in rerun_node_id_set if node_id in nodes_by_id])
        processed: set[str] = set()

        while pending:
            node_id = pending.popleft()
            if node_id in processed:
                continue
            processed.add(node_id)

            node = nodes_by_id.get(node_id)
            if node is None:
                continue

            node_type = self._node_type(node)
            if node_type == "loop":
                linked_ids = self._collect_internal_nodes(all_nodes=all_nodes, container_node=node, scope_key="loop_id")
            elif node_type == "iteration":
                linked_ids = self._collect_internal_nodes(
                    all_nodes=all_nodes,
                    container_node=node,
                    scope_key="iteration_id",
                )
            else:
                continue

            for linked_id in linked_ids:
                if linked_id not in rerun_node_id_set:
                    rerun_node_id_set.add(linked_id)
                    pending.append(linked_id)

    def _collect_internal_nodes(
        self,
        *,
        all_nodes: Sequence[Any],
        container_node: Mapping[str, Any],
        scope_key: str,
    ) -> set[str]:
        container_id = cast("str", container_node.get("id"))
        internal_ids: set[str] = set()
        for node in all_nodes:
            if not isinstance(node, Mapping):
                continue
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            if self._node_scope_id(node, scope_key) == container_id:
                internal_ids.add(node_id)

        start_node_id = self._node_data(container_node).get("start_node_id")
        if isinstance(start_node_id, str):
            internal_ids.add(start_node_id)
        return internal_ids

    def _analyze_main_flow_scope(
        self,
        *,
        target_node_id: str,
        edges: Sequence[Any],
        main_node_ids: Sequence[str],
        main_node_id_set: set[str],
    ) -> tuple[list[str], list[str]]:
        forward: dict[str, set[str]] = defaultdict(set)
        backward: dict[str, set[str]] = defaultdict(set)

        for edge in edges:
            if not isinstance(edge, Mapping):
                continue
            source = edge.get("source")
            target = edge.get("target")
            if not isinstance(source, str) or not isinstance(target, str):
                continue
            if source in main_node_id_set and target in main_node_id_set:
                forward[source].add(target)
                backward[target].add(source)

        descendants: set[str] = set()
        queue = deque([target_node_id])
        while queue:
            current = queue.popleft()
            if current in descendants:
                continue
            descendants.add(current)
            for nxt in forward.get(current, set()):
                if nxt not in descendants:
                    queue.append(nxt)

        ancestors: set[str] = set()
        queue = deque([target_node_id])
        visited: set[str] = {target_node_id}
        while queue:
            current = queue.popleft()
            for prev in backward.get(current, set()):
                if prev in visited:
                    continue
                visited.add(prev)
                ancestors.add(prev)
                queue.append(prev)

        descendant_list = [node_id for node_id in main_node_ids if node_id in descendants]
        ancestor_list = [node_id for node_id in main_node_ids if node_id in ancestors]
        return descendant_list, ancestor_list

    @staticmethod
    def _node_execution_replay_sort_key(node_execution: Any) -> tuple[float, int, str]:
        created_at = getattr(node_execution, "created_at", None)
        if hasattr(created_at, "timestamp"):
            created_at_key = float(created_at.timestamp())
        elif isinstance(created_at, (int, float)):
            created_at_key = float(created_at)
        else:
            created_at_key = 0.0

        index = getattr(node_execution, "index", 0)
        if not isinstance(index, int):
            try:
                index = int(index)
            except (TypeError, ValueError):
                index = 0

        execution_id = getattr(node_execution, "id", "")
        if not isinstance(execution_id, str):
            execution_id = str(execution_id) if execution_id is not None else ""

        return (created_at_key, index, execution_id)

    @staticmethod
    def _is_main_flow_node(node: Mapping[str, Any]) -> bool:
        return not (
            WorkflowRunRerunService._node_flag(node, "isInLoop")
            or WorkflowRunRerunService._node_flag(node, "isInIteration")
        )

    @staticmethod
    def _node_flag(node: Mapping[str, Any], key: str) -> bool:
        top_value = node.get(key)
        if isinstance(top_value, bool):
            return top_value
        data_value = WorkflowRunRerunService._node_data(node).get(key)
        return bool(data_value) if isinstance(data_value, bool) else False

    @staticmethod
    def _node_scope_id(node: Mapping[str, Any], key: str) -> str | None:
        top_value = node.get(key)
        if isinstance(top_value, str) and top_value:
            return top_value
        data_value = WorkflowRunRerunService._node_data(node).get(key)
        return data_value if isinstance(data_value, str) and data_value else None

    @staticmethod
    def _node_type(node: Mapping[str, Any]) -> str | None:
        top_value = node.get("type")
        if isinstance(top_value, str) and top_value and top_value != "custom":
            return top_value
        data_value = WorkflowRunRerunService._node_data(node).get("type")
        return data_value if isinstance(data_value, str) and data_value else None

    @staticmethod
    def _node_data(node: Mapping[str, Any]) -> Mapping[str, Any]:
        data = node.get("data")
        if isinstance(data, Mapping):
            return data
        return {}

    @staticmethod
    def _status_to_value(status: Any) -> str:
        if hasattr(status, "value"):
            return str(status.value)
        return str(status)

    @staticmethod
    def _raise_error(code: str, status: int, message: str) -> None:
        raise WorkflowRunRerunServiceError(code=code, status=status, message=message)

    @staticmethod
    def _resolve_invoke_from(user: Account | EndUser) -> InvokeFrom:
        if isinstance(user, Account):
            return InvokeFrom.DEBUGGER
        return InvokeFrom.SERVICE_API
