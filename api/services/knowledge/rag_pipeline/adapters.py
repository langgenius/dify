"""Runtime and persistence adapters for Service API knowledge pipelines."""

import contextvars
import json
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Generator, Iterable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Any, Protocol, cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.local import LocalProxy

import contexts
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfigManager
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.entities.knowledge_entities import PipelineDataset, PipelineDocument
from core.rag.entities import DatasourceErrorEvent
from core.repositories.factory import DifyCoreRepositoryFactory
from core.workflow.llm_environment_variable import validate_llm_environment_model_references
from core.workflow.nodes.knowledge_index.protocols import IndexProcessorProtocol, SummaryIndexServiceProtocol
from machinery.context import RequestContext
from models import Account, Workflow
from models.dataset import Document, Pipeline
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from repositories.knowledge.dataset_read_repository import (
    get_dataset_for_tenant,
)
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.pipeline_query_repository import get_pipeline_dataset
from repositories.knowledge.rag_pipeline_repository import SQLAlchemyRagPipelineRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from services.credentials.query import CredentialQuery, DatasourceCredentialListItem
from services.data_source.credential_gateway import (
    ActorDatasourceCredentialResolver,
    DatasourceCredentialNotFoundError,
)
from services.entities.dsl_entities import ImportMode
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, KnowledgeConfiguration
from services.errors.app import WorkflowHashNotEqualError
from services.file_service import FileService, FileUploadActor
from services.knowledge.datasets.contracts import (
    DatasetConcurrentUpdateError,
    PreparedRagPipelineDatasetUpdate,
    RagPipelineDatasetSettings,
)
from services.knowledge.documents.contracts import DocumentCreationEnvironment, DocumentPersistenceNotFoundError
from services.knowledge.documents.creation import check_document_creation_limits
from services.knowledge.entities.pipeline_workflows import (
    DatasourceNodeRun,
    PipelineFileUpload,
    PipelineInvocationScope,
    PipelineRun,
    PipelineUploadedFile,
    PreparedDatasourceWorkflowNode,
)
from services.knowledge.indexing.adapters.execution import PipelineIndexProcessor, PipelineSummaryIndexDispatcher
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.rag_pipeline.application import (
    PipelineActorNotFoundError,
    PipelineConfigurationError,
    PipelineDatasetNotFoundError,
    PipelineNotFoundError,
    PreparedPipelineWorkflow,
    PreparedWorkflowPublication,
    ResolvedDatasourceCredential,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.rag_pipeline.entities import RagPipelineInvokeEntity, RagPipelineWorkflowSnapshot
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from services.rag_pipeline.rag_pipeline_transform_service import RagPipelineTransformService
from services.rag_pipeline.workflow_snapshot import capture_workflow, restore_workflow


def _datasource_error_events(message: str) -> Generator[Mapping[str, Any]]:
    yield DatasourceErrorEvent(error=message).model_dump()


class PipelineDatasetSettingsWriter(Protocol):
    def stage_rag_pipeline_dataset_settings(
        self,
        session: Session,
        *,
        change: PreparedRagPipelineDatasetUpdate,
    ) -> bool: ...


def datasource_provider_requires_credentials(
    workspace_id: str,
    provider: str,
    plugin_id: str,
    datasource_type: str,
) -> bool:
    controller = DatasourceManager.get_datasource_plugin_provider(
        provider_id=f"{plugin_id}/{provider}",
        tenant_id=workspace_id,
        datasource_type=DatasourceProviderType(datasource_type),
    )
    oauth_schema = controller.entity.oauth_schema
    return controller.need_credentials or (oauth_schema is not None and bool(oauth_schema.credentials_schema))


@contextmanager
def _session_scope(sessions: sessionmaker[Session]) -> Generator[Session]:
    with sessions() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


@dataclass(frozen=True, slots=True)
class PreparedPipelineRun:
    execute: Callable[[], Any]


class SQLAlchemyPipelineRunPreparer:
    """Own pipeline run persistence and execution-repository assembly."""

    def __init__(self, *, session_factory: sessionmaker[Session], generator: PipelineGenerator) -> None:
        self._sessions = session_factory
        self._generator = generator
        self._pipelines = SQLAlchemyRagPipelineRepository()

    def get_workflow(self, pipeline: Pipeline, invoke_from: InvokeFrom, session: Session) -> Workflow:
        workflow = self._pipelines.get_workflow(
            session,
            pipeline=pipeline,
            published=invoke_from != InvokeFrom.DEBUGGER,
        )
        if workflow is None:
            message = "Workflow not initialized" if invoke_from == InvokeFrom.DEBUGGER else "Workflow not published"
            raise ValueError(message)
        return workflow

    @staticmethod
    def snapshot_workflow(workflow: Workflow) -> Workflow:
        return restore_workflow(capture_workflow(workflow))

    def expand_datasource_info_list(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        require_explicit_credentials: bool = False,
    ) -> list[Mapping[str, Any]]:
        datasource_type = DatasourceProviderType(args["datasource_type"])
        datasource_info_list = args["datasource_info_list"]
        if require_explicit_credentials and datasource_type in {
            DatasourceProviderType.ONLINE_DOCUMENT,
            DatasourceProviderType.ONLINE_DRIVE,
        }:
            if any(
                not isinstance(item, Mapping)
                or not isinstance(item.get("credential_id"), str)
                or not item["credential_id"]
                for item in datasource_info_list
            ):
                raise ValueError("Datasource credential ID is required")
        return self._generator.expand_datasource_info_list(
            datasource_type,
            datasource_info_list,
            pipeline,
            workflow,
            args["start_node_id"],
            user,
        )

    def prepare(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        datasource_info_list: list[Mapping[str, Any]],
        document_creation_environment: DocumentCreationEnvironment | None,
    ) -> PreparedPipelineRun:
        indexing_generation: str | None = None
        if original_document_id := args.get("original_document_id"):
            dataset = get_pipeline_dataset(pipeline, session)
            if dataset is None or dataset.tenant_id != pipeline.tenant_id:
                raise ValueError("Pipeline dataset is required")
            documents = SQLAlchemyDocumentRepository(
                session_factory=self._sessions,
                wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
            )
            try:
                indexing_generation = documents.prepare_pipeline_reindexing(
                    session,
                    DatasetRef(dataset.tenant_id, dataset.id).document(original_document_id),
                )
            except DocumentPersistenceNotFoundError as error:
                raise ValueError("Pipeline document not found") from error
        return self._prepare(
            session=session,
            pipeline=pipeline,
            workflow=workflow,
            user=user,
            args=args,
            invoke_from=invoke_from,
            streaming=streaming,
            call_depth=0,
            workflow_thread_pool_id=None,
            datasource_info_list=datasource_info_list,
            document_creation_environment=document_creation_environment,
            indexing_generation=indexing_generation,
        )

    def prepare_retry(
        self,
        document: Document,
        user: Account | EndUser,
        *,
        session: Session,
        execution: DocumentIndexingExecution,
    ) -> PreparedPipelineRun:
        if document.indexing_generation is None:
            raise ValueError("Document indexing generation not found")
        retry_state = self._pipelines.get_retry_state(
            session,
            tenant_id=document.tenant_id,
            dataset_id=document.dataset_id,
            document_id=document.id,
            indexing_generation=document.indexing_generation,
        )
        if retry_state is None:
            raise ValueError("Document pipeline execution log not found")
        pipeline = retry_state.pipeline
        workflow = self.snapshot_workflow(retry_state.workflow)
        datasource_info = retry_state.datasource_info
        ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
        documents = SQLAlchemyDocumentRepository(
            session_factory=self._sessions,
            wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        )
        index_processor = PipelineIndexProcessor(
            execution=execution,
            attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            documents=documents,
            repair_stale_execution=partial(
                documents.enqueue_current_indexing_repairs,
                ref.dataset,
                [ref.document_id],
                actor_id=user.id,
            ),
        )
        return self._prepare(
            session=session,
            pipeline=pipeline,
            workflow=workflow,
            user=user,
            args={
                "inputs": retry_state.input_data,
                "start_node_id": retry_state.datasource_node_id,
                "datasource_type": retry_state.datasource_type,
                "datasource_info_list": [datasource_info],
                "original_document_id": document.id,
            },
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
            call_depth=0,
            workflow_thread_pool_id=None,
            datasource_info_list=[datasource_info],
            document_creation_environment=None,
            is_retry=True,
            index_processor=index_processor,
            summary_index_service=PipelineSummaryIndexDispatcher(
                documents=documents,
                ref=ref,
                execution=execution,
            ),
            document_failure_handler=partial(documents.fail_indexing, ref, execution=execution),
        )

    def _prepare(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        call_depth: int,
        workflow_thread_pool_id: str | None,
        datasource_info_list: list[Mapping[str, Any]],
        document_creation_environment: DocumentCreationEnvironment | None,
        is_retry: bool = False,
        index_processor: IndexProcessorProtocol | None = None,
        summary_index_service: SummaryIndexServiceProtocol | None = None,
        document_failure_handler: Callable[[str], None] | None = None,
        indexing_generation: str | None = None,
    ) -> PreparedPipelineRun:
        dataset = get_pipeline_dataset(pipeline, session)
        if dataset is None:
            raise ValueError("Pipeline dataset is required")
        inputs: Mapping[str, Any] = args["inputs"]
        start_node_id: str = args["start_node_id"]
        datasource_type = DatasourceProviderType(args["datasource_type"])
        batch = time.strftime("%Y%m%d%H%M%S") + str(secrets.randbelow(900000) + 100000)
        pipeline_config = PipelineConfigManager.get_pipeline_config(
            pipeline=pipeline, workflow=workflow, start_node_id=start_node_id
        )
        documents: list[Document] = []
        if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry and not args.get("original_document_id"):
            if document_creation_environment is None:
                raise ValueError("Document creation environment is required")
            check_document_creation_limits(len(datasource_info_list), document_creation_environment.limits)
            locked_dataset = self._pipelines.lock_pipeline_dataset(session, pipeline=pipeline)
            if locked_dataset is None:
                raise ValueError("Pipeline dataset is no longer available")
            dataset = locked_dataset
            first_position = self._pipelines.next_document_position(session, dataset=dataset)
            for offset, datasource_info in enumerate(datasource_info_list):
                document = self._generator.build_document(
                    tenant_id=pipeline.tenant_id,
                    dataset_id=dataset.id,
                    built_in_field_enabled=dataset.built_in_field_enabled,
                    datasource_type=datasource_type,
                    datasource_info=datasource_info,
                    created_from="rag-pipeline",
                    position=first_position + offset,
                    account=user,
                    batch=batch,
                    document_form=dataset.chunk_structure,
                )
                document.indexing_generation = str(uuid.uuid4())
                documents.append(document)
            self._pipelines.persist_documents(
                session,
                dataset=dataset,
                documents=documents,
                datasource_type=datasource_type.value,
                datasource_info_list=datasource_info_list,
            )

        invoke_entities: list[RagPipelineInvokeEntity] = []
        workflow_snapshot = capture_workflow(workflow)
        deferred_run: Callable[[], Any] | None = None
        for index, datasource_info in enumerate(datasource_info_list):
            workflow_run_id = str(uuid.uuid4())
            document_id = args.get("original_document_id") or None
            document_generation: str | None = None
            if invoke_from == InvokeFrom.PUBLISHED_PIPELINE and not is_retry:
                document_id = document_id or documents[index].id
                document_generation = indexing_generation or documents[index].indexing_generation
                if document_generation is None:
                    raise ValueError("Published pipeline document indexing generation is required")
                self._pipelines.stage_execution_log(
                    session,
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=document_id,
                    indexing_generation=document_generation,
                    datasource_type=datasource_type.value,
                    datasource_info=datasource_info,
                    datasource_node_id=start_node_id,
                    input_data=inputs,
                    pipeline_id=pipeline.id,
                    actor_id=user.id,
                )
            entity = RagPipelineGenerateEntity(
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
                inputs=self._generator.prepare_user_inputs(
                    user_inputs=inputs,
                    variables=pipeline_config.rag_pipeline_variables,
                    tenant_id=pipeline.tenant_id,
                    strict_type_validation=invoke_from == InvokeFrom.SERVICE_API,
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
            triggered_from = (
                WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING
                if invoke_from == InvokeFrom.DEBUGGER
                else WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN
            )
            execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=self._sessions,
                tenant_id=pipeline.tenant_id,
                user=user,
                app_id=entity.app_config.app_id,
                triggered_from=triggered_from,
            )
            node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=self._sessions,
                tenant_id=pipeline.tenant_id,
                user=user,
                app_id=entity.app_config.app_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
            )
            if invoke_from == InvokeFrom.DEBUGGER or is_retry:
                deferred_run = partial(
                    self._generator.run,
                    flask_app=cast("LocalProxy[Flask]", current_app)._get_current_object(),
                    context=contextvars.copy_context(),
                    pipeline=pipeline,
                    workflow=workflow,
                    user=user,
                    application_generate_entity=entity,
                    invoke_from=invoke_from,
                    workflow_execution_repository=execution_repository,
                    workflow_node_execution_repository=node_execution_repository,
                    streaming=streaming,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                    index_processor=index_processor,
                    summary_index_service=summary_index_service,
                    document_failure_handler=document_failure_handler,
                )
                break
            invoke_entities.append(
                RagPipelineInvokeEntity(
                    pipeline_id=pipeline.id,
                    user_id=user.id,
                    tenant_id=pipeline.tenant_id,
                    workflow_id=workflow.id,
                    streaming=streaming,
                    workflow_execution_id=workflow_run_id,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                    application_generate_entity=entity.model_dump(),
                    indexing_generation=document_generation,
                )
            )

        if deferred_run is not None:
            return PreparedPipelineRun(deferred_run)

        response = {
            "batch": batch,
            "dataset": PipelineDataset(
                id=dataset.id,
                name=dataset.name,
                description=dataset.description or "",
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

        def dispatch() -> Mapping[str, Any]:
            if invoke_entities:
                RagPipelineTaskProxy(
                    dataset.tenant_id,
                    user.id,
                    invoke_entities,
                    workflow_snapshot=workflow_snapshot,
                ).delay()
            return response

        return PreparedPipelineRun(dispatch)

    @staticmethod
    def execute(prepared: PreparedPipelineRun) -> Mapping[str, Any] | Iterable[str]:
        return PipelineGenerator.convert_to_event_stream(prepared.execute())


class SQLAlchemyPipelineWorkflowOperations:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        generator: PipelineGenerator,
        files: FileService,
        file_size_limit: Callable[[str], int],
        document_creation_environment: Callable[[str], DocumentCreationEnvironment],
        dataset_settings_writer: PipelineDatasetSettingsWriter,
        pipelines: SQLAlchemyRagPipelineRepository | None = None,
    ) -> None:
        self._sessions = session_factory
        self._files = files
        self._file_size_limit = file_size_limit
        self._document_creation_environment = document_creation_environment
        self._dataset_settings_writer = dataset_settings_writer
        self._pipelines = pipelines or SQLAlchemyRagPipelineRepository()
        self._run_preparer = SQLAlchemyPipelineRunPreparer(
            session_factory=session_factory,
            generator=generator,
        )

    def get_pipeline_dataset_id(self, scope: PipelineInvocationScope) -> str:
        if scope.pipeline_id is None:
            raise TypeError("A pipeline ID is required")
        with _session_scope(self._sessions) as session:
            dataset_id = self._pipelines.get_pipeline_dataset_id(
                session,
                tenant_id=scope.workspace_id,
                pipeline_id=scope.pipeline_id,
            )
        if dataset_id is None:
            raise PipelineDatasetNotFoundError()
        return dataset_id

    def _pipeline(self, session: Session, scope: PipelineInvocationScope) -> Pipeline:
        if scope.dataset_id is not None:
            try:
                return self._pipelines.get_pipeline_for_dataset(
                    session,
                    tenant_id=scope.workspace_id,
                    dataset_id=scope.dataset_id,
                )
            except ValueError as error:
                if str(error) == "Dataset not found":
                    raise PipelineDatasetNotFoundError() from error
                if str(error) == "Pipeline not found":
                    raise PipelineNotFoundError() from error
                raise
        pipeline = self._pipelines.get_pipeline(
            session,
            tenant_id=scope.workspace_id,
            pipeline_id=cast(str, scope.pipeline_id),
        )
        if pipeline is None:
            raise PipelineNotFoundError()
        return pipeline

    def _load_actor(self, session: Session, *, workspace_id: str, actor_id: str) -> Account:
        account = self._pipelines.get_actor(session, tenant_id=workspace_id, actor_id=actor_id)
        if account is None:
            raise PipelineActorNotFoundError()
        return account

    def _actor(self, session: Session, scope: PipelineInvocationScope) -> Account:
        return self._load_actor(
            session,
            workspace_id=scope.workspace_id,
            actor_id=scope.actor_id,
        )

    def list_datasource_plugin_specs(
        self, scope: PipelineInvocationScope, *, is_published: bool
    ) -> Sequence[Mapping[str, Any]]:
        with _session_scope(self._sessions) as session:
            pipeline = self._pipeline(session, scope)
            try:
                workflow = self._run_preparer.get_workflow(
                    pipeline,
                    InvokeFrom.PUBLISHED_PIPELINE if is_published else InvokeFrom.DEBUGGER,
                    session,
                )
            except ValueError as error:
                raise PipelineNotFoundError() from error
            snapshot = self._run_preparer.snapshot_workflow(workflow)
            return RagPipelineService.datasource_plugin_specs(snapshot)

    def prepare_pipeline(
        self,
        scope: PipelineInvocationScope,
        *,
        command: PipelineRun,
    ) -> "_SQLAlchemyPreparedPipelineWorkflow":
        invoke_from = InvokeFrom.PUBLISHED_PIPELINE if command.is_published else InvokeFrom.DEBUGGER
        with _session_scope(self._sessions) as session:
            pipeline = self._pipeline(session, scope)
            actor = self._actor(session, scope)
            try:
                workflow = self._run_preparer.get_workflow(pipeline, invoke_from, session)
            except ValueError as error:
                raise PipelineConfigurationError(str(error)) from error
            workflow_snapshot = self._run_preparer.snapshot_workflow(workflow)
            datasource_plugin_specs = tuple(RagPipelineService.datasource_plugin_specs(workflow_snapshot))
            return _SQLAlchemyPreparedPipelineWorkflow(
                scope=scope,
                pipeline=pipeline,
                workflow=workflow_snapshot,
                actor=actor,
                invoke_from=invoke_from,
                datasource_plugin_specs=datasource_plugin_specs,
            )

    def run_prepared_pipeline(
        self,
        prepared: PreparedPipelineWorkflow,
        *,
        command: PipelineRun,
    ) -> Mapping[str, Any] | Iterable[str]:
        if not isinstance(prepared, _SQLAlchemyPreparedPipelineWorkflow):
            raise TypeError("Unsupported pipeline preparation")
        requested_datasource_info = command.values.get("datasource_info_list")
        credentials_pinned = (
            isinstance(requested_datasource_info, list)
            and bool(requested_datasource_info)
            and all(
                isinstance(item, Mapping) and isinstance(item.get("credential_id"), str) and bool(item["credential_id"])
                for item in requested_datasource_info
            )
        )
        try:
            datasource_info_list = self._run_preparer.expand_datasource_info_list(
                pipeline=prepared.pipeline,
                workflow=prepared.workflow,
                user=prepared.actor,
                args=command.values,
                require_explicit_credentials=credentials_pinned,
            )
        except ValueError as error:
            raise PipelineConfigurationError(str(error)) from error
        document_creation_environment = None
        if command.is_published and not command.values.get("original_document_id"):
            document_creation_environment = self._document_creation_environment(prepared.scope.workspace_id)
        with _session_scope(self._sessions) as session:
            pipeline = self._pipelines.get_pipeline(
                session,
                tenant_id=prepared.scope.workspace_id,
                pipeline_id=prepared.pipeline.id,
            )
            if pipeline is None:
                raise PipelineNotFoundError()
            actor = self._actor(session, prepared.scope)
            try:
                runtime = self._run_preparer.prepare(
                    session=session,
                    pipeline=pipeline,
                    workflow=prepared.workflow,
                    user=actor,
                    args=command.values,
                    invoke_from=prepared.invoke_from,
                    streaming=command.streaming,
                    datasource_info_list=datasource_info_list,
                    document_creation_environment=document_creation_environment,
                )
            except ValueError as error:
                raise PipelineConfigurationError(str(error)) from error
        return self._run_preparer.execute(runtime)

    def prepare_datasource_node(
        self,
        scope: PipelineInvocationScope,
        *,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> PreparedDatasourceWorkflowNode:
        with _session_scope(self._sessions) as session:
            service = RagPipelineService(session, self._sessions)
            pipeline = self._pipeline(session, scope)
            account = self._actor(session, scope)
            try:
                workflow = self._run_preparer.get_workflow(
                    pipeline,
                    InvokeFrom.PUBLISHED_PIPELINE if command.is_published else InvokeFrom.DEBUGGER,
                    session,
                )
            except ValueError as error:
                raise PipelineConfigurationError(str(error)) from error
            return service.prepare_datasource_workflow_node(
                pipeline=pipeline,
                workflow=self._run_preparer.snapshot_workflow(workflow),
                node_id=node_id,
                user_inputs=dict(command.inputs),
                account=account,
                datasource_type=command.datasource_type,
                credential_id=command.credential_id,
            )

    def run_prepared_datasource_node(
        self,
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Iterable[str]:
        try:
            events = RagPipelineService.run_prepared_datasource_workflow_node(prepared, credentials=credentials)
        except Exception as error:
            events = _datasource_error_events(str(error))
        return PipelineGenerator.convert_to_event_stream(events)

    def datasource_error_events(self, message: str) -> Iterable[str]:
        return PipelineGenerator.convert_to_event_stream(_datasource_error_events(message))

    def preview_prepared_datasource_node(
        self,
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Mapping[str, Any]:
        return RagPipelineService.preview_prepared_datasource_workflow_node(prepared, credentials=credentials)

    def upload_file(self, context: RequestContext, *, upload: PipelineFileUpload) -> PipelineUploadedFile:
        result = self._files.upload_file_for_actor(
            actor=FileUploadActor(id=context.account_id, creator_role=CreatorUserRole.ACCOUNT),
            resource_tenant_id=context.active_workspace_id,
            filename=upload.filename,
            content=upload.content,
            mimetype=upload.mimetype,
            default_file_size_limit=self._file_size_limit(context.active_workspace_id),
        )
        return PipelineUploadedFile(
            id=result.id,
            name=result.name,
            size=result.size,
            extension=result.extension,
            mime_type=result.mime_type,
            created_by=result.created_by,
            created_at=result.created_at,
        )

    @staticmethod
    def _publication_settings(workflow: Workflow) -> tuple[RagPipelineDatasetSettings, ...]:
        settings: list[RagPipelineDatasetSettings] = []
        for node in workflow.graph_dict.get("nodes", []):
            data = node.get("data", {})
            if data.get("type") != "knowledge-index":
                continue
            configuration = KnowledgeConfiguration.model_validate(data)
            settings.append(
                RagPipelineDatasetSettings(
                    chunk_structure=configuration.chunk_structure,
                    indexing_technique=configuration.indexing_technique,
                    embedding_model_provider=configuration.embedding_model_provider or None,
                    embedding_model=configuration.embedding_model or None,
                    keyword_number=configuration.keyword_number,
                    retrieval_model=configuration.retrieval_model.model_dump(),
                    summary_index_setting=configuration.summary_index_setting,
                )
            )
        return tuple(settings)

    def prepare_workflow_publication(self, scope: PipelineInvocationScope) -> PreparedWorkflowPublication:
        if scope.pipeline_id is None:
            raise TypeError("A pipeline ID is required")
        with self._sessions() as session:
            pipeline = self._pipeline(session, scope)
            self._actor(session, scope)
            try:
                state = self._pipelines.get_publication_state(
                    session,
                    tenant_id=scope.workspace_id,
                    pipeline_id=pipeline.id,
                )
            except ValueError as error:
                raise PipelineConfigurationError(str(error)) from error
            if state is None:
                raise PipelineDatasetNotFoundError()
            dataset = state.dataset
            workflow = state.draft
            snapshot = capture_workflow(workflow)
            return _SQLAlchemyPreparedWorkflowPublication(
                scope=scope,
                pipeline_id=pipeline.id,
                dataset_id=dataset.id,
                actor_id=scope.actor_id,
                has_published=pipeline.is_published,
                workflow_snapshot=snapshot,
                workflow_hash=workflow.unique_hash,
                dataset_settings=self._publication_settings(workflow),
            )

    def commit_workflow_publication(
        self,
        prepared: PreparedWorkflowPublication,
        *,
        dataset_change: PreparedRagPipelineDatasetUpdate | None,
    ) -> datetime:
        if not isinstance(prepared, _SQLAlchemyPreparedWorkflowPublication):
            raise TypeError("Unsupported workflow publication")
        with _session_scope(self._sessions) as session:
            actor = self._actor(session, prepared.scope)
            try:
                state = self._pipelines.lock_publication_state(
                    session,
                    tenant_id=prepared.scope.workspace_id,
                    pipeline_id=prepared.pipeline_id,
                    dataset_id=prepared.dataset_id,
                    workflow_id=prepared.workflow_snapshot.id,
                    workflow_hash=prepared.workflow_hash,
                    workflow_matches=lambda draft: capture_workflow(draft) == prepared.workflow_snapshot,
                )
            except ValueError as caught_error:
                raise WorkflowHashNotEqualError() from caught_error
            if state is None:
                raise PipelineDatasetNotFoundError()
            dataset = state.dataset
            if dataset_change is not None:
                if (
                    dataset_change.dataset_id != dataset.id
                    or dataset_change.tenant_id != dataset.tenant_id
                    or dataset_change.actor_id != prepared.actor_id
                ):
                    raise PipelineConfigurationError("Prepared dataset settings do not match the pipeline dataset")
                if not self._dataset_settings_writer.stage_rag_pipeline_dataset_settings(
                    session,
                    change=dataset_change,
                ):
                    raise DatasetConcurrentUpdateError("Dataset changed while publication was being prepared")
            validate_llm_environment_model_references(
                graph=state.draft.graph_dict,
                environment_variables=state.draft.environment_variables,
            )
            workflow = self._pipelines.stage_publication(
                session,
                state=state,
                actor_id=actor.id,
            )
            return workflow.created_at

    def publish_customized_template(
        self,
        scope: PipelineInvocationScope,
        *,
        values: Mapping[str, Any],
    ) -> None:
        with _session_scope(self._sessions) as session:
            service = RagPipelineService(session, self._sessions)
            pipeline = self._pipeline(session, scope)
            actor = self._actor(session, scope)
            dataset = get_pipeline_dataset(pipeline, session)
            if dataset is None:
                raise PipelineDatasetNotFoundError()
            service.publish_customized_pipeline_template(
                pipeline,
                dataset,
                dict(values),
                actor,
                session=session,
            )

    def transform_dataset(self, scope: PipelineInvocationScope) -> Mapping[str, Any]:
        if scope.dataset_id is None:
            raise TypeError("A dataset ID is required")
        with _session_scope(self._sessions) as session:
            dataset = get_dataset_for_tenant(
                session,
                tenant_id=scope.workspace_id,
                dataset_id=scope.dataset_id,
            )
            if dataset is None:
                raise PipelineDatasetNotFoundError()
            return RagPipelineTransformService().transform_dataset(dataset, scope.actor_id, session)

    def import_dataset(self, context: RequestContext, *, yaml_content: str) -> Mapping[str, Any]:
        with _session_scope(self._sessions) as session:
            actor = self._load_actor(
                session,
                workspace_id=context.active_workspace_id,
                actor_id=context.account_id,
            )
            result = RagPipelineDslService(session).import_rag_pipeline(
                account=actor,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                icon_info=IconInfo(
                    icon="📙",
                    icon_background="#FFF4ED",
                    icon_type="emoji",
                ),
            )
            return result.model_dump()


class ActorAwarePipelineCredentialGateway:
    """Select and resolve datasource credentials visible to the admitted actor."""

    def __init__(
        self,
        *,
        query: CredentialQuery,
        resolver: ActorDatasourceCredentialResolver,
        requires_credentials: Callable[[str, str, str, str], bool],
    ) -> None:
        self._query = query
        self._resolver = resolver
        self._requires_credentials = requires_credentials

    def list_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
    ) -> Sequence[DatasourceCredentialListItem]:
        return self._query.list_datasources(
            workspace_id=workspace_id,
            provider=provider,
            plugin_id=plugin_id,
            actor_id=actor_id,
        )

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> ResolvedDatasourceCredential:
        if not self._requires_credentials(workspace_id, provider, plugin_id, datasource_type):
            return ResolvedDatasourceCredential(id=None, values={})
        visible = self.list_visible(
            workspace_id=workspace_id,
            actor_id=actor_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        selected_id = credential_id
        if selected_id is None:
            selected_id = next((credential.id for credential in visible if credential.is_default), None)
            if selected_id is None:
                raise PipelineConfigurationError("Default datasource credential is not available to this actor")
        elif all(credential.id != selected_id for credential in visible):
            raise PipelineConfigurationError("Datasource credential is not available to this actor")

        try:
            values = self._resolver.resolve(
                workspace_id=workspace_id,
                actor_id=actor_id,
                credential_id=selected_id,
                provider=provider,
                plugin_id=plugin_id,
            )
            return ResolvedDatasourceCredential(id=selected_id, values=values)
        except DatasourceCredentialNotFoundError as error:
            raise PipelineConfigurationError("Datasource credential is not available to this actor") from error


@dataclass(frozen=True, slots=True)
class _SQLAlchemyPreparedPipelineWorkflow:
    scope: PipelineInvocationScope
    pipeline: Pipeline
    workflow: Workflow
    actor: Account
    invoke_from: InvokeFrom
    datasource_plugin_specs: Sequence[Mapping[str, Any]]


@dataclass(frozen=True, slots=True)
class _SQLAlchemyPreparedWorkflowPublication:
    scope: PipelineInvocationScope
    pipeline_id: str
    dataset_id: str
    actor_id: str
    has_published: bool
    workflow_snapshot: RagPipelineWorkflowSnapshot
    workflow_hash: str
    dataset_settings: Sequence[RagPipelineDatasetSettings]
