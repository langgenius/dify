import contextvars
import json
import logging
import threading
import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, cast

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfigManager
from core.app.apps.pipeline.pipeline_queue_manager import PipelineQueueManager
from core.app.apps.pipeline.pipeline_runner import PipelineDocumentStore, PipelineRunner
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
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
from core.rag.docstore.dataset_docstore import SegmentAttachmentWriter
from core.repositories.factory import (
    DifyCoreRepositoryFactory,
    WorkflowExecutionRepository,
    WorkflowNodeExecutionRepository,
)
from core.workflow.nodes.knowledge_index.protocols import IndexProcessorProtocol, SummaryIndexServiceProtocol
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from graphon.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import preserve_flask_contexts
from models import Account, EndUser, Workflow, WorkflowNodeExecutionTriggeredFrom
from models.dataset import Document, Pipeline, build_built_in_field_values
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from services.data_source.provider_service import DatasourceProviderService
from services.workflow_draft_variable_service import DraftVarLoader, WorkflowDraftVariableService

if TYPE_CHECKING:
    from core.app.apps.workflow_app_runner import WorkflowRunDriver

logger = logging.getLogger(__name__)


class PipelineGenerator(BaseAppGenerator):
    def __init__(
        self,
        *,
        execution_driver: "WorkflowRunDriver",
        documents: PipelineDocumentStore,
        datasource_providers: DatasourceProviderService,
        attachment_writer: SegmentAttachmentWriter,
    ) -> None:
        self._execution_driver = execution_driver
        self._documents = documents
        self._datasource_providers = datasource_providers
        self._attachment_writer = attachment_writer

    def run(
        self,
        *,
        flask_app: Flask,
        context: contextvars.Context,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        application_generate_entity: RagPipelineGenerateEntity,
        invoke_from: InvokeFrom,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        streaming: bool = True,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
        workflow_thread_pool_id: str | None = None,
        index_processor: IndexProcessorProtocol | None = None,
        summary_index_service: SummaryIndexServiceProtocol | None = None,
        document_failure_handler: Callable[[str], None] | None = None,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]:
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
                    "queue_manager": queue_manager,
                    "application_generate_entity": application_generate_entity,
                    "workflow": workflow,
                    "workflow_thread_pool_id": workflow_thread_pool_id,
                    "variable_loader": variable_loader,
                    "workflow_execution_repository": workflow_execution_repository,
                    "workflow_node_execution_repository": workflow_node_execution_repository,
                    "index_processor": index_processor,
                    "summary_index_service": summary_index_service,
                    "document_failure_handler": document_failure_handler,
                },
            )

            worker_thread.start()

            draft_var_saver_factory = self._get_draft_var_saver_factory(
                invoke_from,
                user,
                tenant_id=pipeline.tenant_id,
            )
            try:
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
            except BaseException:
                self._join_worker_thread(worker_thread)
                raise

            if isinstance(converted_response, Generator):
                return self._wrap_stream_with_worker_thread_join(converted_response, worker_thread)

            self._join_worker_thread(worker_thread)
            return converted_response

    def single_iteration_generate(
        self,
        pipeline: Pipeline,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping[str, Any],
        streaming: bool = True,
        *,
        session: Session,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]:
        """
        Generate App response.

        :param pipeline: Pipeline
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is streamed
        :param session: database session supplied by the caller
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.get("inputs") is None:
            raise ValueError("inputs is required")

        # convert to app config
        pipeline_config = PipelineConfigManager.get_pipeline_config(
            pipeline=pipeline, workflow=workflow, start_node_id=args.get("start_node_id", "shared")
        )

        dataset = self._documents.get_pipeline_dataset(pipeline, session=session)
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
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        draft_var_srv = WorkflowDraftVariableService(session)
        draft_var_srv.prefill_conversation_variable_default_values(workflow, user_id=user.id)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
            user_id=user.id,
        )

        return self.run(
            flask_app=current_app._get_current_object(),  # type: ignore
            pipeline=pipeline,
            workflow=workflow,
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
        *,
        session: Session,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]:
        """
        Generate App response.

        :param pipeline: Pipeline
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is streamed
        :param session: database session supplied by the caller
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.get("inputs") is None:
            raise ValueError("inputs is required")

        dataset = self._documents.get_pipeline_dataset(pipeline, session=session)
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
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            tenant_id=pipeline.tenant_id,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        draft_var_srv = WorkflowDraftVariableService(session)
        draft_var_srv.prefill_conversation_variable_default_values(workflow, user_id=user.id)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
            user_id=user.id,
        )

        return self.run(
            flask_app=current_app._get_current_object(),  # type: ignore
            pipeline=pipeline,
            workflow=workflow,
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
        application_generate_entity: RagPipelineGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        context: contextvars.Context,
        variable_loader: VariableLoader,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        workflow_thread_pool_id: str | None = None,
        index_processor: IndexProcessorProtocol | None = None,
        summary_index_service: SummaryIndexServiceProtocol | None = None,
        document_failure_handler: Callable[[str], None] | None = None,
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
                with Session(db.engine, expire_on_commit=False) as session:
                    # Determine system_user_id based on invocation source
                    is_external_api_call = application_generate_entity.invoke_from in {
                        InvokeFrom.WEB_APP,
                        InvokeFrom.SERVICE_API,
                    }

                    if is_external_api_call:
                        # For external API calls, use end user's session ID
                        end_user = session.scalar(
                            select(EndUser).where(EndUser.id == application_generate_entity.user_id)
                        )
                        system_user_id = end_user.session_id if end_user else ""
                    else:
                        # For internal calls, use the original user ID
                        system_user_id = application_generate_entity.user_id
                    # workflow app
                    runner = PipelineRunner(
                        execution_driver=self._execution_driver,
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        workflow_thread_pool_id=workflow_thread_pool_id,
                        variable_loader=variable_loader,
                        workflow=workflow,
                        system_user_id=system_user_id,
                        documents=self._documents,
                        attachment_writer=self._attachment_writer,
                        index_processor=index_processor,
                        summary_index_service=summary_index_service,
                        document_failure_handler=document_failure_handler,
                    )

                    self._execution_driver(
                        runner, None, workflow_execution_repository, workflow_node_execution_repository
                    )
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
    ) -> WorkflowAppBlockingResponse | WorkflowAppPausedBlockingResponse | Generator[WorkflowAppStreamResponse]:
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
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            stream=stream,
            draft_var_saver_factory=draft_var_saver_factory,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError() from e
            else:
                logger.exception(
                    "Fails to process generate task pipeline, task_id: %r",
                    application_generate_entity.task_id,
                )
                raise e

    def prepare_user_inputs(
        self,
        *,
        user_inputs: Mapping[str, Any] | None,
        variables: Sequence[Any],
        tenant_id: str,
        strict_type_validation: bool = False,
    ) -> Mapping[str, Any]:
        return self._prepare_user_inputs(
            user_inputs=user_inputs,
            variables=variables,
            tenant_id=tenant_id,
            strict_type_validation=strict_type_validation,
        )

    def build_document(
        self,
        tenant_id: str,
        dataset_id: str,
        built_in_field_enabled: bool,
        datasource_type: DatasourceProviderType,
        datasource_info: Mapping[str, Any],
        created_from: str,
        position: int,
        account: Account | EndUser,
        batch: str,
        document_form: str,
    ):
        match datasource_type:
            case DatasourceProviderType.LOCAL_FILE:
                name = datasource_info.get("name", "untitled")
            case DatasourceProviderType.ONLINE_DOCUMENT:
                name = datasource_info.get("page", {}).get("page_name", "untitled")
            case DatasourceProviderType.WEBSITE_CRAWL:
                name = datasource_info.get("title", "untitled")
            case DatasourceProviderType.ONLINE_DRIVE:
                name = datasource_info.get("name", "untitled")
            case _:
                raise ValueError(f"Unsupported datasource type: {datasource_type}")
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=datasource_type,
            data_source_info=json.dumps(datasource_info),
            batch=batch,
            name=name,
            created_from=created_from,
            created_by=account.id,
            doc_form=document_form,
        )
        if built_in_field_enabled:
            now = naive_utc_now()
            document.doc_metadata = build_built_in_field_values(
                document_name=name,
                uploader=account.name,
                upload_date=now,
                last_update_date=now,
                data_source_type=datasource_type,
            )
        return document

    def expand_datasource_info_list(
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

            for datasource_info in datasource_info_list:
                no_credentials = "credential_id" in datasource_info and datasource_info["credential_id"] is None
                credential_id = (
                    None
                    if no_credentials
                    else datasource_info.get("credential_id") or datasource_node_data.get("credential_id")
                )
                datasource_runtime = DatasourceManager.get_datasource_runtime(
                    provider_id=f"{datasource_node_data.get('plugin_id')}/{datasource_node_data.get('provider_name')}",
                    datasource_name=datasource_node_data.get("datasource_name"),
                    tenant_id=pipeline.tenant_id,
                    datasource_type=DatasourceProviderType(datasource_type),
                )
                if no_credentials:
                    datasource_runtime.runtime.credentials = {}
                else:
                    credentials = self._datasource_providers.get_datasource_credentials(
                        tenant_id=pipeline.tenant_id,
                        provider=datasource_node_data.get("provider_name"),
                        plugin_id=datasource_node_data.get("plugin_id"),
                        credential_id=credential_id,
                    )
                    if credentials:
                        datasource_runtime.runtime.credentials = credentials
                datasource_runtime = cast(OnlineDriveDatasourcePlugin, datasource_runtime)
                authorized_info = {**datasource_info, "credential_id": credential_id}
                if datasource_info.get("id") and datasource_info.get("type") == "folder":
                    # get all files in the folder
                    self._get_files_in_folder(
                        datasource_runtime,
                        datasource_info.get("id", ""),
                        datasource_info.get("bucket", None),
                        user.id,
                        all_files,
                        authorized_info,
                        None,
                    )
                else:
                    all_files.append(
                        {
                            "id": datasource_info.get("id", ""),
                            "name": datasource_info.get("name", "untitled"),
                            "bucket": datasource_info.get("bucket", None),
                            "credential_id": credential_id,
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

        page_parameters = next_page_parameters
        seen_page_parameters: set[str] = set()
        while True:
            page_key = json.dumps(page_parameters, sort_keys=True, default=str)
            if page_key in seen_page_parameters:
                return
            seen_page_parameters.add(page_key)

            result_generator = datasource_runtime.online_drive_browse_files(
                user_id=user_id,
                request=OnlineDriveBrowseFilesRequest(
                    bucket=bucket,
                    prefix=prefix,
                    max_keys=20,
                    next_page_parameters=page_parameters,
                ),
                provider_type=datasource_runtime.datasource_provider_type(),
            )
            is_truncated = False
            has_files = False
            next_parameters: dict[str, Any] | None = None
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
                                    "credential_id": datasource_info.get("credential_id"),
                                }
                            )
                    is_truncated = files.is_truncated
                    next_parameters = files.next_page_parameters

            # A provider that claims truncation without returning files or a
            # next cursor cannot make progress and must not spin forever.
            if not is_truncated or not has_files or next_parameters is None:
                return
            page_parameters = next_parameters
