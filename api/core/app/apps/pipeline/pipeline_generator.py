import contextvars
import datetime
import json
import logging
import secrets
import threading
import time
import uuid
from collections.abc import Generator, Mapping
from typing import Any, Literal, Union, cast, overload

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfigManager
from core.app.apps.pipeline.pipeline_queue_manager import PipelineQueueManager
from core.app.apps.pipeline.pipeline_runner import PipelineRunner
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.app.entities.task_entities import WorkflowAppBlockingResponse, WorkflowAppStreamResponse
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
)
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.entities.knowledge_entities import PipelineDataset, PipelineDocument
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.repositories.factory import DifyCoreRepositoryFactory
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from extensions.ext_database import db
from libs.flask_utils import preserve_flask_contexts
from models import Account, EndUser, Workflow, WorkflowNodeExecutionTriggeredFrom
from models.dataset import Document, DocumentPipelineExecutionLog, Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from services.datasource_provider_service import DatasourceProviderService
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from services.workflow_draft_variable_service import DraftVarLoader, WorkflowDraftVariableService

logger = logging.getLogger(__name__)


class PipelineGenerator(BaseAppGenerator):
    @overload
    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Union[Account, EndUser],
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
        user: Union[Account, EndUser],
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
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        call_depth: int,
        workflow_thread_pool_id: str | None,
        is_retry: bool = False,
    ) -> Union[Mapping[str, Any], Generator[Mapping | str, None, None]]: ...

    def generate(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        call_depth: int = 0,
        workflow_thread_pool_id: str | None = None,
        is_retry: bool = False,
    ) -> Union[Mapping[str, Any], Generator[Mapping | str, None, None], None]:
        # Add null check for dataset

        with Session(db.engine, expire_on_commit=False) as session:
            dataset = pipeline.retrieve_dataset(session)
            if not dataset:
                raise ValueError("Pipeline dataset is required")
        inputs: Mapping[str, Any] = args["inputs"]
        start_node_id: str = args["start_node_id"]
        datasource_type: str = args["datasource_type"]
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
            from services.dataset_service import DocumentService

            for datasource_info in datasource_info_list:
                position = DocumentService.get_documents_position(dataset.id)
                document = self._build_document(
                    tenant_id=pipeline.tenant_id,
                    dataset_id=dataset.id,
                    built_in_field_enabled=dataset.built_in_field_enabled,
                    datasource_type=datasource_type,
                    datasource_info=datasource_info,
                    created_from="rag-pipeline",
                    position=position,
                    account=user,
                    batch=batch,
                    document_form=dataset.chunk_structure,
                )
                db.session.add(document)
                documents.append(document)
            db.session.commit()

        # run in child thread
        rag_pipeline_invoke_entities = []
        for i, datasource_info in enumerate(datasource_info_list):
            workflow_run_id = str(uuid.uuid4())
            document_id = args.get("original_document_id") or None
            if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry:
                document_id = document_id or documents[i].id
                document_pipeline_execution_log = DocumentPipelineExecutionLog(
                    document_id=document_id,
                    datasource_type=datasource_type,
                    datasource_info=json.dumps(datasource_info),
                    datasource_node_id=start_node_id,
                    input_data=dict(inputs),
                    pipeline_id=pipeline.id,
                    created_by=user.id,
                )
                db.session.add(document_pipeline_execution_log)
                db.session.commit()
            application_generate_entity = RagPipelineGenerateEntity(
                task_id=str(uuid.uuid4()),
                app_config=pipeline_config,
                pipeline_config=pipeline_config,
                datasource_type=datasource_type,
                datasource_info=datasource_info,
                dataset_id=dataset.id,
                original_document_id=args.get("original_document_id"),
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
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
            workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=session_factory,
                user=user,
                app_id=application_generate_entity.app_config.app_id,
                triggered_from=workflow_triggered_from,
            )

            workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=session_factory,
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
        user: Union[Account, EndUser],
        application_generate_entity: RagPipelineGenerateEntity,
        invoke_from: InvokeFrom,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        streaming: bool = True,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
        workflow_thread_pool_id: str | None = None,
    ) -> Union[Mapping[str, Any], Generator[str | Mapping[str, Any], None, None]]:
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
            workflow = db.session.query(Workflow).where(Workflow.id == workflow_id).first()
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
                    "queue_manager": queue_manager,
                    "application_generate_entity": application_generate_entity,
                    "workflow_thread_pool_id": workflow_thread_pool_id,
                    "variable_loader": variable_loader,
                    "workflow_execution_repository": workflow_execution_repository,
                    "workflow_node_execution_repository": workflow_node_execution_repository,
                },
            )

            worker_thread.start()

            draft_var_saver_factory = self._get_draft_var_saver_factory(
                invoke_from,
                user,
            )
            # return response or stream generator
            response = self._handle_response(
                application_generate_entity=application_generate_entity,
                workflow=workflow,
                queue_manager=queue_manager,
                user=user,
                stream=streaming,
                draft_var_saver_factory=draft_var_saver_factory,
            )

            return WorkflowAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

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

        :param app_model: App
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

        with Session(db.engine) as session:
            dataset = pipeline.retrieve_dataset(session)
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
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )

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

        :param app_model: App
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

        with Session(db.engine) as session:
            dataset = pipeline.retrieve_dataset(session)
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
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        )

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )

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
                with Session(db.engine, expire_on_commit=False) as session:
                    workflow = session.scalar(
                        select(Workflow).where(
                            Workflow.tenant_id == application_generate_entity.app_config.tenant_id,
                            Workflow.app_id == application_generate_entity.app_config.app_id,
                            Workflow.id == application_generate_entity.app_config.workflow_id,
                        )
                    )
                    if workflow is None:
                        raise ValueError("Workflow not found")

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
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        workflow_thread_pool_id=workflow_thread_pool_id,
                        variable_loader=variable_loader,
                        workflow=workflow,
                        system_user_id=system_user_id,
                        workflow_execution_repository=workflow_execution_repository,
                        workflow_node_execution_repository=workflow_node_execution_repository,
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
            finally:
                db.session.close()

    def _handle_response(
        self,
        application_generate_entity: RagPipelineGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        draft_var_saver_factory: DraftVariableSaverFactory,
        stream: bool = False,
    ) -> Union[WorkflowAppBlockingResponse, Generator[WorkflowAppStreamResponse, None, None]]:
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
                raise GenerateTaskStoppedError()
            else:
                logger.exception(
                    "Fails to process generate task pipeline, task_id: %r",
                    application_generate_entity.task_id,
                )
                raise e

    def _build_document(
        self,
        tenant_id: str,
        dataset_id: str,
        built_in_field_enabled: bool,
        datasource_type: str,
        datasource_info: Mapping[str, Any],
        created_from: str,
        position: int,
        account: Union[Account, EndUser],
        batch: str,
        document_form: str,
    ):
        if datasource_type == "local_file":
            name = datasource_info.get("name", "untitled")
        elif datasource_type == "online_document":
            name = datasource_info.get("page", {}).get("page_name", "untitled")
        elif datasource_type == "website_crawl":
            name = datasource_info.get("title", "untitled")
        elif datasource_type == "online_drive":
            name = datasource_info.get("name", "untitled")
        else:
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
        doc_metadata = {}
        if built_in_field_enabled:
            doc_metadata = {
                BuiltInField.document_name: name,
                BuiltInField.uploader: account.name,
                BuiltInField.upload_date: datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S"),
                BuiltInField.last_update_date: datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S"),
                BuiltInField.source: datasource_type,
            }
        if doc_metadata:
            document.doc_metadata = doc_metadata
        return document

    def _format_datasource_info_list(
        self,
        datasource_type: str,
        datasource_info_list: list[Mapping[str, Any]],
        pipeline: Pipeline,
        workflow: Workflow,
        start_node_id: str,
        user: Union[Account, EndUser],
    ) -> list[Mapping[str, Any]]:
        """
        Format datasource info list.
        """
        if datasource_type == "online_drive":
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
            datasource_provider_service = DatasourceProviderService()
            credentials = datasource_provider_service.get_datasource_credentials(
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
        next_page_parameters: dict | None = None,
    ):
        """
        Get files in a folder.
        """
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
        for result in result_generator:
            for files in result.result:
                for file in files.files:
                    if file.type == "folder":
                        self._get_files_in_folder(
                            datasource_runtime,
                            file.id,
                            bucket,
                            user_id,
                            all_files,
                            datasource_info,
                            None,
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

        if is_truncated:
            self._get_files_in_folder(
                datasource_runtime, prefix, bucket, user_id, all_files, datasource_info, next_page_parameters
            )
