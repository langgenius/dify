import json
import time
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Optional

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.segments import Variable
from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.node_mapping import node_classes
from core.workflow.workflow_entry import WorkflowEntry
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from extensions.ext_database import db
from models.account import Account
from models.model import App, AppMode
from models.workflow import (
    CreatedByRole,
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowType,
)
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.workflow_converter import WorkflowConverter


class WorkflowService:
    """
    Workflow Service
    """

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
            workflow.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables

        # commit db session changes
        db.session.commit()

        # trigger app workflow events
        app_draft_workflow_was_synced.send(app_model, synced_draft_workflow=workflow)

        # return draft workflow
        return workflow

    def publish_workflow(self, app_model: App, account: Account, draft_workflow: Optional[Workflow] = None) -> Workflow:
        """
        Publish workflow from draft

        :param app_model: App instance
        :param account: Account instance
        :param draft_workflow: Workflow instance
        """
        if not draft_workflow:
            # fetch draft workflow by app_model
            draft_workflow = self.get_draft_workflow(app_model=app_model)

        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        # create new workflow
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=draft_workflow.type,
            version=str(datetime.now(timezone.utc).replace(tzinfo=None)),
            graph=draft_workflow.graph,
            features=draft_workflow.features,
            created_by=account.id,
            environment_variables=draft_workflow.environment_variables,
            conversation_variables=draft_workflow.conversation_variables,
        )

        # commit db session changes
        db.session.add(workflow)
        db.session.flush()
        db.session.commit()

        app_model.workflow_id = workflow.id
        db.session.commit()

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
        for node_type, node_class in node_classes.items():
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
        node_type_enum: NodeType = NodeType.value_of(node_type)

        # return default block config
        node_class = node_classes.get(node_type_enum)
        if not node_class:
            return None

        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return None

        return default_config

    def run_draft_workflow_node(
        self, app_model: App, node_id: str, user_inputs: dict, account: Account
    ) -> WorkflowNodeExecution:
        """
        Run draft workflow node
        """
        # fetch draft workflow by app_model
        draft_workflow = self.get_draft_workflow(app_model=app_model)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()

        try:
            node_instance, generator = WorkflowEntry.single_step_run(
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs=user_inputs,
                user_id=account.id,
            )

            node_run_result: NodeRunResult | None = None
            for event in generator:
                if isinstance(event, RunCompletedEvent):
                    node_run_result = event.run_result

                    # sign output files
                    node_run_result.outputs = WorkflowEntry.handle_special_values(node_run_result.outputs)
                    break

            if not node_run_result:
                raise ValueError("Node run failed with no run result")

            run_succeeded = True if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED else False
            error = node_run_result.error if not run_succeeded else None
        except WorkflowNodeRunFailedError as e:
            node_instance = e.node_instance
            run_succeeded = False
            node_run_result = None
            error = e.error

        workflow_node_execution = WorkflowNodeExecution()
        workflow_node_execution.tenant_id = app_model.tenant_id
        workflow_node_execution.app_id = app_model.id
        workflow_node_execution.workflow_id = draft_workflow.id
        workflow_node_execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value
        workflow_node_execution.index = 1
        workflow_node_execution.node_id = node_id
        workflow_node_execution.node_type = node_instance.node_type.value
        workflow_node_execution.title = node_instance.node_data.title
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.created_by_role = CreatedByRole.ACCOUNT.value
        workflow_node_execution.created_by = account.id
        workflow_node_execution.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        if run_succeeded and node_run_result:
            # create workflow node execution
            workflow_node_execution.inputs = json.dumps(node_run_result.inputs) if node_run_result.inputs else None
            workflow_node_execution.process_data = (
                json.dumps(node_run_result.process_data) if node_run_result.process_data else None
            )
            workflow_node_execution.outputs = (
                json.dumps(jsonable_encoder(node_run_result.outputs)) if node_run_result.outputs else None
            )
            workflow_node_execution.execution_metadata = (
                json.dumps(jsonable_encoder(node_run_result.metadata)) if node_run_result.metadata else None
            )
            workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        else:
            # create workflow node execution
            workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
            workflow_node_execution.error = error

        db.session.add(workflow_node_execution)
        db.session.commit()

        return workflow_node_execution

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
        new_app = workflow_converter.convert_to_workflow(
            app_model=app_model,
            account=account,
            name=args.get("name"),
            icon_type=args.get("icon_type"),
            icon=args.get("icon"),
            icon_background=args.get("icon_background"),
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
