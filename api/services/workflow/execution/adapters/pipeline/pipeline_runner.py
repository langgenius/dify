import logging
import time
from collections.abc import Callable
from typing import cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    RagPipelineGenerateEntity,
    UserFrom,
)
from core.credit_usage import CreditUsageAppType
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from graphon.enums import WorkflowType
from graphon.graph import Graph
from graphon.graph_events import GraphEngineEvent, GraphRunFailedEvent
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variable_loader import VariableLoader
from graphon.variables.variables import RAGPipelineVariable, RAGPipelineVariableInput
from models import Account
from models.pipeline_execution import PipelineDocumentStore
from models.workflow import Workflow
from services.workflow.execution.adapters.events import WorkflowEventPublisher
from services.workflow.execution.adapters.graph import WorkflowGraphBuilder
from services.workflow.execution.adapters.node_factory import get_default_root_node_id
from services.workflow.execution.adapters.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow.execution.adapters.pipeline.pipeline_config_manager import PipelineConfig
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.execution.ports import WorkflowRuntime

logger = logging.getLogger(__name__)


class PipelineRunner:
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
        documents: PipelineDocumentStore,
        workflow_thread_pool_id: str | None = None,
        *,
        runtime: WorkflowRuntime,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
    ) -> None:
        """
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        """
        self._runtime = runtime
        self._graphs = WorkflowGraphBuilder(
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
            draft_variable_saver=draft_variable_saver,
            agent_binding_resolver=runtime.agent_bindings,
            workflow_runtime=runtime,
        )
        self._queue_manager = queue_manager
        self._events = WorkflowEventPublisher(
            queue_manager, resolve_pause=runtime.resolve_pause, notify_pause=runtime.notify_pause
        )
        self._draft_variable_saver = draft_variable_saver
        self.application_generate_entity = application_generate_entity
        self.workflow_thread_pool_id = workflow_thread_pool_id
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository
        self._documents = documents

    def run(self) -> None:
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(PipelineConfig, app_config)
        invoke_from = self.application_generate_entity.invoke_from

        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            invoke_from = InvokeFrom.DEBUGGER

        user_from = self._graphs.resolve_user_from(invoke_from)

        user_id = self._sys_user_id
        workflow = self._workflow
        dataset = self._runtime.contexts.pipeline_dataset(tenant_id=app_config.tenant_id, pipeline_id=app_config.app_id)
        if dataset.id != self.application_generate_entity.dataset_id:
            raise ValueError("Pipeline dataset not found")
        dataset_workspace_id, dataset_id = dataset.tenant_id, dataset.id
        document_id = self.application_generate_entity.document_id
        original_document_id = self.application_generate_entity.original_document_id
        for candidate_id in {document_id, original_document_id}:
            if not candidate_id:
                continue
            if not self._documents.exists(
                workspace_id=dataset_workspace_id, dataset_id=dataset_id, document_id=candidate_id
            ):
                raise ValueError("Pipeline document not found")

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            # Handle single iteration or single loop run
            graph, variable_pool, graph_runtime_state = self._graphs.build_single_node(
                workflow=workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
                user_id=self.application_generate_entity.user_id,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.
            system_inputs = build_system_variables(
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
                invoke_from=invoke_from.value,
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

            variable_pool = VariablePool()
            add_variables_to_pool(
                variable_pool,
                build_bootstrap_variables(
                    system_variables=system_inputs,
                    environment_variables=workflow.environment_variables,
                    rag_pipeline_variables=rag_pipeline_variables,
                ),
            )
            root_node_id = self.application_generate_entity.start_node_id or get_default_root_node_id(
                workflow.graph_dict
            )
            add_node_inputs_to_pool(variable_pool, node_id=root_node_id, inputs=inputs)
            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

            # init graph
            graph = self._init_rag_pipeline_graph(
                graph_runtime_state=graph_runtime_state,
                start_node_id=root_node_id,
                workflow=workflow,
                user_from=user_from,
                invoke_from=invoke_from,
            )

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            human_form_reader=self._runtime.human_form_reader,
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            graph=graph,
            graph_config=workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=invoke_from,
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
                event,
                workspace_id=dataset_workspace_id,
                dataset_id=dataset_id,
                document_id=document_id,
            )
            self._events.publish(workflow_entry, event)

    def _init_rag_pipeline_graph(
        self,
        workflow: Workflow,
        graph_runtime_state: GraphRuntimeState,
        start_node_id: str | None = None,
        user_from: UserFrom = UserFrom.ACCOUNT,
        invoke_from: InvokeFrom = InvokeFrom.SERVICE_API,
    ) -> Graph:
        """
        Init pipeline graph
        """
        return self._graphs.build(
            graph_config=workflow.graph_dict,
            graph_runtime_state=graph_runtime_state,
            workflow_id=workflow.id,
            tenant_id=workflow.tenant_id,
            user_id=self.application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            root_node_id=start_node_id,
            app_type=CreditUsageAppType.RAG_PIPELINE,
        )

    def _update_document_status(
        self,
        event: GraphEngineEvent,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str | None,
    ) -> None:
        """Set an owner-bound document to error after a failed graph run, if it exists."""
        if not isinstance(event, GraphRunFailedEvent) or document_id is None:
            return

        self._documents.mark_failed(
            workspace_id=workspace_id,
            dataset_id=dataset_id,
            document_id=document_id,
            error=event.error or "Unknown error",
        )
