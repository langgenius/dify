import logging
import time
from typing import cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    RagPipelineGenerateEntity,
)
from core.variables.variables import RAGPipelineVariable, RAGPipelineVariableInput
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.enums import WorkflowType
from core.workflow.graph import Graph
from core.workflow.graph_engine.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.graph_events import GraphEngineEvent, GraphRunFailedEvent
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from models.dataset import Document, Pipeline
from models.enums import UserFrom
from models.model import EndUser
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class PipelineRunner(WorkflowBasedAppRunner):
    """
    Pipeline Application Runner
    """

    def __init__(
        self,
        application_generate_entity: RagPipelineGenerateEntity,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        workflow_thread_pool_id: str | None = None,
    ) -> None:
        """
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        """
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
        )
        self.application_generate_entity = application_generate_entity
        self.workflow_thread_pool_id = workflow_thread_pool_id
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

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
            end_user = db.session.query(EndUser).where(EndUser.id == self.application_generate_entity.user_id).first()
            if end_user:
                user_id = end_user.session_id
        else:
            user_id = self.application_generate_entity.user_id

        pipeline = db.session.query(Pipeline).where(Pipeline.id == app_config.app_id).first()
        if not pipeline:
            raise ValueError("Pipeline not found")

        workflow = self.get_workflow(pipeline=pipeline, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")

        db.session.close()

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            # Handle single iteration or single loop run
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.
            system_inputs = SystemVariable(
                files=files,
                user_id=user_id,
                app_id=app_config.app_id,
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_execution_id,
                document_id=self.application_generate_entity.document_id,
                original_document_id=self.application_generate_entity.original_document_id,
                batch=self.application_generate_entity.batch,
                dataset_id=self.application_generate_entity.dataset_id,
                datasource_type=self.application_generate_entity.datasource_type,
                datasource_info=self.application_generate_entity.datasource_info,
                invoke_from=self.application_generate_entity.invoke_from.value,
            )

            rag_pipeline_variables = []
            if workflow.rag_pipeline_variables:
                for v in workflow.rag_pipeline_variables:
                    rag_pipeline_variable = RAGPipelineVariable.model_validate(v)
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
            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

            # init graph
            graph = self._init_rag_pipeline_graph(
                graph_runtime_state=graph_runtime_state,
                start_node_id=self.application_generate_entity.start_node_id,
                workflow=workflow,
            )

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
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
            graph_runtime_state=graph_runtime_state,
            variable_pool=variable_pool,
        )

        self._queue_manager.graph_runtime_state = graph_runtime_state

        persistence_layer = WorkflowPersistenceLayer(
            application_generate_entity=self.application_generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=workflow.id,
                workflow_type=WorkflowType(workflow.type),
                version=workflow.version,
                graph_data=workflow.graph_dict,
            ),
            workflow_execution_repository=self._workflow_execution_repository,
            workflow_node_execution_repository=self._workflow_node_execution_repository,
            trace_manager=self.application_generate_entity.trace_manager,
        )

        workflow_entry.graph_engine.layer(persistence_layer)

        generator = workflow_entry.run()

        for event in generator:
            self._update_document_status(
                event, self.application_generate_entity.document_id, self.application_generate_entity.dataset_id
            )
            self._handle_event(workflow_entry, event)

    def get_workflow(self, pipeline: Pipeline, workflow_id: str) -> Workflow | None:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .where(Workflow.tenant_id == pipeline.tenant_id, Workflow.app_id == pipeline.id, Workflow.id == workflow_id)
            .first()
        )

        # return workflow
        return workflow

    def _init_rag_pipeline_graph(
        self, workflow: Workflow, graph_runtime_state: GraphRuntimeState, start_node_id: str | None = None
    ) -> Graph:
        """
        Init pipeline graph
        """
        graph_config = workflow.graph_dict
        if "nodes" not in graph_config or "edges" not in graph_config:
            raise ValueError("nodes or edges not found in workflow graph")

        if not isinstance(graph_config.get("nodes"), list):
            raise ValueError("nodes in workflow graph must be a list")

        if not isinstance(graph_config.get("edges"), list):
            raise ValueError("edges in workflow graph must be a list")
        # nodes = graph_config.get("nodes", [])
        # edges = graph_config.get("edges", [])
        # real_run_nodes = []
        # real_edges = []
        # exclude_node_ids = []
        # for node in nodes:
        #     node_id = node.get("id")
        #     node_type = node.get("data", {}).get("type", "")
        #     if node_type == "datasource":
        #         if start_node_id != node_id:
        #             exclude_node_ids.append(node_id)
        #             continue
        #     real_run_nodes.append(node)

        # for edge in edges:
        #     if edge.get("source") in exclude_node_ids:
        #         continue
        #     real_edges.append(edge)
        # graph_config = dict(graph_config)
        # graph_config["nodes"] = real_run_nodes
        # graph_config["edges"] = real_edges
        # init graph
        # Create required parameters for Graph.init
        graph_init_params = GraphInitParams(
            tenant_id=workflow.tenant_id,
            app_id=self._app_id,
            workflow_id=workflow.id,
            graph_config=graph_config,
            user_id=self.application_generate_entity.user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        )

        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id=start_node_id)

        if not graph:
            raise ValueError("graph not found in workflow")

        return graph

    def _update_document_status(self, event: GraphEngineEvent, document_id: str | None, dataset_id: str | None) -> None:
        """
        Update document status
        """
        if isinstance(event, GraphRunFailedEvent):
            if document_id and dataset_id:
                document = (
                    db.session.query(Document)
                    .where(Document.id == document_id, Document.dataset_id == dataset_id)
                    .first()
                )
                if document:
                    document.indexing_status = "error"
                    document.error = event.error or "Unknown error"
                    db.session.add(document)
                    db.session.commit()
