import json
import time
import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Optional, cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import VariableEntityType
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.file import File
from core.repositories import DifyCoreRepositoryFactory
from core.variables import Variable
from core.variables.variables import VariableUnion
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_engine.entities.event import InNodeEvent
from core.workflow.nodes import NodeType
from core.workflow.nodes.base.node import BaseNode
from core.workflow.nodes.enums import ErrorStrategy
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.event.types import NodeEvent
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from models.account import Account
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError
from services.workflow.workflow_converter import WorkflowConverter

from .errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from .workflow_draft_variable_service import (
    DraftVariableSaver,
    DraftVarLoader,
    WorkflowDraftVariableService,
)


class WorkflowService:
    """
    Workflow Service
    """

    def __init__(self, session_maker: sessionmaker | None = None):
        """Initialize WorkflowService with repository dependencies."""
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )

    def get_node_last_run(self, app_model: App, workflow: Workflow, node_id: str) -> WorkflowNodeExecutionModel | None:
        """
        Get the most recent execution for a specific node.

        Args:
            app_model: The application model
            workflow: The workflow model
            node_id: The node identifier

        Returns:
            The most recent WorkflowNodeExecutionModel for the node, or None if not found
        """
        return self._node_execution_service_repo.get_node_last_execution(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow.id,
            node_id=node_id,
        )

    def is_workflow_exist(self, app_model: App) -> bool:
        return (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .count()
        ) > 0

    def get_draft_workflow(self, app_model: App) -> Optional[Workflow]:
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id, Workflow.app_id == app_model.id, Workflow.version == "draft"
            )
            .first()
        )

        # return draft workflow
        return workflow

    def get_published_workflow_by_id(self, app_model: App, workflow_id: str) -> Optional[Workflow]:
        # fetch published workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == workflow_id,
            )
            .first()
        )
        if not workflow:
            return None
        if workflow.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError(f"Workflow is draft version, id={workflow_id}")
        return workflow

    def get_published_workflow(self, app_model: App) -> Optional[Workflow]:
        """
        Get published workflow
        """

        if not app_model.workflow_id:
            return None

        # fetch published workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == app_model.workflow_id,
            )
            .first()
        )

        return workflow

    def get_all_published_workflow(
        self,
        *,
        session: Session,
        app_model: App,
        page: int,
        limit: int,
        user_id: str | None,
        named_only: bool = False,
    ) -> tuple[Sequence[Workflow], bool]:
        """
        Get published workflow with pagination
        """
        if not app_model.workflow_id:
            return [], False

        stmt = (
            select(Workflow)
            .where(Workflow.app_id == app_model.id)
            .order_by(Workflow.version.desc())
            .limit(limit + 1)
            .offset((page - 1) * limit)
        )

        if user_id:
            stmt = stmt.where(Workflow.created_by == user_id)

        if named_only:
            stmt = stmt.where(Workflow.marked_name != "")

        workflows = session.scalars(stmt).all()

        has_more = len(workflows) > limit
        if has_more:
            workflows = workflows[:-1]

        return workflows, has_more

    def sync_draft_workflow(
        self,
        *,
        app_model: App,
        graph: dict,
        features: dict,
        unique_hash: Optional[str],
        account: Account,
        environment_variables: Sequence[Variable],
        conversation_variables: Sequence[Variable],
    ) -> Workflow:
        """
        Sync draft workflow
        :raises WorkflowHashNotEqualError
        """
        # fetch draft workflow by app_model
        workflow = self.get_draft_workflow(app_model=app_model)

        if workflow and workflow.unique_hash != unique_hash:
            raise WorkflowHashNotEqualError()

        # validate features structure
        self.validate_features_structure(app_model=app_model, features=features)

        # create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type=WorkflowType.from_app_mode(app_model.mode).value,
                version="draft",
                graph=json.dumps(graph),
                features=json.dumps(features),
                created_by=account.id,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )
            db.session.add(workflow)
        # update draft workflow if found
        else:
            workflow.graph = json.dumps(graph)
            workflow.features = json.dumps(features)
            workflow.updated_by = account.id
            workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables

        # commit db session changes
        db.session.commit()

        # trigger app workflow events
        app_draft_workflow_was_synced.send(app_model, synced_draft_workflow=workflow)

        # return draft workflow
        return workflow

    def publish_workflow(
        self,
        *,
        session: Session,
        app_model: App,
        account: Account,
        marked_name: str = "",
        marked_comment: str = "",
    ) -> Workflow:
        draft_workflow_stmt = select(Workflow).where(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.version == "draft",
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        # create new workflow
        workflow = Workflow.new(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=draft_workflow.type,
            version=Workflow.version_from_datetime(datetime.now(UTC).replace(tzinfo=None)),
            graph=draft_workflow.graph,
            features=draft_workflow.features,
            created_by=account.id,
            environment_variables=draft_workflow.environment_variables,
            conversation_variables=draft_workflow.conversation_variables,
            marked_name=marked_name,
            marked_comment=marked_comment,
        )

        # commit db session changes
        session.add(workflow)

        # trigger app workflow events
        app_published_workflow_was_updated.send(app_model, published_workflow=workflow)

        # return new workflow
        return workflow

    def get_default_block_configs(self) -> list[dict]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs = []
        for node_class_mapping in NODE_TYPE_CLASSES_MAPPING.values():
            node_class = node_class_mapping[LATEST_VERSION]
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append(default_config)

        return default_block_configs

    def get_default_block_config(self, node_type: str, filters: Optional[dict] = None) -> Optional[dict]:
        """
        Get default config of node.
        :param node_type: node type
        :param filters: filter by node config parameters.
        :return:
        """
        node_type_enum = NodeType(node_type)

        # return default block config
        if node_type_enum not in NODE_TYPE_CLASSES_MAPPING:
            return None

        node_class = NODE_TYPE_CLASSES_MAPPING[node_type_enum][LATEST_VERSION]
        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return None

        return default_config

    def run_draft_workflow_node(
        self,
        app_model: App,
        draft_workflow: Workflow,
        node_id: str,
        user_inputs: Mapping[str, Any],
        account: Account,
        query: str = "",
        files: Sequence[File] | None = None,
    ) -> WorkflowNodeExecutionModel:
        """
        Run draft workflow node
        """
        files = files or []

        with Session(bind=db.engine, expire_on_commit=False) as session, session.begin():
            draft_var_srv = WorkflowDraftVariableService(session)
            draft_var_srv.prefill_conversation_variable_default_values(draft_workflow)

        node_config = draft_workflow.get_node_config_by_id(node_id)
        node_type = Workflow.get_node_type_from_node_config(node_config)
        node_data = node_config.get("data", {})
        if node_type == NodeType.START:
            with Session(bind=db.engine) as session, session.begin():
                draft_var_srv = WorkflowDraftVariableService(session)
                conversation_id = draft_var_srv.get_or_create_conversation(
                    account_id=account.id,
                    app=app_model,
                    workflow=draft_workflow,
                )
                start_data = StartNodeData.model_validate(node_data)
                user_inputs = _rebuild_file_for_user_inputs_in_start_node(
                    tenant_id=draft_workflow.tenant_id, start_node_data=start_data, user_inputs=user_inputs
                )
                # init variable pool
                variable_pool = _setup_variable_pool(
                    query=query,
                    files=files or [],
                    user_id=account.id,
                    user_inputs=user_inputs,
                    workflow=draft_workflow,
                    # NOTE(QuantumGhost): We rely on `DraftVarLoader` to load conversation variables.
                    conversation_variables=[],
                    node_type=node_type,
                    conversation_id=conversation_id,
                )

        else:
            variable_pool = VariablePool(
                system_variables=SystemVariable.empty(),
                user_inputs=user_inputs,
                environment_variables=draft_workflow.environment_variables,
                conversation_variables=[],
            )

        variable_loader = DraftVarLoader(
            engine=db.engine,
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
        )

        eclosing_node_type_and_id = draft_workflow.get_enclosing_node_type_and_id(node_config)
        if eclosing_node_type_and_id:
            _, enclosing_node_id = eclosing_node_type_and_id
        else:
            enclosing_node_id = None

        run = WorkflowEntry.single_step_run(
            workflow=draft_workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            user_id=account.id,
            variable_pool=variable_pool,
            variable_loader=variable_loader,
        )

        # run draft workflow node
        start_at = time.perf_counter()
        node_execution = self._handle_node_run_result(
            invoke_node_fn=lambda: run,
            start_at=start_at,
            node_id=node_id,
        )

        # Set workflow_id on the NodeExecution
        node_execution.workflow_id = draft_workflow.id

        # Create repository and save the node execution
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=db.engine,
            user=account,
            app_id=app_model.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(node_execution)

        workflow_node_execution = self._node_execution_service_repo.get_execution_by_id(node_execution.id)
        if workflow_node_execution is None:
            raise ValueError(f"WorkflowNodeExecution with id {node_execution.id} not found after saving")

        with Session(bind=db.engine) as session, session.begin():
            draft_var_saver = DraftVariableSaver(
                session=session,
                app_id=app_model.id,
                node_id=workflow_node_execution.node_id,
                node_type=NodeType(workflow_node_execution.node_type),
                enclosing_node_id=enclosing_node_id,
                node_execution_id=node_execution.id,
            )
            draft_var_saver.save(process_data=node_execution.process_data, outputs=node_execution.outputs)
            session.commit()

        return workflow_node_execution

    def run_free_workflow_node(
        self, node_data: dict, tenant_id: str, user_id: str, node_id: str, user_inputs: dict[str, Any]
    ) -> WorkflowNodeExecution:
        """
        Run draft workflow node
        """
        # run draft workflow node
        start_at = time.perf_counter()

        node_execution = self._handle_node_run_result(
            invoke_node_fn=lambda: WorkflowEntry.run_free_node(
                node_id=node_id,
                node_data=node_data,
                tenant_id=tenant_id,
                user_id=user_id,
                user_inputs=user_inputs,
            ),
            start_at=start_at,
            node_id=node_id,
        )

        return node_execution

    def _handle_node_run_result(
        self,
        invoke_node_fn: Callable[[], tuple[BaseNode, Generator[NodeEvent | InNodeEvent, None, None]]],
        start_at: float,
        node_id: str,
    ) -> WorkflowNodeExecution:
        try:
            node_instance, generator = invoke_node_fn()

            node_run_result: NodeRunResult | None = None
            for event in generator:
                if isinstance(event, RunCompletedEvent):
                    node_run_result = event.run_result

                    # sign output files
                    # node_run_result.outputs = WorkflowEntry.handle_special_values(node_run_result.outputs)
                    break

            if not node_run_result:
                raise ValueError("Node run failed with no run result")
            # single step debug mode error handling return
            if node_run_result.status == WorkflowNodeExecutionStatus.FAILED and node_instance.should_continue_on_error:
                node_error_args: dict[str, Any] = {
                    "status": WorkflowNodeExecutionStatus.EXCEPTION,
                    "error": node_run_result.error,
                    "inputs": node_run_result.inputs,
                    "metadata": {"error_strategy": node_instance.node_data.error_strategy},
                }
                if node_instance.node_data.error_strategy is ErrorStrategy.DEFAULT_VALUE:
                    node_run_result = NodeRunResult(
                        **node_error_args,
                        outputs={
                            **node_instance.node_data.default_value_dict,
                            "error_message": node_run_result.error,
                            "error_type": node_run_result.error_type,
                        },
                    )
                else:
                    node_run_result = NodeRunResult(
                        **node_error_args,
                        outputs={
                            "error_message": node_run_result.error,
                            "error_type": node_run_result.error_type,
                        },
                    )
            run_succeeded = node_run_result.status in (
                WorkflowNodeExecutionStatus.SUCCEEDED,
                WorkflowNodeExecutionStatus.EXCEPTION,
            )
            error = node_run_result.error if not run_succeeded else None
        except WorkflowNodeRunFailedError as e:
            node_instance = e.node_instance
            run_succeeded = False
            node_run_result = None
            error = e.error

        # Create a NodeExecution domain model
        node_execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id="",  # This is a single-step execution, so no workflow ID
            index=1,
            node_id=node_id,
            node_type=node_instance.node_type,
            title=node_instance.node_data.title,
            elapsed_time=time.perf_counter() - start_at,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            finished_at=datetime.now(UTC).replace(tzinfo=None),
        )

        if run_succeeded and node_run_result:
            # Set inputs, process_data, and outputs as dictionaries (not JSON strings)
            inputs = WorkflowEntry.handle_special_values(node_run_result.inputs) if node_run_result.inputs else None
            process_data = (
                WorkflowEntry.handle_special_values(node_run_result.process_data)
                if node_run_result.process_data
                else None
            )
            outputs = node_run_result.outputs

            node_execution.inputs = inputs
            node_execution.process_data = process_data
            node_execution.outputs = outputs
            node_execution.metadata = node_run_result.metadata

            # Map status from WorkflowNodeExecutionStatus to NodeExecutionStatus
            if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
            elif node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION:
                node_execution.status = WorkflowNodeExecutionStatus.EXCEPTION
                node_execution.error = node_run_result.error
        else:
            # Set failed status and error
            node_execution.status = WorkflowNodeExecutionStatus.FAILED
            node_execution.error = error

        return node_execution

    def convert_to_workflow(self, app_model: App, account: Account, args: dict) -> App:
        """
        Basic mode of chatbot app(expert mode) to workflow
        Completion App to Workflow App

        :param app_model: App instance
        :param account: Account instance
        :param args: dict
        :return:
        """
        # chatbot convert to workflow mode
        workflow_converter = WorkflowConverter()

        if app_model.mode not in {AppMode.CHAT.value, AppMode.COMPLETION.value}:
            raise ValueError(f"Current App mode: {app_model.mode} is not supported convert to workflow.")

        # convert to workflow
        new_app: App = workflow_converter.convert_to_workflow(
            app_model=app_model,
            account=account,
            name=args.get("name", "Default Name"),
            icon_type=args.get("icon_type", "emoji"),
            icon=args.get("icon", "🤖"),
            icon_background=args.get("icon_background", "#FFEAD5"),
        )

        return new_app

    def validate_features_structure(self, app_model: App, features: dict) -> dict:
        if app_model.mode == AppMode.ADVANCED_CHAT.value:
            return AdvancedChatAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
            )
        elif app_model.mode == AppMode.WORKFLOW.value:
            return WorkflowAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
            )
        else:
            raise ValueError(f"Invalid app mode: {app_model.mode}")

    def update_workflow(
        self, *, session: Session, workflow_id: str, tenant_id: str, account_id: str, data: dict
    ) -> Optional[Workflow]:
        """
        Update workflow attributes

        :param session: SQLAlchemy database session
        :param workflow_id: Workflow ID
        :param tenant_id: Tenant ID
        :param account_id: Account ID (for permission check)
        :param data: Dictionary containing fields to update
        :return: Updated workflow or None if not found
        """
        stmt = select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
        workflow = session.scalar(stmt)

        if not workflow:
            return None

        allowed_fields = ["marked_name", "marked_comment"]

        for field, value in data.items():
            if field in allowed_fields:
                setattr(workflow, field, value)

        workflow.updated_by = account_id
        workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)

        return workflow

    def delete_workflow(self, *, session: Session, workflow_id: str, tenant_id: str) -> bool:
        """
        Delete a workflow

        :param session: SQLAlchemy database session
        :param workflow_id: Workflow ID
        :param tenant_id: Tenant ID
        :return: True if successful
        :raises: ValueError if workflow not found
        :raises: WorkflowInUseError if workflow is in use
        :raises: DraftWorkflowDeletionError if workflow is a draft version
        """
        stmt = select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
        workflow = session.scalar(stmt)

        if not workflow:
            raise ValueError(f"Workflow with ID {workflow_id} not found")

        # Check if workflow is a draft version
        if workflow.version == "draft":
            raise DraftWorkflowDeletionError("Cannot delete draft workflow versions")

        # Check if this workflow is currently referenced by an app
        app_stmt = select(App).where(App.workflow_id == workflow_id)
        app = session.scalar(app_stmt)
        if app:
            # Cannot delete a workflow that's currently in use by an app
            raise WorkflowInUseError(f"Cannot delete workflow that is currently in use by app '{app.id}'")

        # Don't use workflow.tool_published as it's not accurate for specific workflow versions
        # Check if there's a tool provider using this specific workflow version
        tool_provider = (
            session.query(WorkflowToolProvider)
            .filter(
                WorkflowToolProvider.tenant_id == workflow.tenant_id,
                WorkflowToolProvider.app_id == workflow.app_id,
                WorkflowToolProvider.version == workflow.version,
            )
            .first()
        )

        if tool_provider:
            # Cannot delete a workflow that's published as a tool
            raise WorkflowInUseError("Cannot delete workflow that is published as a tool")

        session.delete(workflow)
        return True


