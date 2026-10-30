"""Composition root for dataset-controller application services."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants import HIDDEN_VALUE
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from libs.helper import generate_text_hash
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from repositories.knowledge.retrieval_source_repository import SQLAlchemyRetrievalRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.api_token_service import ApiTokenCache
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    TrustedStoredDatasourceCredentialGateway,
)
from services.data_source.provider_service import DatasourceProviderService
from services.data_source.website_service import WebsiteService
from services.extraction.contracts import DatasourceType
from services.feature_service import FeatureService
from services.file_service import FileService
from services.knowledge.admission.application import DatasetAdmissionService
from services.knowledge.admission.limits import KnowledgeApiLimitsGateway
from services.knowledge.api_key_service import DatasetApiKeyService
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService
from services.knowledge.datasets.model_configuration import KnowledgeModelConfigurationGateway
from services.knowledge.datasets.task_gateway import dispatch_dataset_cleanup
from services.knowledge.document_sync import DocumentSyncApplicationService
from services.knowledge.documents.adapters import (
    CeleryDocumentTaskDispatcher,
    DocumentModelConfigurationAdapter,
    DocumentResponsePresentationAdapter,
    DocumentSourceAuthorizationAdapter,
    DocumentUploadAdapter,
    RedisDocumentLifecycleCache,
    SQLAlchemyDocumentOperations,
)
from services.knowledge.documents.application import DatasetDocumentApplicationService
from services.knowledge.documents.creation_adapters import (
    ConfiguredDocumentCreationGateway,
)
from services.knowledge.external.adapters import (
    ExternalKnowledgeGateway,
    sync_external_dataset_creator_access,
)
from services.knowledge.external.application import ExternalDatasetRetrievalService, ExternalKnowledgeApplicationService
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.indexing.adapters.estimate import IndexingEstimateAdapter, SQLAlchemyProcessRuleReader
from services.knowledge.indexing.adapters.execution import PipelineSummaryIndexDispatcher
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.estimate import IndexingEstimateApplicationService
from services.knowledge.metadata.application import MetadataService
from services.knowledge.retrieval.adapters import (
    DataPostProcessorReranker,
    DatasetCandidateRetriever,
    SQLAlchemyInnerKnowledgeRetrievalScope,
)
from services.knowledge.retrieval.application import (
    InnerKnowledgeRetrievalService,
    KnowledgeRetrievalApplicationService,
)
from services.knowledge.retrieval.candidate_search import CandidateSearch
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer
from services.knowledge.retrieval.metadata_filtering import MetadataFilterPlanner
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
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
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


@dataclass(frozen=True, slots=True)
class KnowledgeServices:
    admission: DatasetAdmissionService
    metadata: MetadataService
    datasets: DatasetApplicationService
    external: ExternalKnowledgeApplicationService
    retrieval: KnowledgeRetriever
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
    files: FileService,
    dataset_access: DatasetAccessService,
    datasets: SQLAlchemyDatasetRepository,
    documents: SQLAlchemyDocumentRepository,
    actor_credentials: ActorAwareDatasourceCredentialGateway,
    stored_credentials: TrustedStoredDatasourceCredentialGateway,
    providers: DatasourceProviderService,
    redis: RedisClientWrapper,
    tags: TagTargetQuery,
    rbac_members: MemberService,
    workspaces: WorkspaceRepository,
    deployment_edition: DeploymentEdition,
) -> KnowledgeServices:
    """Build the dataset-controller knowledge use cases."""

    uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=database_client)
    indexing_locks = RedisKnowledgeIndexingLock(redis=redis)
    model_configuration = KnowledgeModelConfigurationGateway()
    document_tasks = CeleryDocumentTaskDispatcher()
    document_models = DocumentModelConfigurationAdapter(models=model_configuration)
    notion_sources = NotionSourceResolver(
        actor_credentials=actor_credentials,
        stored_credentials=stored_credentials,
    )
    file_sources = FileSourceAdapter(uploads=uploads)
    website_jobs = WebsiteService(
        providers=providers,
    )
    website_sources = WebsiteSourceAdapter(
        jobs=website_jobs,
    )
    stored_sources = CompositeStoredSourceResolver(
        adapters={
            DatasourceType.FILE.value: file_sources,
            DatasourceType.NOTION.value: notion_sources,
            DatasourceType.WEBSITE.value: website_sources,
        }
    )
    segments = SQLAlchemySegmentRepository(
        session_factory=database_client,
    )
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
    external_gateway = ExternalKnowledgeGateway()
    external_retrieval = ExternalDatasetRetrievalService(repository=external_repository, gateway=external_gateway)
    limits = KnowledgeApiLimitsGateway(
        redis=redis,
        get_features=lambda workspace_id: FeatureService.get_features(workspace_id, exclude_vector_space=True),
        get_vector_space=FeatureService.get_vector_space,
        get_knowledge_rate_limit=FeatureService.get_knowledge_rate_limit,
        rate_limit_logs=datasets,
        deployment_edition=deployment_edition,
    )
    retrieval_repository = SQLAlchemyRetrievalRepository(session_factory=database_client)
    retrieval = KnowledgeRetrievalApplicationService(
        repository=retrieval_repository,
        candidate_search=CandidateSearch(
            internal_retrieval=DatasetCandidateRetriever(),
            external_retrieval=external_retrieval,
            reranker=DataPostProcessorReranker(session_factory=database_client),
        ),
        metadata_filters=MetadataFilterPlanner(repository=retrieval_repository),
        finalizer=KnowledgeRetrievalFinalizer(session_factory=database_client),
        limits=limits,
    )
    pipeline_generator = PipelineGenerator(
        execution_driver=WorkflowRunAgg.run,
        files=files,
        documents=documents,
        datasource_providers=providers,
        knowledge_retrieval=retrieval,
        summary_index_service=PipelineSummaryIndexDispatcher(),
    )
    dataset_operations = SQLAlchemyDatasetOperations(
        session_factory=database_client,
        datasets=datasets,
        tags=tags,
        app_queries=ConsoleAppRepository(session_factory=database_client),
        members=rbac_members,
    )
    external_persistence = external_repository
    external_application = ExternalKnowledgeApplicationService(
        dataset_access=dataset_access,
        repository=external_persistence,
        retrieval=external_gateway,
        queries=datasets,
        dataset_details=dataset_operations,
        sync_creator_access=sync_external_dataset_creator_access,
        api_key_mask=HIDDEN_VALUE,
    )
    dataset_application = DatasetApplicationService(
        dataset_access=dataset_access,
        mutations=datasets,
        models=model_configuration,
        operations=dataset_operations,
        cleanup_dataset=dispatch_dataset_cleanup,
        rbac_enabled=dify_config.RBAC_ENABLED,
        service_api_url=dify_config.SERVICE_API_URL,
        vector_store=dify_config.VECTOR_STORE,
        tidb_fulltext=dify_config.TIDB_VECTOR_ENABLE_FULLTEXT_SEARCH,
    )
    return KnowledgeServices(
        inner_retrieval=InnerKnowledgeRetrievalService(
            scope=SQLAlchemyInnerKnowledgeRetrievalScope(session_factory=database_client),
            retrieval=retrieval,
        ),
        admission=DatasetAdmissionService(
            datasets=datasets,
            keys=DatasetApiKeyRepository(session_factory=database_client),
            workspaces=workspaces,
            limits=limits,
        ),
        metadata=MetadataService(
            store=SQLAlchemyMetadataRepository(session_factory=database_client), dataset_access=dataset_access
        ),
        hit_testing=HitTestingApplicationService(
            dataset_access=dataset_access,
            retrieval=DatasetHitTestingGateway(
                datasets=datasets,
                documents=documents,
                segments=segments,
                session_factory=database_client,
                external_retrieval=external_retrieval,
            ),
            queries=datasets,
        ),
        datasets=dataset_application,
        external=external_application,
        retrieval=retrieval,
        documents=DatasetDocumentApplicationService(
            dataset_access=dataset_access,
            datasets=datasets,
            documents=documents,
            operations=SQLAlchemyDocumentOperations(
                session_factory=database_client,
                documents=documents,
                files=files,
            ),
            uploads=DocumentUploadAdapter(files=files),
            source_authorization=DocumentSourceAuthorizationAdapter(
                actor_credentials=actor_credentials, website_jobs=website_jobs
            ),
            indexing_locks=indexing_locks,
            lifecycle_cache=RedisDocumentLifecycleCache(redis=redis),
            model_configuration=document_models,
            creation=ConfiguredDocumentCreationGateway(models=document_models),
            creator_access=dataset_application,
            tasks=document_tasks,
            presenter=DocumentResponsePresentationAdapter(),
        ),
        pipeline_generator=pipeline_generator,
        document_sync=DocumentSyncApplicationService(
            dataset_access=dataset_access,
            documents=documents,
            tasks=document_tasks,
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
            runner=IndexingEstimateAdapter(session_factory=database_client, files=files, website=website_jobs),
        ),
        segments=DatasetSegmentApplicationService(
            presenter=SegmentPresentationAdapter(),
            dataset_access=dataset_access,
            scopes=datasets,
            store=segments,
            index=segment_index,
            limits=dify_config,
            text_hash=generate_text_hash,
            uploads=uploads,
            model_guard=ModelManagerSegmentGuard(),
            indexing_state=RedisSegmentIndexingState(redis, locks=indexing_locks),
            batch_dispatcher=CelerySegmentBatchImportDispatcher(delay=batch_create_segment_to_index_task.delay),
            job_id_factory=lambda: str(uuid4()),
        ),
    )
