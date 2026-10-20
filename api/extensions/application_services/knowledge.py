"""Composition root for dataset-controller application services."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.rag.extractor.entity.datasource_type import DatasourceType
from libs.helper import generate_text_hash
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.api_token_service import ApiTokenCache
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    TrustedStoredDatasourceCredentialGateway,
)
from services.data_source.provider_service import DatasourceProviderService
from services.knowledge.api_key_service import DatasetApiKeyService
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.dataset_service import DocumentService, ExternalKnowledgeTemplateLookup
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService
from services.knowledge.document_sync import DocumentSyncApplicationService
from services.knowledge.document_sync_adapters import CeleryDocumentSyncDispatcher
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DatasetDocumentApplicationService
from services.knowledge.external.adapters import ExternalKnowledgeGateway, sync_external_dataset_creator_access
from services.knowledge.external.application import ExternalKnowledgeApplicationService
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.indexing.adapters.estimate import IndexingEstimateAdapter, SQLAlchemyProcessRuleReader
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.estimate import IndexingEstimateApplicationService
from services.knowledge.metadata.application import MetadataService
from services.knowledge.retrieval.adapters import WorkflowKnowledgeRetrievalGateway
from services.knowledge.retrieval.application import InnerKnowledgeRetrievalService
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
    RedisSegmentClient,
    RedisSegmentIndexingState,
    SegmentPresentationAdapter,
)
from services.knowledge.segments.application import DatasetSegmentApplicationService
from services.knowledge.segments.indexing import SegmentIndexingGateway
from services.rbac.members import MemberService
from services.tag_application_service import TagTargetQuery
from services.workflow_run_agg import WorkflowRunAgg
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.document_indexing_sync_task import document_indexing_sync_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


@dataclass(frozen=True, slots=True)
class KnowledgeServices:
    metadata: MetadataService
    datasets: DatasetApplicationService
    external: ExternalKnowledgeApplicationService
    external_templates: ExternalKnowledgeTemplateLookup
    hit_testing: HitTestingApplicationService
    inner_retrieval: InnerKnowledgeRetrievalService
    documents: DatasetDocumentApplicationService
    document_sync: DocumentSyncApplicationService
    indexing_estimates: IndexingEstimateApplicationService
    segments: DatasetSegmentApplicationService
    pipeline_generator: PipelineGenerator


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
    rbac_members: MemberService,
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
    external_repository = SQLAlchemyExternalKnowledgeRepository(session_factory=database_client)
    dataset_operations = SQLAlchemyDatasetOperations(
        session_factory=database_client,
        tags=tags,
        app_queries=ConsoleAppRepository(session_factory=database_client),
        external_templates=external_repository,
        members=rbac_members,
    )
    return KnowledgeServices(
        metadata=MetadataService(
            store=SQLAlchemyMetadataRepository(session_factory=database_client), dataset_access=dataset_access
        ),
        datasets=DatasetApplicationService(
            dataset_access=dataset_access,
            operations=dataset_operations,
            rbac_enabled=dify_config.RBAC_ENABLED,
            service_api_url=dify_config.SERVICE_API_URL,
            vector_store=dify_config.VECTOR_STORE,
            tidb_fulltext=dify_config.TIDB_VECTOR_ENABLE_FULLTEXT_SEARCH,
        ),
        external=ExternalKnowledgeApplicationService(
            dataset_access=dataset_access,
            repository=external_repository,
            retrieval=ExternalKnowledgeGateway(),
            queries=datasets,
            dataset_details=dataset_operations,
            sync_creator_access=sync_external_dataset_creator_access,
        ),
        external_templates=external_repository,
        hit_testing=HitTestingApplicationService(
            dataset_access=dataset_access,
            retrieval=DatasetHitTestingGateway(datasets=datasets, documents=documents, segments=segments),
            queries=datasets,
        ),
        inner_retrieval=InnerKnowledgeRetrievalService(
            scope=datasets, retrieval=WorkflowKnowledgeRetrievalGateway(session_factory=database_client)
        ),
        documents=DatasetDocumentApplicationService(
            dataset_access=dataset_access,
            operations=SQLAlchemyDocumentOperations(session_factory=database_client),
            metadata_schema=DocumentService.DOCUMENT_METADATA_SCHEMA,
        ),
        pipeline_generator=PipelineGenerator(
            execution_driver=WorkflowRunAgg.run, documents=documents, datasource_providers=providers
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
            presenter=SegmentPresentationAdapter(),
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
