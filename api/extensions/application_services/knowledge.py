"""Composition root for dataset-controller application services."""

from dataclasses import dataclass
from functools import partial
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.repositories.factory import DifyCoreRepositoryFactory
from extensions.application_services.retrieval import build_dataset_retrieval
from extensions.application_services.workflow import build_workflow_execution_dependencies
from libs.helper import generate_text_hash
from repositories.factory import DifyAPIRepositoryFactory
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from repositories.workflow.definition_repository import WorkflowDefinitionRepository
from repositories.workflow.pipeline_publication_repository import PipelinePublicationRepository
from services.api_token_service import ApiTokenCache
from services.app.query_service import AppQueryService
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    TrustedStoredDatasourceCredentialGateway,
)
from services.data_source.provider_service import DatasourceProviderService
from services.knowledge.api_key_service import DatasetApiKeyService
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.dataset_service import DocumentService
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService
from services.knowledge.document_sync import DocumentSyncApplicationService
from services.knowledge.document_sync_adapters import CeleryDocumentSyncDispatcher
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DatasetDocumentApplicationService
from services.knowledge.external.adapters import SQLAlchemyExternalKnowledgeOperations
from services.knowledge.external.application import ExternalKnowledgeApplicationService
from services.knowledge.indexing.adapters.estimate import IndexingEstimateAdapter, SQLAlchemyProcessRuleReader
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.estimate import IndexingEstimateApplicationService
from services.knowledge.metadata.application import MetadataService
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
    RedisSegmentClient,
    RedisSegmentIndexingState,
)
from services.knowledge.segments.application import DatasetSegmentApplicationService
from services.knowledge.segments.indexing import SegmentIndexingGateway
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService
from services.rag_pipeline.execution_service import RagPipelineExecutionService
from services.rag_pipeline.publication_gateway import PipelineIndexUpdateGateway, PipelinePublicationModelGateway
from services.rag_pipeline.publication_service import PipelinePublicationService
from services.tag_application_service import TagTargetQuery
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.document_indexing_sync_task import document_indexing_sync_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


@dataclass(frozen=True, slots=True)
class KnowledgeServices:
    inner_retrieval: InnerKnowledgeRetrievalService
    metadata: MetadataService
    datasets: DatasetApplicationService
    external: ExternalKnowledgeApplicationService
    documents: DatasetDocumentApplicationService
    document_sync: DocumentSyncApplicationService
    indexing_estimates: IndexingEstimateApplicationService
    segments: DatasetSegmentApplicationService
    pipeline_generator: PipelineGenerator
    pipeline_execution: RagPipelineExecutionService
    pipeline_publication: PipelinePublicationService


def build_dataset_api_key_service(
    *, database_client: sessionmaker[Session], dataset_access: DatasetAccessService
) -> DatasetApiKeyService:
    return DatasetApiKeyService(
        keys=DatasetApiKeyRepository(session_factory=database_client),
        cache=ApiTokenCache,
        access=dataset_access,
        rbac_enabled=lambda: dify_config.RBAC_ENABLED,
    )


