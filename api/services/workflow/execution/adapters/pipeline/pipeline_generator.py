import contextvars
import json
import logging
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Generator, Mapping
from typing import Any, Literal, cast, overload

from flask import Flask, current_app
from pydantic import ValidationError

import contexts
from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.app.entities.task_entities import (
    WorkflowAppBlockingResponse,
    WorkflowAppPausedBlockingResponse,
    WorkflowAppStreamResponse,
)
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
)
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.entities.knowledge_entities import PipelineDataset, PipelineDocument
from core.repositories.factory import (
    WorkflowExecutionRepository,
    WorkflowNodeExecutionRepository,
)
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from graphon.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from libs.flask_utils import preserve_flask_contexts
from models import Account, EndUser, Workflow, WorkflowNodeExecutionTriggeredFrom
from models.dataset import Document, Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.pipeline_execution import PipelineDocumentStore
from services.app.generation.input_adapter import AppInputAdapter
from services.data_source.provider_service import DatasourceProviderService
from services.rag_pipeline.document_preparation import prepare_pipeline_document
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from services.workflow.execution.adapters.pipeline.pipeline_config_manager import PipelineConfigManager
from services.workflow.execution.adapters.pipeline.pipeline_queue_manager import PipelineQueueManager
from services.workflow.execution.adapters.pipeline.pipeline_runner import PipelineRunner
from services.workflow.execution.adapters.workflow.generate_response_converter import (
    WorkflowAppGenerateResponseConverter,
)
from services.workflow.execution.adapters.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from services.workflow.execution.generation_service import generate_response
from services.workflow.execution.ports import WorkflowRuntime

logger = logging.getLogger(__name__)


