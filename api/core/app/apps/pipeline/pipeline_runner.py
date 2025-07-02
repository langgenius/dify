import logging
from collections.abc import Mapping
from typing import Any, Optional, cast

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    RagPipelineGenerateEntity,
)
from core.variables.variables import RAGPipelineVariable, RAGPipelineVariableInput
from core.workflow.callbacks import WorkflowCallback, WorkflowLoggingCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from models.dataset import Pipeline
from models.enums import UserFrom
from models.model import EndUser
from models.workflow import Workflow, WorkflowType

logger = logging.getLogger(__name__)


class PipelineRunner(WorkflowBasedAppRunner):
    """
    Pipeline Application Runner
    """

    def __init__(
        self,
        application_generate_entity: RagPipelineGenerateEntity,
        queue_manager: AppQueueManager,
        workflow_thread_pool_id: Optional[str] = None,
    ) -> None:
        """
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        """
        self.application_generate_entity = application_generate_entity
        self.queue_manager = queue_manager
        self.workflow_thread_pool_id = workflow_thread_pool_id

    def _get_app_id(self) -> str:
        return self.application_generate_entity.app_config.app_id

    def run(self) -> None:
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(PipelineConfig, app_config)

        user_id = None
        if self.application_generate_entity.invoke_from in {InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API}:
            end_user = db.session.query(EndUser).filter(EndUser.id == self.application_generate_entity.user_id).first()
            if end_user:
                user_id = end_user.session_id
        else:
            user_id = self.application_generate_entity.user_id

        pipeline = db.session.query(Pipeline).filter(Pipeline.id == app_config.app_id).first()
        if not pipeline:
            raise ValueError("Pipeline not found")

        workflow = self.get_workflow(pipeline=pipeline, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")

        db.session.close()

        workflow_callbacks: list[WorkflowCallback] = []
        if dify_config.DEBUG:
            workflow_callbacks.append(WorkflowLoggingCallback())

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run:
            # if only single iteration run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=workflow,
                node_id=self.application_generate_entity.single_iteration_run.node_id,
                user_inputs=self.application_generate_entity.single_iteration_run.inputs,
            )
        elif self.application_generate_entity.single_loop_run:
            # if only single loop run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_loop(
                workflow=workflow,
                node_id=self.application_generate_entity.single_loop_run.node_id,
                user_inputs=self.application_generate_entity.single_loop_run.inputs,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.
            system_inputs = {
                SystemVariableKey.FILES: files,
                SystemVariableKey.USER_ID: user_id,
                SystemVariableKey.APP_ID: app_config.app_id,
                SystemVariableKey.WORKFLOW_ID: app_config.workflow_id,
                SystemVariableKey.WORKFLOW_EXECUTION_ID: self.application_generate_entity.workflow_execution_id,
                SystemVariableKey.DOCUMENT_ID: self.application_generate_entity.document_id,
                SystemVariableKey.BATCH: self.application_generate_entity.batch,
                SystemVariableKey.DATASET_ID: self.application_generate_entity.dataset_id,
                SystemVariableKey.DATASOURCE_TYPE: self.application_generate_entity.datasource_type,
                SystemVariableKey.DATASOURCE_INFO: self.application_generate_entity.datasource_info,
                SystemVariableKey.INVOKE_FROM: self.application_generate_entity.invoke_from.value,
            }
            rag_pipeline_variables = []
            if workflow.rag_pipeline_variables:
                for v in workflow.rag_pipeline_variables:
                    rag_pipeline_variable = RAGPipelineVariable(**v)
                    if (
                        rag_pipeline_variable.belong_to_node_id
                        in (self.application_generate_entity.start_node_id, "shared")
                    ) and rag_pipeline_variable.variable in inputs:
                        rag_pipeline_variables.append(
                            RAGPipelineVariableInput(
                                variable=rag_pipeline_variable,
                                value=inputs[rag_pipeline_variable.variable],
                            )
                        )

            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=workflow.environment_variables,
                conversation_variables=[],
                rag_pipeline_variables=rag_pipeline_variables,
            )

            # init graph
            graph = self._init_rag_pipeline_graph(
                graph_config=workflow.graph_dict,
                start_node_id=self.application_generate_entity.start_node_id,
            )

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            workflow_type=WorkflowType.value_of(workflow.type),
            graph=graph,
            graph_config=workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=(
                UserFrom.ACCOUNT
                if self.application_generate_entity.invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                else UserFrom.END_USER
            ),
            invoke_from=self.application_generate_entity.invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            thread_pool_id=self.workflow_thread_pool_id,
        )

        generator = workflow_entry.run(callbacks=workflow_callbacks)

        for event in generator:
            self._handle_event(workflow_entry, event)

    def get_workflow(self, pipeline: Pipeline, workflow_id: str) -> Optional[Workflow]:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == pipeline.tenant_id, Workflow.app_id == pipeline.id, Workflow.id == workflow_id
            )
            .first()
        )

        # return workflow
        return workflow

    def _init_rag_pipeline_graph(self, graph_config: Mapping[str, Any], start_node_id: Optional[str] = None) -> Graph:
        """
        Init pipeline graph
        """
        if "nodes" not in graph_config or "edges" not in graph_config:
            raise ValueError("nodes or edges not found in workflow graph")

        if not isinstance(graph_config.get("nodes"), list):
            raise ValueError("nodes in workflow graph must be a list")

        if not isinstance(graph_config.get("edges"), list):
            raise ValueError("edges in workflow graph must be a list")
        nodes = graph_config.get("nodes", [])
        edges = graph_config.get("edges", [])
        real_run_nodes = []
        real_edges = []
        exclude_node_ids = []
        for node in nodes:
            node_id = node.get("id")
            node_type = node.get("data", {}).get("type", "")
            if node_type == "datasource":
                if start_node_id != node_id:
                    exclude_node_ids.append(node_id)
                    continue
            real_run_nodes.append(node)
        for edge in edges:
            if edge.get("source") in exclude_node_ids:
                continue
            real_edges.append(edge)
        graph_config = dict(graph_config)
        graph_config["nodes"] = real_run_nodes
        graph_config["edges"] = real_edges
        # init graph
        graph = Graph.init(graph_config=graph_config)

        if not graph:
            raise ValueError("graph not found in workflow")

        return graph
