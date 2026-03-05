from __future__ import annotations

import copy
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, NoReturn, cast

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
from core.helper import encrypter
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories import DifyCoreRepositoryFactory
from dify_graph.constants import ENVIRONMENT_VARIABLE_NODE_ID
from dify_graph.entities.workflow_execution import WorkflowRunRerunMetadata, WorkflowRunRerunScope
from dify_graph.enums import WorkflowExecutionStatus, WorkflowNodeExecutionMetadataKey, WorkflowType
from dify_graph.file import FileTransferMethod
from dify_graph.file.models import File
from dify_graph.graph_engine.replay import BaselineNodeSnapshot, ReplayExecutionStrategyConfig, RerunOverrideContext
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from dify_graph.variables import SecretVariable, VariableBase
from dify_graph.variables.types import SegmentType
from extensions.ext_database import db
from extensions.ext_storage import storage
from factories import file_factory
from libs.datetime_utils import naive_utc_now
from models import Account, App, EndUser, WorkflowNodeExecutionTriggeredFrom, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)

_RERUN_OVERRIDEABLE_GROUP = Literal["ancestor_node_outputs", "start_node_variables", "environment_variables"]
_MISSING = object()


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


class WorkflowRunRerunOverrideableVariable(BaseModel):
    selector: list[str] = Field(min_length=2)
    value_type: str
    value: Any
    required: bool | None = None
    declared_type: str | None = None
    masked: bool = False


class WorkflowRunRerunOverrideableVariableGroup(BaseModel):
    group: _RERUN_OVERRIDEABLE_GROUP
    variables: list[WorkflowRunRerunOverrideableVariable]