def build_knowledge_services(
    *,
    database_client: sessionmaker[Session],
    dataset_access: DatasetAccessService,
    datasets: SQLAlchemyDatasetRepository,
    documents: SQLAlchemyDocumentRepository,
    actor_credentials: ActorAwareDatasourceCredentialGateway,
    stored_credentials: TrustedStoredDatasourceCredentialGateway,
    providers: DatasourceProviderService,
    redis: RedisSegmentClient,
    tags: TagTargetQuery,
    app_queries: AppQueryService,
    variables: WorkflowExecutionVariables,
) -> KnowledgeServices:
    """Build the dataset-controller knowledge use cases."""

    uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=database_client)
    notion_sources = NotionSourceResolver(
        actor_credentials=actor_credentials,
        stored_credentials=stored_credentials,
    )
    file_sources = FileSourceAdapter(uploads=uploads)
    website_sources = WebsiteSourceAdapter()
    stored_sources = CompositeStoredSourceResolver(
        adapters={
            DatasourceType.FILE.value: file_sources,
            DatasourceType.NOTION.value: notion_sources,
            DatasourceType.WEBSITE.value: website_sources,
        }
    )
    segments = SQLAlchemySegmentRepository(session_factory=database_client)
    segment_index = SegmentIndexingGateway(
        segments=segments,
        uploads=uploads,
        redis=redis,
        new_session=database_client,
        delete_task=delete_segment_from_index_task.delay,
        enable_task=enable_segments_to_index_task.delay,
        disable_task=disable_segments_from_index_task.delay,
    )
    return KnowledgeServices(
        inner_retrieval=InnerKnowledgeRetrievalService(
            scopes=KnowledgeRetrievalRepository(database_client), retrieval=build_dataset_retrieval(database_client)
        ),
        metadata=MetadataService(
            store=SQLAlchemyMetadataRepository(session_factory=database_client), dataset_access=dataset_access
        ),
        datasets=DatasetApplicationService(
            dataset_access=dataset_access,
            operations=SQLAlchemyDatasetOperations(session_factory=database_client, tags=tags, app_queries=app_queries),
            rbac_enabled=dify_config.RBAC_ENABLED,
            service_api_url=dify_config.SERVICE_API_URL,
            vector_store=dify_config.VECTOR_STORE,
            tidb_fulltext=dify_config.TIDB_VECTOR_ENABLE_FULLTEXT_SEARCH,
        ),
        external=ExternalKnowledgeApplicationService(
            dataset_access=dataset_access,
            operations=SQLAlchemyExternalKnowledgeOperations(session_factory=database_client),
        ),
        documents=DatasetDocumentApplicationService(
            dataset_access=dataset_access,
            operations=SQLAlchemyDocumentOperations(session_factory=database_client),
            metadata_schema=DocumentService.DOCUMENT_METADATA_SCHEMA,
        ),
        pipeline_generator=PipelineGenerator(
            runtime=build_workflow_execution_dependencies(database_client),
            documents=documents,
            datasource_providers=providers,
            draft_variable_loader=variables.workflow_loader,
            draft_variable_saver=variables.saver_factory,
        ),
        pipeline_publication=PipelinePublicationService(
            PipelinePublicationRepository(database_client),
            PipelinePublicationModelGateway(),
            PipelineIndexUpdateGateway(),
        ),
        pipeline_execution=RagPipelineExecutionService(
            runtime=build_workflow_execution_dependencies(database_client),
            workflows=WorkflowDefinitionRepository(session_factory=database_client),
            variables=variables,
            executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(database_client),
            writer_factory=partial(
                DifyCoreRepositoryFactory.create_workflow_node_execution_repository, session_factory=database_client
            ),
            documents=documents,
        ),
        document_sync=DocumentSyncApplicationService(
            dataset_access=dataset_access,
            documents=documents,
            dispatcher=CeleryDocumentSyncDispatcher(delay=document_indexing_sync_task.delay),
        ),
        indexing_estimates=IndexingEstimateApplicationService(
            dataset_access=dataset_access,
            datasets=datasets,
            documents=documents,
            files=file_sources,
            websites=website_sources,
            stored_sources=stored_sources,
            notion=notion_sources,
            process_rules=SQLAlchemyProcessRuleReader(session_factory=database_client),
            runner=IndexingEstimateAdapter(session_factory=database_client),
        ),
        segments=DatasetSegmentApplicationService(
            dataset_access=dataset_access,
            scopes=datasets,
            store=segments,
            index=segment_index,
            limits=dify_config,
            text_hash=generate_text_hash,
            uploads=uploads,
            model_guard=ModelManagerSegmentGuard(),
            indexing_state=RedisSegmentIndexingState(redis),
            batch_dispatcher=CelerySegmentBatchImportDispatcher(delay=batch_create_segment_to_index_task.delay),
            job_id_factory=lambda: str(uuid4()),
        ),
    )
