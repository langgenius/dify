"""Composition root for dataset-controller application services."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.rag.extractor.entity.datasource_type import DatasourceType
from libs.helper import generate_text_hash
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    TrustedStoredDatasourceCredentialGateway,
)
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.document_sync import DocumentSyncApplicationService
from services.knowledge.document_sync_adapters import CeleryDocumentSyncDispatcher
from services.knowledge.indexing.adapters.estimate import IndexingRunnerEstimateAdapter, SQLAlchemyProcessRuleReader
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.estimate import IndexingEstimateApplicationService
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
    RedisSegmentClient,
    RedisSegmentIndexingState,
)
from services.knowledge.segments.application import DatasetSegmentApplicationService
from services.knowledge.segments.indexing import SegmentIndexingGateway
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.document_indexing_sync_task import document_indexing_sync_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


@dataclass(frozen=True, slots=True)
class KnowledgeServices:
    document_sync: DocumentSyncApplicationService
    indexing_estimates: IndexingEstimateApplicationService
    segments: DatasetSegmentApplicationService
    pipeline_generator: PipelineGenerator


def build_knowledge_services(
    *,
    database_client: sessionmaker[Session],
    dataset_access: DatasetAccessService,
    datasets: SQLAlchemyDatasetRepository,
    documents: SQLAlchemyDocumentRepository,
    uploads: SQLAlchemyKnowledgeUploadRepository,
    actor_credentials: ActorAwareDatasourceCredentialGateway,
    stored_credentials: TrustedStoredDatasourceCredentialGateway,
    redis: RedisSegmentClient,
) -> KnowledgeServices:
    """Build the dataset-controller knowledge use cases."""

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
        pipeline_generator=PipelineGenerator(documents=documents),
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
            runner=IndexingRunnerEstimateAdapter(session_factory=database_client),
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