class WorkflowRunRerunOverrideableVariablesResponse(BaseModel):
    source_workflow_run_id: str
    target_node_id: str
    groups: list[WorkflowRunRerunOverrideableVariableGroup]


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
    rerun_strategy_config: ReplayExecutionStrategyConfig
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

    def get_overrideable_variables(
        self,
        *,
        app_model: App,
        source_run_id: str,
        target_node_id: str,
    ) -> dict[str, Any]:
        plan = self._build_plan_or_raise(
            app_model=app_model,
            source_run_id=source_run_id,
            target_node_id=target_node_id,
            overrides=[],
        )

        source_graph = self._load_source_graph_or_raise(
            app_model=app_model,
            source_run=plan.source_run,
        )
        nodes = source_graph.get("nodes")
        if not isinstance(nodes, list):
            self._raise_error("rerun_execution_failed", 500, "Invalid workflow graph data in source run.")

        start_nodes = self._extract_main_flow_start_nodes(nodes=nodes)
        start_node_ids = [cast("str", node.get("id")) for node in start_nodes]

        source_inputs = plan.source_run.inputs_dict
        if not isinstance(source_inputs, Mapping):
            self._raise_error("rerun_execution_failed", 500, "Invalid source workflow run inputs.")

        variable_pool = plan.graph_runtime_state.variable_pool
        ancestor_candidates = self._collect_node_output_candidates(
            variable_pool=variable_pool,
            node_ids=plan.scope.ancestor_node_ids,
            exclude_node_ids=set(start_node_ids),
        )
        start_candidates = self._collect_start_node_candidates(
            source_inputs=source_inputs,
            start_nodes=start_nodes,
        )
        environment_candidates = self._collect_environment_candidates(
            environment_variables=plan.workflow.environment_variables,
        )

        response = WorkflowRunRerunOverrideableVariablesResponse(
            source_workflow_run_id=plan.source_run.id,
            target_node_id=target_node_id,
            groups=[
                WorkflowRunRerunOverrideableVariableGroup(
                    group="ancestor_node_outputs",
                    variables=ancestor_candidates,
                ),
                WorkflowRunRerunOverrideableVariableGroup(
                    group="start_node_variables",
                    variables=start_candidates,
                ),
                WorkflowRunRerunOverrideableVariableGroup(
                    group="environment_variables",
                    variables=environment_candidates,
                ),
            ],
        )
        return response.model_dump(mode="json")

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
            str(node["id"]): node for node in nodes if isinstance(node, Mapping) and isinstance(node.get("id"), str)
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
        start_node_ids = self._extract_main_flow_start_node_ids(
            nodes_by_id=nodes_by_id,
            main_node_ids=main_node_ids,
        )
        overrideable_node_ids = self._build_overrideable_node_ids(
            ancestors=ancestors,
            start_node_ids=start_node_ids,
        )
        descendants_main_set = set(descendants_main)

        rerun_node_id_set = set(descendants_main_set)
        self._expand_container_internal_nodes(
            rerun_node_id_set=rerun_node_id_set,
            nodes_by_id=nodes_by_id,
            all_nodes=nodes,
        )

        rerun_node_ids = [
            node_id
            for node in nodes
            if isinstance(node, Mapping)
            and isinstance((node_id := node.get("id")), str)
            and node_id in rerun_node_id_set
        ]
        execution_graph_config: dict[str, Any] = {
            "nodes": list(nodes),
            "edges": list(edges),
        }

        baseline_snapshots_by_node_id = self._collect_baseline_snapshots(
            app_model=app_model,
            source_run=source_run,
        )
        baseline_snapshots_by_node_id = {
            node_id: snapshot for node_id, snapshot in baseline_snapshots_by_node_id.items() if node_id in nodes_by_id
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
            baseline_snapshots_by_node_id=baseline_snapshots_by_node_id,
            rerun_node_ids=rerun_node_ids,
            overrides=overrides,
            allowed_node_ids=overrideable_node_ids,
        )

        override_payload = [override.model_dump(mode="json") for override in overrides]
        override_context = self._build_rerun_override_context(
            normalized_overrides=override_payload,
        )
        scope = WorkflowRunRerunScope(
            target_node_id=target_node_id,
            ancestor_node_ids=ancestors,
            rerun_node_ids=rerun_node_ids,
            overrideable_node_ids=overrideable_node_ids,
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
        rerun_strategy_config = ReplayExecutionStrategyConfig(
            real_node_ids=rerun_node_ids,
            baseline_snapshots_by_node_id=baseline_snapshots_by_node_id,
            override_context=override_context,
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
            rerun_strategy_config=rerun_strategy_config,
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

    def _collect_baseline_snapshots(
        self,
        *,
        app_model: App,
        source_run: WorkflowRun,
    ) -> dict[str, BaselineNodeSnapshot]:
        """
        Collect nearest baseline snapshots by traversing source run and rerun ancestors.

        Precedence is nearest-first: source_run snapshots win over any ancestor snapshots.
        """
        latest_snapshot_by_node_id: dict[str, BaselineNodeSnapshot] = {}
        visited_run_ids: set[str] = set()
        current_run: WorkflowRun | None = source_run

        while current_run is not None:
            current_run_id = cast("str | None", getattr(current_run, "id", None))
            if not current_run_id:
                break

            if current_run_id in visited_run_ids:
                logger.warning(
                    "Detected rerun baseline cycle, stopping traversal. tenant_id=%s app_id=%s run_id=%s",
                    app_model.tenant_id,
                    app_model.id,
                    current_run_id,
                )
                break
            visited_run_ids.add(current_run_id)

            try:
                node_executions = self._node_execution_repo.get_executions_by_workflow_run(
                    tenant_id=app_model.tenant_id,
                    app_id=app_model.id,
                    workflow_run_id=current_run_id,
                )
            except Exception:
                logger.exception(
                    "Failed to load baseline node executions, fallback to partial baseline. "
                    "tenant_id=%s app_id=%s run_id=%s",
                    app_model.tenant_id,
                    app_model.id,
                    current_run_id,
                )
                break

            sorted_node_executions = sorted(node_executions, key=self._node_execution_replay_sort_key, reverse=True)
            with self._session_factory() as session:
                for node_execution in sorted_node_executions:
                    node_id = getattr(node_execution, "node_id", None)
                    if not isinstance(node_id, str) or node_id in latest_snapshot_by_node_id:
                        continue

                    snapshot = self._build_baseline_snapshot(
                        node_execution=node_execution,
                        source_workflow_run_id=current_run_id,
                        session=session,
                    )
                    if snapshot is None:
                        continue
                    latest_snapshot_by_node_id[node_id] = snapshot

            parent_run_id = cast("str | None", getattr(current_run, "rerun_from_workflow_run_id", None))
            if not parent_run_id:
                break
            if parent_run_id in visited_run_ids:
                logger.warning(
                    "Detected rerun baseline cycle at parent, stopping traversal. tenant_id=%s app_id=%s run_id=%s",
                    app_model.tenant_id,
                    app_model.id,
                    parent_run_id,
                )
                break

            parent_run = self._workflow_run_repo.get_workflow_run_by_id(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                run_id=parent_run_id,
            )
            if parent_run is None:
                logger.warning(
                    "Missing rerun parent run while collecting baseline snapshots. tenant_id=%s app_id=%s run_id=%s",
                    app_model.tenant_id,
                    app_model.id,
                    parent_run_id,
                )
                break
            current_run = parent_run

        return latest_snapshot_by_node_id

    def _build_baseline_snapshot(
        self,
        *,
        node_execution: Any,
        source_workflow_run_id: str,
        session: Any,
    ) -> BaselineNodeSnapshot | None:
        node_id = getattr(node_execution, "node_id", None)
        if not isinstance(node_id, str) or not node_id:
            return None

        source_node_execution_id = getattr(node_execution, "node_execution_id", None) or getattr(
            node_execution, "id", None
        )
        if not isinstance(source_node_execution_id, str) or not source_node_execution_id:
            return None

        try:
            inputs = node_execution.load_full_inputs(session=session, storage=storage)
        except Exception:
            logger.exception(
                "Failed to load baseline inputs for node execution. workflow_run_id=%s node_id=%s execution_id=%s",
                source_workflow_run_id,
                node_id,
                source_node_execution_id,
            )
            inputs = None

        try:
            process_data = node_execution.load_full_process_data(session=session, storage=storage)
        except Exception:
            logger.exception(
                "Failed to load baseline process_data for node execution. "
                "workflow_run_id=%s node_id=%s execution_id=%s",
                source_workflow_run_id,
                node_id,
                source_node_execution_id,
            )
            process_data = None

        try:
            outputs = node_execution.load_full_outputs(session=session, storage=storage)
        except Exception:
            logger.exception(
                "Failed to load baseline outputs for node execution. workflow_run_id=%s node_id=%s execution_id=%s",
                source_workflow_run_id,
                node_id,
                source_node_execution_id,
            )
            outputs = None

        execution_metadata_raw = getattr(node_execution, "execution_metadata_dict", {})
        execution_metadata: Mapping[str, Any] = {}
        if isinstance(execution_metadata_raw, Mapping):
            execution_metadata = {
                str(key): value for key, value in execution_metadata_raw.items() if isinstance(key, str)
            }

        edge_source_handle_raw = getattr(node_execution, "edge_source_handle", None)
        if not isinstance(edge_source_handle_raw, str) or not edge_source_handle_raw:
            edge_source_handle_raw = execution_metadata.get(WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE.value)
        edge_source_handle = (
            edge_source_handle_raw if isinstance(edge_source_handle_raw, str) and edge_source_handle_raw else None
        )

        return BaselineNodeSnapshot(
            node_id=node_id,
            source_workflow_run_id=source_workflow_run_id,
            source_node_execution_id=source_node_execution_id,
            inputs=inputs if isinstance(inputs, Mapping) else None,
            process_data=process_data if isinstance(process_data, Mapping) else None,
            outputs=outputs if isinstance(outputs, Mapping) else None,
            execution_metadata=execution_metadata,
            edge_source_handle=edge_source_handle,
        )

    def _build_rerun_override_context(
        self,
        *,
        normalized_overrides: Sequence[dict[str, Any]],
    ) -> RerunOverrideContext:
        selectors_by_node_id: dict[str, set[str]] = defaultdict(set)
        for override in normalized_overrides:
            selector = override.get("selector")
            if not isinstance(selector, Sequence) or len(selector) < 2:
                continue
            node_id = selector[0]
            variable_name = selector[1]
            if not isinstance(node_id, str) or not isinstance(variable_name, str):
                continue

            selectors_by_node_id[node_id].add(variable_name)

        return RerunOverrideContext(
            override_root_selectors_by_node_id={
                node_id: sorted(variable_names) for node_id, variable_names in selectors_by_node_id.items()
            }
        )

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
            rerun_strategy_config=plan.rerun_strategy_config,
            graph_runtime_state_snapshot=plan.graph_runtime_state.dumps(),
        )
        payload_json = payload.model_dump_json()

        def on_subscribe() -> None:
            workflow_run_rerun_task.delay(payload_json)

        on_subscribe = AppGenerateService.build_streaming_task_on_subscribe(on_subscribe)
        response_stream = WorkflowAppGenerator.convert_to_event_stream(
            MessageBasedAppGenerator.retrieve_events(
                AppMode.WORKFLOW,
                plan.workflow_run_id,
                on_subscribe=on_subscribe,
            )
        )
        return cast("Generator[str | Mapping[str, Any], None, None]", response_stream)

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
            root_node_id=None,
            streaming=streaming,
            rerun_strategy_config=plan.rerun_strategy_config,
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
        baseline_snapshots_by_node_id: Mapping[str, BaselineNodeSnapshot],
        rerun_node_ids: Sequence[str],
        overrides: Sequence[WorkflowRunRerunOverride],
        allowed_node_ids: Sequence[str],
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

        for node_id in sorted(baseline_snapshots_by_node_id.keys()):
            snapshot = baseline_snapshots_by_node_id[node_id]
            outputs = snapshot.outputs
            if not isinstance(outputs, Mapping):
                continue
            for variable_name, value in outputs.items():
                rebuilt_value = WorkflowDraftVariable.rebuild_file_types(value)
                variable_pool.add([node_id, str(variable_name)], rebuilt_value)

        for node_id in rerun_node_ids:
            variable_pool.remove([node_id])

        self._apply_overrides(
            variable_pool=variable_pool,
            overrides=overrides,
            allowed_node_ids=allowed_node_ids,
            tenant_id=app_model.tenant_id,
        )
        return user_inputs, variable_pool

    def _apply_overrides(
        self,
        *,
        variable_pool: VariablePool,
        overrides: Sequence[WorkflowRunRerunOverride],
        allowed_node_ids: Sequence[str],
        tenant_id: str,
    ) -> None:
        allowed_node_id_set = set(allowed_node_ids)
        for override in overrides:
            selector = override.selector
            if not selector or len(selector) < 2 or not all(isinstance(part, str) and part for part in selector):
                self._raise_error("override_selector_invalid", 422, "Override selector is invalid.")
            if selector[0] not in allowed_node_id_set:
                self._raise_error("override_out_of_scope", 422, "Override selector is out of rerun scope.")

            override_value = self._normalize_override_value(
                selector=selector,
                value=override.value,
                variable_pool=variable_pool,
                tenant_id=tenant_id,
            )
            if len(selector) == 2:
                variable_pool.add(selector, override_value)
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
            current[leaf] = override_value
            variable_pool.add(root_selector, root_value)

    def _normalize_override_value(
        self,
        *,
        selector: Sequence[str],
        value: Any,
        variable_pool: VariablePool,
        tenant_id: str,
    ) -> Any:
        normalized_value = WorkflowDraftVariable.rebuild_file_types(value)

        root_selector = list(selector[:2])
        root_segment = variable_pool.get(root_selector)
        root_segment_type = root_segment.value_type if root_segment is not None else None
        expects_file_type = root_segment_type in {SegmentType.FILE, SegmentType.ARRAY_FILE}
        is_file_like_override = self._is_file_like_override_value(normalized_value)

        # Backward compatibility: rerun editor payloads may use legacy upload-style file mappings
        # (for example `related_id` without method-specific id fields). Normalize and rebuild through
        # file_factory so downstream nodes always receive canonical File objects with valid storage refs.
        maybe_file_value = self._try_rebuild_file_override_value(value=normalized_value, tenant_id=tenant_id)
        if maybe_file_value is not None:
            return maybe_file_value

        if is_file_like_override:
            self._raise_error("override_type_mismatch", 422, "Override selector path type mismatch.")
        if expects_file_type and self._looks_like_file_override_payload(normalized_value):
            self._raise_error("override_type_mismatch", 422, "Override selector path type mismatch.")
        return normalized_value

    def _try_rebuild_file_override_value(self, *, value: Any, tenant_id: str) -> Any:
        normalized_mapping = self._normalize_file_mapping_for_factory(value)
        if normalized_mapping is not None:
            try:
                return file_factory.build_from_mapping(mapping=normalized_mapping, tenant_id=tenant_id)
            except Exception:
                return None

        if isinstance(value, list):
            if not value:
                return None
            normalized_mappings: list[Mapping[str, Any]] = []
            for item in value:
                mapping = self._normalize_file_mapping_for_factory(item)
                if mapping is None:
                    return None
                normalized_mappings.append(mapping)
            try:
                return file_factory.build_from_mappings(mappings=normalized_mappings, tenant_id=tenant_id)
            except Exception:
                return None

        return None

    @staticmethod
    def _looks_like_file_override_payload(value: Any) -> bool:
        if not isinstance(value, Mapping):
            return False

        transfer_method = value.get("transfer_method")
        file_type = value.get("type")
        if not isinstance(transfer_method, str) or not transfer_method:
            return False
        if not isinstance(file_type, str) or not file_type:
            return False

        has_file_ref = any(
            isinstance(value.get(key), str) and value.get(key)
            for key in ("upload_file_id", "related_id", "remote_url", "url")
        )
        return has_file_ref

    @classmethod
    def _normalize_file_mapping_for_factory(cls, value: Any) -> dict[str, Any] | None:
        if isinstance(value, File):
            return cls._file_to_factory_mapping(value)
        if not isinstance(value, Mapping):
            return None
        if not cls._looks_like_file_override_payload(value):
            return None

        normalized = {str(key): item for key, item in value.items() if isinstance(key, str)}
        transfer_method_raw = normalized.get("transfer_method")
        try:
            transfer_method = FileTransferMethod.value_of(transfer_method_raw)
        except Exception:
            return None

        related_id = normalized.get("related_id")
        if transfer_method == FileTransferMethod.LOCAL_FILE:
            if not normalized.get("upload_file_id") and isinstance(related_id, str) and related_id:
                normalized["upload_file_id"] = related_id
        elif transfer_method == FileTransferMethod.TOOL_FILE:
            if not normalized.get("tool_file_id") and isinstance(related_id, str) and related_id:
                normalized["tool_file_id"] = related_id
        elif transfer_method == FileTransferMethod.DATASOURCE_FILE:
            if not normalized.get("datasource_file_id") and isinstance(related_id, str) and related_id:
                normalized["datasource_file_id"] = related_id
        elif transfer_method == FileTransferMethod.REMOTE_URL:
            if not normalized.get("url") and isinstance(normalized.get("remote_url"), str):
                normalized["url"] = normalized["remote_url"]
            if (
                not normalized.get("url")
                and not normalized.get("upload_file_id")
                and isinstance(related_id, str)
                and related_id
            ):
                normalized["upload_file_id"] = related_id

        return normalized

    @staticmethod
    def _file_to_factory_mapping(file: File) -> dict[str, Any] | None:
        mapping: dict[str, Any] = {
            "id": file.id,
            "type": file.type.value,
            "transfer_method": file.transfer_method.value,
        }

        transfer_method = file.transfer_method
        related_id = file.related_id
        if transfer_method == FileTransferMethod.LOCAL_FILE:
            if not related_id:
                return None
            mapping["upload_file_id"] = related_id
        elif transfer_method == FileTransferMethod.TOOL_FILE:
            if not related_id:
                return None
            mapping["tool_file_id"] = related_id
        elif transfer_method == FileTransferMethod.DATASOURCE_FILE:
            if not related_id:
                return None
            mapping["datasource_file_id"] = related_id
        elif transfer_method == FileTransferMethod.REMOTE_URL:
            if related_id:
                mapping["upload_file_id"] = related_id
            elif file.remote_url:
                mapping["url"] = file.remote_url
            else:
                return None
        else:
            return None

        return mapping

    @classmethod
    def _is_file_like_override_value(cls, value: Any) -> bool:
        if isinstance(value, File):
            return True
        if isinstance(value, Mapping):
            return cls._looks_like_file_override_payload(value)
        if isinstance(value, list) and value:
            return all(
                isinstance(item, File) or (isinstance(item, Mapping) and cls._looks_like_file_override_payload(item))
                for item in value
            )
        return False

    def _collect_node_output_candidates(
        self,
        *,
        variable_pool: VariablePool,
        node_ids: Sequence[str],
        exclude_node_ids: set[str] | None = None,
    ) -> list[WorkflowRunRerunOverrideableVariable]:
        exclude_node_ids = exclude_node_ids or set()
        results: list[WorkflowRunRerunOverrideableVariable] = []

        for node_id in node_ids:
            if node_id in exclude_node_ids:
                continue

            node_variables = variable_pool.get_by_prefix(node_id)
            for variable_name in sorted(node_variables.keys()):
                selector = [node_id, variable_name]
                segment = variable_pool.get(selector)
                if segment is None:
                    continue
                results.append(
                    WorkflowRunRerunOverrideableVariable(
                        selector=selector,
                        value_type=segment.value_type.exposed_type().value,
                        value=self._to_jsonable_value(segment.value),
                    )
                )

        return results

    def _collect_start_node_candidates(
        self,
        *,
        source_inputs: Mapping[str, Any],
        start_nodes: Sequence[Mapping[str, Any]],
    ) -> list[WorkflowRunRerunOverrideableVariable]:
        results: list[WorkflowRunRerunOverrideableVariable] = []

        for start_node in start_nodes:
            node_id = start_node.get("id")
            if not isinstance(node_id, str) or not node_id:
                continue

            variables = self._node_data(start_node).get("variables")
            if not isinstance(variables, Sequence):
                continue

            for variable in variables:
                if not isinstance(variable, Mapping):
                    continue
                variable_name = variable.get("variable")
                if not isinstance(variable_name, str) or not variable_name:
                    continue

                declared_type = variable.get("type")
                declared_type_value = declared_type if isinstance(declared_type, str) else None
                required = variable.get("required")
                required_value = required if isinstance(required, bool) else None

                raw_value = self._resolve_start_variable_value(
                    source_inputs=source_inputs,
                    node_id=node_id,
                    variable_name=variable_name,
                    default_value=variable.get("default", None),
                )
                rebuilt_value = WorkflowDraftVariable.rebuild_file_types(raw_value)
                value_type = self._resolve_start_variable_value_type(
                    value=rebuilt_value,
                    declared_type=declared_type_value,
                )

                results.append(
                    WorkflowRunRerunOverrideableVariable(
                        selector=[node_id, variable_name],
                        value_type=value_type,
                        value=self._to_jsonable_value(rebuilt_value),
                        required=required_value,
                        declared_type=declared_type_value,
                    )
                )

        return results

    def _collect_environment_candidates(
        self,
        *,
        environment_variables: Sequence[VariableBase],
    ) -> list[WorkflowRunRerunOverrideableVariable]:
        results: list[WorkflowRunRerunOverrideableVariable] = []

        for env_variable in sorted(environment_variables, key=lambda variable: variable.name):
            masked = isinstance(env_variable, SecretVariable)
            value = encrypter.full_mask_token() if masked else self._to_jsonable_value(env_variable.value)
            results.append(
                WorkflowRunRerunOverrideableVariable(
                    selector=[ENVIRONMENT_VARIABLE_NODE_ID, env_variable.name],
                    value_type=env_variable.value_type.exposed_type().value,
                    value=value,
                    masked=masked,
                )
            )

        return results

    def _extract_main_flow_start_nodes(
        self,
        *,
        nodes: Sequence[Any],
    ) -> list[Mapping[str, Any]]:
        start_nodes: list[Mapping[str, Any]] = []
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            if not self._is_main_flow_node(node):
                continue
            if self._node_type(node) == "start":
                start_nodes.append(node)
        return start_nodes

    def _extract_main_flow_start_node_ids(
        self,
        *,
        nodes_by_id: Mapping[str, Mapping[str, Any]],
        main_node_ids: Sequence[str],
    ) -> list[str]:
        start_node_ids: list[str] = []
        for node_id in main_node_ids:
            node = nodes_by_id.get(node_id)
            if node is None:
                continue
            if self._node_type(node) == "start":
                start_node_ids.append(node_id)
        return start_node_ids

    @staticmethod
    def _build_overrideable_node_ids(
        *,
        ancestors: Sequence[str],
        start_node_ids: Sequence[str],
    ) -> list[str]:
        overrideable_node_ids: list[str] = []
        seen: set[str] = set()

        for node_id in [*ancestors, *start_node_ids, ENVIRONMENT_VARIABLE_NODE_ID]:
            if node_id in seen:
                continue
            seen.add(node_id)
            overrideable_node_ids.append(node_id)

        return overrideable_node_ids

    @staticmethod
    def _resolve_start_variable_value(
        *,
        source_inputs: Mapping[str, Any],
        node_id: str,
        variable_name: str,
        default_value: Any,
    ) -> Any:
        value = source_inputs.get(variable_name, _MISSING)
        if value is _MISSING:
            value = source_inputs.get(f"{node_id}.{variable_name}", _MISSING)
        if value is _MISSING:
            return default_value
        return value

    @classmethod
    def _resolve_start_variable_value_type(
        cls,
        *,
        value: Any,
        declared_type: str | None,
    ) -> str:
        inferred_type = SegmentType.infer_segment_type(value)
        if inferred_type is not None and inferred_type != SegmentType.NONE:
            return inferred_type.exposed_type().value

        declared_segment_type = cls._declared_start_variable_type_to_segment_type(declared_type)
        if declared_segment_type is not None:
            return declared_segment_type.exposed_type().value

        if inferred_type is None:
            return SegmentType.NONE.value
        return inferred_type.exposed_type().value

    @staticmethod
    def _declared_start_variable_type_to_segment_type(declared_type: str | None) -> SegmentType | None:
        if declared_type in {"text-input", "paragraph", "select", "external_data_tool"}:
            return SegmentType.STRING
        if declared_type == "number":
            return SegmentType.NUMBER
        if declared_type == "checkbox":
            return SegmentType.BOOLEAN
        if declared_type == "file":
            return SegmentType.FILE
        if declared_type == "file-list":
            return SegmentType.ARRAY_FILE
        if declared_type == "json_object":
            return SegmentType.OBJECT
        return None

    @classmethod
    def _to_jsonable_value(cls, value: Any) -> Any:
        if isinstance(value, File):
            return value.model_dump(mode="json")
        if isinstance(value, Mapping):
            return {str(key): cls._to_jsonable_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [cls._to_jsonable_value(item) for item in value]
        return value

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
        timestamp_func = getattr(created_at, "timestamp", None)
        if callable(timestamp_func):
            timestamp_value = timestamp_func()
            if isinstance(timestamp_value, (int, float)):
                created_at_key = float(timestamp_value)
            else:
                created_at_key = 0.0
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
    def _raise_error(code: str, status: int, message: str) -> NoReturn:
        raise WorkflowRunRerunServiceError(code=code, status=status, message=message)

    @staticmethod
    def _resolve_invoke_from(user: Account | EndUser) -> InvokeFrom:
        if isinstance(user, Account):
            return InvokeFrom.DEBUGGER
        return InvokeFrom.SERVICE_API