class PipelineGenerator(AppInputAdapter):
    def __init__(
        self,
        *,
        runtime: WorkflowRuntime,
        documents: PipelineDocumentStore,
        datasource_providers: DatasourceProviderService,
        draft_variable_loader: Callable[[Workflow, str], VariableLoader] | None = None,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
    ) -> None:
        self._runtime = runtime
        super().__init__(
            draft_variable_loader=draft_variable_loader,
            draft_variable_saver=draft_variable_saver,
        )
        self._documents = documents
        self._datasource_providers = datasource_providers

    def load_workflow(self, pipeline: Pipeline, invoke_from: InvokeFrom) -> Workflow:
        return self._runtime.contexts.pipeline_workflow(
            tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id, draft=invoke_from == InvokeFrom.DEBUGGER
        )

    @overload
    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[True],
        call_depth: int,
        workflow_thread_pool_id: str | None,
        is_retry: bool = False,
    ) -> Generator[Mapping | str, None, None]: ...

    @overload
    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
        call_depth: int,
        workflow_thread_pool_id: str | None,
        is_retry: bool = False,
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        call_depth: int,
        workflow_thread_pool_id: str | None,
        is_retry: bool = False,
    ) -> Mapping[str, Any] | Generator[Mapping | str, None, None]: ...

    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        call_depth: int = 0,
        workflow_thread_pool_id: str | None = None,
        is_retry: bool = False,
    ) -> Mapping[str, Any] | Generator[Mapping | str, None, None] | None:
        # Add null check for dataset

        dataset = self._runtime.contexts.pipeline_dataset(tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id)
        if not dataset:
            raise ValueError("Pipeline dataset is required")
        inputs: Mapping[str, Any] = args["inputs"]
        start_node_id: str = args["start_node_id"]
        datasource_type = DatasourceProviderType(args["datasource_type"])
        datasource_info_list: list[Mapping[str, Any]] = self._format_datasource_info_list(
            datasource_type, args["datasource_info_list"], pipeline, workflow, start_node_id, user
        )
        batch = time.strftime("%Y%m%d%H%M%S") + str(secrets.randbelow(900000) + 100000)
        # convert to app config
        pipeline_config = PipelineConfigManager.get_pipeline_config(
            pipeline=pipeline, workflow=workflow, start_node_id=start_node_id
        )
        documents: list[Document] = []
        if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry and not args.get("original_document_id"):
            from services.feature_service import FeatureService
            from services.knowledge.dataset_service import DocumentService

            features = FeatureService.get_features(pipeline.tenant_id)
            DocumentService.check_document_creation_limits(len(datasource_info_list), features)

        document_seeds = (
            [
                prepare_pipeline_document(
                    built_in_field_enabled=dataset.built_in_field_enabled,
                    datasource_type=datasource_type,
                    datasource_info=source,
                    uploader_name=user.name or "",
                )
                for source in datasource_info_list
            ]
            if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry
            else []
        )

        # run in child thread
        rag_pipeline_invoke_entities = []
        for i, datasource_info in enumerate(datasource_info_list):
            workflow_run_id = str(uuid.uuid4())
            document_id = args.get("original_document_id") or None
            if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry:
                document_id = document_id or document_seeds[i].id
            application_generate_entity = RagPipelineGenerateEntity(
                task_id=str(uuid.uuid4()),
                app_config=pipeline_config,
                pipeline_config=pipeline_config,
                datasource_type=datasource_type,
                datasource_info=datasource_info,
                dataset_id=dataset.id,
                original_document_id=None if is_retry else args.get("original_document_id"),
                start_node_id=start_node_id,
                batch=batch,
                document_id=document_id,
                inputs=self._prepare_user_inputs(
                    user_inputs=inputs,
                    variables=pipeline_config.rag_pipeline_variables,
                    tenant_id=pipeline.tenant_id,
                    strict_type_validation=True if invoke_from == InvokeFrom.SERVICE_API else False,
                ),
                files=[],
                user_id=user.id,
                stream=streaming,
                invoke_from=invoke_from,
                call_depth=call_depth,
                workflow_execution_id=workflow_run_id,
            )

            contexts.plugin_tool_providers.set({})
            contexts.plugin_tool_providers_lock.set(threading.Lock())
            if invoke_from == InvokeFrom.DEBUGGER:
                workflow_triggered_from = WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING
            else:
                workflow_triggered_from = WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN
            # Create workflow node execution repository
            workflow_execution_repository = self._runtime.execution_writer(
                tenant_id=pipeline.tenant_id,
                user=user,
                app_id=application_generate_entity.app_config.app_id,
                triggered_from=workflow_triggered_from,
            )

            workflow_node_execution_repository = self._runtime.node_writer(
                tenant_id=pipeline.tenant_id,
                user=user,
                app_id=application_generate_entity.app_config.app_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
            )
            if invoke_from == InvokeFrom.DEBUGGER or is_retry:
                return self._generate(
                    flask_app=current_app._get_current_object(),  # type: ignore
                    context=contextvars.copy_context(),
                    pipeline=pipeline,
                    workflow_id=workflow.id,
                    user=user,
                    application_generate_entity=application_generate_entity,
                    invoke_from=invoke_from,
                    workflow_execution_repository=workflow_execution_repository,
                    workflow_node_execution_repository=workflow_node_execution_repository,
                    streaming=streaming,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                )
            else:
                rag_pipeline_invoke_entities.append(
                    RagPipelineInvokeEntity(
                        pipeline_id=pipeline.id,
                        user_id=user.id,
                        tenant_id=pipeline.tenant_id,
                        workflow_id=workflow.id,
                        streaming=streaming,
                        workflow_execution_id=workflow_run_id,
                        workflow_thread_pool_id=workflow_thread_pool_id,
                        application_generate_entity=application_generate_entity.model_dump(),
                    )
                )

        if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry:
            documents = self._documents.prepare_pipeline_documents(
                tenant_id=pipeline.tenant_id,
                pipeline_id=pipeline.id,
                dataset_id=dataset.id,
                user_id=user.id,
                batch=batch,
                start_node_id=start_node_id,
                inputs=inputs,
                seeds=document_seeds,
                original_document_id=args.get("original_document_id"),
            )
        if rag_pipeline_invoke_entities:
            RagPipelineTaskProxy(dataset.tenant_id, user.id, rag_pipeline_invoke_entities).delay()
        # return batch, dataset, documents
        return {
            "batch": batch,
            "dataset": PipelineDataset(
                id=dataset.id,
                name=dataset.name,
                description=dataset.description,
                chunk_structure=dataset.chunk_structure,
            ).model_dump(),
            "documents": [
                PipelineDocument(
                    id=document.id,
                    position=document.position,
                    data_source_type=document.data_source_type,
                    data_source_info=json.loads(document.data_source_info) if document.data_source_info else None,
                    name=document.name,
                    indexing_status=document.indexing_status,
                    error=document.error,
                    enabled=document.enabled,
                ).model_dump()
                for document in documents
            ],
        }

    def _generate(
        self,
        *,
        flask_app: Flask,
        context: contextvars.Context,
        pipeline: Pipeline,
        workflow_id: str,
        user: Account | EndUser,
        application_generate_entity: RagPipelineGenerateEntity,
        invoke_from: InvokeFrom,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        streaming: bool = True,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
        workflow_thread_pool_id: str | None = None,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
        """
        Generate App response.

        :param pipeline: Pipeline
        :param workflow: Workflow
        :param user: account or end user
        :param application_generate_entity: application generate entity
        :param invoke_from: invoke from source
        :param workflow_execution_repository: repository for workflow execution
        :param workflow_node_execution_repository: repository for workflow node execution
        :param streaming: is stream
        :param workflow_thread_pool_id: workflow thread pool id
        """
        with preserve_flask_contexts(flask_app, context_vars=context):
            # init queue manager
            workflow = self._runtime.contexts.workflow(
                tenant_id=pipeline.tenant_id, app_id=pipeline.id, workflow_id=workflow_id
            )
            if not workflow:
                raise ValueError(f"Workflow not found: {workflow_id}")
            queue_manager = PipelineQueueManager(
                task_id=application_generate_entity.task_id,
                user_id=application_generate_entity.user_id,
                invoke_from=application_generate_entity.invoke_from,
                app_mode=AppMode.RAG_PIPELINE,
            )
            context = contextvars.copy_context()

            # new thread
            worker_thread = threading.Thread(
                target=self._generate_worker,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
                    "context": context,
                    "system_user_id": user.id if isinstance(user, Account) else user.session_id or "",
                    "queue_manager": queue_manager,
                    "application_generate_entity": application_generate_entity,
                    "workflow_thread_pool_id": workflow_thread_pool_id,
                    "variable_loader": variable_loader,
                    "workflow_execution_repository": workflow_execution_repository,
                    "workflow_node_execution_repository": workflow_node_execution_repository,
                },
            )

            draft_var_saver_factory = self._get_draft_var_saver_factory(
                invoke_from,
                user,
                tenant_id=pipeline.tenant_id,
            )

            def respond():
                response = self._handle_response(
                    application_generate_entity=application_generate_entity,
                    workflow=workflow,
                    queue_manager=queue_manager,
                    user=user,
                    stream=streaming,
                    draft_var_saver_factory=draft_var_saver_factory,
                )
                converted_response = WorkflowAppGenerateResponseConverter.convert(
                    response=response,
                    invoke_from=invoke_from,
                )
                return converted_response

            return generate_response(worker=worker_thread, respond=respond)

    def single_iteration_generate(
        self,
        pipeline: Pipeline,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping[str, Any],
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
        """
        Generate App response.

        :param pipeline: Pipeline
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is streamed
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.get("inputs") is None:
            raise ValueError("inputs is required")

        # convert to app config
        pipeline_config = PipelineConfigManager.get_pipeline_config(
            pipeline=pipeline, workflow=workflow, start_node_id=args.get("start_node_id", "shared")
        )

        dataset = self._runtime.contexts.pipeline_dataset(tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id)
        if not dataset:
            raise ValueError("Pipeline dataset is required")

        # init application generate entity - use RagPipelineGenerateEntity instead
        application_generate_entity = RagPipelineGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=pipeline_config,
            pipeline_config=pipeline_config,
            datasource_type=args.get("datasource_type", ""),
            datasource_info=args.get("datasource_info", {}),
            dataset_id=dataset.id,
            batch=args.get("batch", ""),
            document_id=args.get("document_id"),
            inputs={},
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
            workflow_execution_id=str(uuid.uuid4()),
            single_iteration_run=RagPipelineGenerateEntity.SingleIterationRunEntity(
                node_id=node_id, inputs=args["inputs"]
            ),
        )
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())
        # Create workflow node execution repository

        workflow_execution_repository = self._runtime.execution_writer(
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = self._runtime.node_writer(
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        if self._draft_variable_loader is None:
            raise ValueError("Draft variable loader is required for debugging")
        var_loader = self._draft_variable_loader(workflow, user.id)

        return self._generate(
            flask_app=current_app._get_current_object(),  # type: ignore
            pipeline=pipeline,
            workflow_id=workflow.id,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
            variable_loader=var_loader,
            context=contextvars.copy_context(),
        )

    def single_loop_generate(
        self,
        pipeline: Pipeline,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping[str, Any],
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
        """
        Generate App response.

        :param pipeline: Pipeline
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is streamed
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.get("inputs") is None:
            raise ValueError("inputs is required")

        dataset = self._runtime.contexts.pipeline_dataset(tenant_id=pipeline.tenant_id, pipeline_id=pipeline.id)
        if not dataset:
            raise ValueError("Pipeline dataset is required")

        # convert to app config
        pipeline_config = PipelineConfigManager.get_pipeline_config(
            pipeline=pipeline, workflow=workflow, start_node_id=args.get("start_node_id", "shared")
        )

        # init application generate entity
        application_generate_entity = RagPipelineGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=pipeline_config,
            pipeline_config=pipeline_config,
            datasource_type=args.get("datasource_type", ""),
            datasource_info=args.get("datasource_info", {}),
            batch=args.get("batch", ""),
            document_id=args.get("document_id"),
            dataset_id=dataset.id,
            inputs={},
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={"auto_generate_conversation_name": False},
            single_loop_run=RagPipelineGenerateEntity.SingleLoopRunEntity(node_id=node_id, inputs=args["inputs"]),
            workflow_execution_id=str(uuid.uuid4()),
        )
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create workflow node execution repository

        workflow_execution_repository = self._runtime.execution_writer(
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = self._runtime.node_writer(
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        if self._draft_variable_loader is None:
            raise ValueError("Draft variable loader is required for debugging")
        var_loader = self._draft_variable_loader(workflow, user.id)

        return self._generate(
            flask_app=current_app._get_current_object(),  # type: ignore
            pipeline=pipeline,
            workflow_id=workflow.id,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
            variable_loader=var_loader,
            context=contextvars.copy_context(),
        )

    def _generate_worker(
        self,
        flask_app: Flask,
        system_user_id: str,
        application_generate_entity: RagPipelineGenerateEntity,
        queue_manager: AppQueueManager,
        context: contextvars.Context,
        variable_loader: VariableLoader,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        workflow_thread_pool_id: str | None = None,
    ) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        :return:
        """

        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                config = application_generate_entity.app_config
                workflow = self._runtime.contexts.workflow(
                    tenant_id=config.tenant_id,
                    app_id=config.app_id,
                    workflow_id=config.workflow_id,
                )
                runner = PipelineRunner(
                    application_generate_entity=application_generate_entity,
                    queue_manager=queue_manager,
                    variable_loader=variable_loader,
                    workflow=workflow,
                    system_user_id=system_user_id,
                    workflow_execution_repository=workflow_execution_repository,
                    workflow_node_execution_repository=workflow_node_execution_repository,
                    documents=self._documents,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                    runtime=self._runtime,
                    draft_variable_saver=self._draft_variable_saver,
                )
                runner.run()
            except GenerateTaskStoppedError:
                pass
            except InvokeAuthorizationError:
                queue_manager.publish_error(
                    InvokeAuthorizationError("Incorrect API key provided"), PublishFrom.APPLICATION_MANAGER
                )
            except ValidationError as e:
                logger.exception("Validation Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except ValueError as e:
                if dify_config.DEBUG:
                    logger.exception("Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)

    def _handle_response(
        self,
        application_generate_entity: RagPipelineGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Account | EndUser,
        draft_var_saver_factory: DraftVariableSaverFactory,
        stream: bool = False,
    ) -> (
        WorkflowAppBlockingResponse
        | WorkflowAppPausedBlockingResponse
        | Generator[WorkflowAppStreamResponse, None, None]
    ):
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param user: account or end user
        :param stream: is stream
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = WorkflowAppGenerateTaskPipeline(
            logs=self._runtime.logs,
            contexts=self._runtime.contexts,
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            stream=stream,
            draft_var_saver_factory=draft_var_saver_factory,
            tool_providers=self._runtime.tool_providers,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError()
            else:
                logger.exception(
                    "Fails to process generate task pipeline, task_id: %r",
                    application_generate_entity.task_id,
                )
                raise e

    def _format_datasource_info_list(
        self,
        datasource_type: DatasourceProviderType,
        datasource_info_list: list[Mapping[str, Any]],
        pipeline: Pipeline,
        workflow: Workflow,
        start_node_id: str,
        user: Account | EndUser,
    ) -> list[Mapping[str, Any]]:
        """
        Format datasource info list.
        """
        if datasource_type == DatasourceProviderType.ONLINE_DRIVE:
            all_files: list[Mapping[str, Any]] = []
            datasource_node_data = None
            datasource_nodes = workflow.graph_dict.get("nodes", [])
            for datasource_node in datasource_nodes:
                if datasource_node.get("id") == start_node_id:
                    datasource_node_data = datasource_node.get("data", {})
                    break
            if not datasource_node_data:
                raise ValueError("Datasource node data not found")

            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=f"{datasource_node_data.get('plugin_id')}/{datasource_node_data.get('provider_name')}",
                datasource_name=datasource_node_data.get("datasource_name"),
                tenant_id=pipeline.tenant_id,
                datasource_type=DatasourceProviderType(datasource_type),
            )
            credentials = self._datasource_providers.get_datasource_credentials(
                tenant_id=pipeline.tenant_id,
                provider=datasource_node_data.get("provider_name"),
                plugin_id=datasource_node_data.get("plugin_id"),
                credential_id=datasource_node_data.get("credential_id"),
            )
            if credentials:
                datasource_runtime.runtime.credentials = credentials
            datasource_runtime = cast(OnlineDriveDatasourcePlugin, datasource_runtime)

            for datasource_info in datasource_info_list:
                if datasource_info.get("id") and datasource_info.get("type") == "folder":
                    # get all files in the folder
                    self._get_files_in_folder(
                        datasource_runtime,
                        datasource_info.get("id", ""),
                        datasource_info.get("bucket", None),
                        user.id,
                        all_files,
                        datasource_info,
                        None,
                    )
                else:
                    all_files.append(
                        {
                            "id": datasource_info.get("id", ""),
                            "name": datasource_info.get("name", "untitled"),
                            "bucket": datasource_info.get("bucket", None),
                        }
                    )
            return all_files
        else:
            return datasource_info_list

    def _get_files_in_folder(
        self,
        datasource_runtime: OnlineDriveDatasourcePlugin,
        prefix: str,
        bucket: str | None,
        user_id: str,
        all_files: list,
        datasource_info: Mapping[str, Any],
        next_page_parameters: dict[str, Any] | None = None,
        _visited_folder_ids: set[str] | None = None,
    ):
        """
        Get files in a folder.

        Recursively lists all files inside the given folder prefix.
        ``_visited_folder_ids`` tracks folders already expanded so that a
        self-referencing folder (where the API returns the folder as its own
        child) cannot cause infinite recursion.
        """
        if _visited_folder_ids is None:
            _visited_folder_ids = set()

        # Guard: skip folders we have already expanded to prevent infinite
        # recursion from self-referencing folder entries in the API response.
        if prefix in _visited_folder_ids:
            return
        _visited_folder_ids.add(prefix)

        result_generator = datasource_runtime.online_drive_browse_files(
            user_id=user_id,
            request=OnlineDriveBrowseFilesRequest(
                bucket=bucket,
                prefix=prefix,
                max_keys=20,
                next_page_parameters=next_page_parameters,
            ),
            provider_type=datasource_runtime.datasource_provider_type(),
        )
        is_truncated = False
        has_files = False
        for result in result_generator:
            for files in result.result:
                for file in files.files:
                    has_files = True
                    if file.type == "folder":
                        if file.id in _visited_folder_ids:
                            continue
                        self._get_files_in_folder(
                            datasource_runtime,
                            file.id,
                            bucket,
                            user_id,
                            all_files,
                            datasource_info,
                            None,
                            _visited_folder_ids,
                        )
                    else:
                        all_files.append(
                            {
                                "id": file.id,
                                "name": file.name,
                                "bucket": bucket,
                            }
                        )
                is_truncated = files.is_truncated
                next_page_parameters = files.next_page_parameters

        # Guard: only follow pagination when the API actually returned files.
        # An empty folder that incorrectly reports ``is_truncated=True`` would
        # otherwise recurse forever on the same empty page.
        if is_truncated and has_files:
            self._get_files_in_folder(
                datasource_runtime,
                prefix,
                bucket,
                user_id,
                all_files,
                datasource_info,
                next_page_parameters,
                _visited_folder_ids,
            )