def _setup_variable_pool(
    query: str,
    files: Sequence[File],
    user_id: str,
    user_inputs: Mapping[str, Any],
    workflow: Workflow,
    node_type: NodeType,
    conversation_id: str,
    conversation_variables: list[Variable],
):
    # Only inject system variables for START node type.
    if node_type == NodeType.START:
        system_variable = SystemVariable(
            user_id=user_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            files=files or [],
            workflow_execution_id=str(uuid.uuid4()),
        )

        # Only add chatflow-specific variables for non-workflow types
        if workflow.type != WorkflowType.WORKFLOW.value:
            system_variable.query = query
            system_variable.conversation_id = conversation_id
            system_variable.dialogue_count = 0
    else:
        system_variable = SystemVariable.empty()

    # init variable pool
    variable_pool = VariablePool(
        system_variables=system_variable,
        user_inputs=user_inputs,
        environment_variables=workflow.environment_variables,
        # Based on the definition of `VariableUnion`,
        # `list[Variable]` can be safely used as `list[VariableUnion]` since they are compatible.
        conversation_variables=cast(list[VariableUnion], conversation_variables),  #
    )

    return variable_pool


def _rebuild_file_for_user_inputs_in_start_node(
    tenant_id: str, start_node_data: StartNodeData, user_inputs: Mapping[str, Any]
) -> Mapping[str, Any]:
    inputs_copy = dict(user_inputs)

    for variable in start_node_data.variables:
        if variable.type not in (VariableEntityType.FILE, VariableEntityType.FILE_LIST):
            continue
        if variable.variable not in user_inputs:
            continue
        value = user_inputs[variable.variable]
        file = _rebuild_single_file(tenant_id=tenant_id, value=value, variable_entity_type=variable.type)
        inputs_copy[variable.variable] = file
    return inputs_copy


def _rebuild_single_file(tenant_id: str, value: Any, variable_entity_type: VariableEntityType) -> File | Sequence[File]:
    if variable_entity_type == VariableEntityType.FILE:
        if not isinstance(value, dict):
            raise ValueError(f"expected dict for file object, got {type(value)}")
        return build_from_mapping(mapping=value, tenant_id=tenant_id)
    elif variable_entity_type == VariableEntityType.FILE_LIST:
        if not isinstance(value, list):
            raise ValueError(f"expected list for file list object, got {type(value)}")
        if len(value) == 0:
            return []
        if not isinstance(value[0], dict):
            raise ValueError(f"expected dict for first element in the file list, got {type(value)}")
        return build_from_mappings(mappings=value, tenant_id=tenant_id)
    else:
        raise Exception("unreachable")
