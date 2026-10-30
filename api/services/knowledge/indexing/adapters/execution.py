"""Adapt legacy processors to committed document-indexing phases."""

import logging
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import HTTPException
from werkzeug.local import LocalProxy

from configs import dify_config
from core.errors.error import (
    AppInvokeQuotaExceededError,
    InvokeRateLimitError,
    LLMError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_manager import ModelManager
from core.plugin.impl.exc import PluginDaemonError
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.models.document import Document
from extensions.application_services.data_sources import build_data_source_credentials, build_website_service
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.otel import propagate_context
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from libs.datetime_utils import naive_utc_now
from models.enums import DataSourceType
from repositories.file.upload_file_repository import UploadFileRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.data_source.website_service import WebsiteService
from services.entities.upload_file import CreatedUploadArtifact
from services.extraction.contracts import ExtractionResult
from services.extraction.images import ExtractionImageWriter
from services.extraction.processor import ExtractProcessor
from services.file_adapters import build_file_service
from services.file_service import FileService
from services.knowledge.entities.resource_scope import DocumentRef
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingTransformResult
from services.vector_space_admission_service import VectorSpaceAdmissionService

logger = logging.getLogger(__name__)


class PipelineSummaryIndexDispatcher:
    """Dispatch summary generation after pipeline indexing commits."""

    def generate_and_vectorize_summary(
        self,
        dataset_id: str,
        document_id: str,
        is_preview: bool,
        summary_index_setting: SummaryIndexSettingDict | None = None,
    ) -> None:
        del summary_index_setting
        if is_preview:
            raise ValueError("Pipeline summary dispatch is unavailable in preview mode")

        from tasks.generate_summary_index_task import generate_summary_index_task

        generate_summary_index_task.delay(dataset_id, document_id, None)


class IndexingExecutionAdapter:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        documents: SQLAlchemyDocumentRepository,
        segments: SQLAlchemySegmentRepository,
        sources: CompositeStoredSourceResolver,
        files: FileService,
        website: WebsiteService,
    ) -> None:
        self._session_factory = session_factory
        self._documents = documents
        self._segments = segments
        self._sources = sources
        self._files = files
        self._website = website

    def describe_error(self, error: Exception) -> str:
        """Preserve provider and extractor descriptions without their transport prefixes."""
        if isinstance(
            error,
            (
                LLMError,
                ProviderTokenNotInitError,
                QuotaExceededError,
                AppInvokeQuotaExceededError,
                ModelCurrentlyNotSupportError,
                InvokeRateLimitError,
                PluginDaemonError,
                HTTPException,
            ),
        ):
            return str(error.description)
        return str(error)

    def check_paused(self, ref: DocumentRef) -> None:
        if redis_client.get(f"document_{ref.document_id}_is_paused"):
            raise DocumentIsPausedError(f"Document paused, document id: {ref.document_id}")

    def extract(self, document: IndexingDocument) -> ExtractionResult[Document]:
        if not document.processing_rule:
            raise ValueError("no process rule found")
        setting = self._sources.resolve(document.source)
        created_artifacts: dict[str, CreatedUploadArtifact] = {}
        commit_started = False

        def record_artifact(artifact: CreatedUploadArtifact) -> None:
            created_artifacts[artifact.id] = artifact

        try:
            with self._session_factory() as session:
                image_writer = (
                    ExtractionImageWriter(
                        session=session,
                        files=UploadFileRepository(session_factory=self._session_factory),
                        tenant_id=setting.upload_file.tenant_id,
                        user_id=setting.upload_file.created_by,
                        storage_type=dify_config.STORAGE_TYPE,
                        files_url=dify_config.FILES_URL,
                        save_blob=storage.save,
                        on_artifact_created=record_artifact,
                        clock=naive_utc_now,
                    )
                    if setting.upload_file is not None
                    else None
                )
                extraction = ExtractProcessor.extract(
                    setting,
                    is_automatic=document.processing_rule["mode"] in ("automatic", "hierarchical"),
                    image_writer=image_writer,
                    website_service=self._website,
                    capture_source_version=True,
                )
                # A commit exception has an unknown outcome. From this point,
                # cleanup must use the published file identity, never the raw key.
                commit_started = True
                session.commit()
            created_artifacts.update((artifact.id, artifact) for artifact in extraction.created_upload_artifacts)
            for text in extraction.documents:
                text.metadata.update(document_id=document.ref.document_id, dataset_id=document.ref.dataset.dataset_id)
            return replace(extraction, created_upload_artifacts=tuple(created_artifacts.values()))
        except Exception:
            if commit_started:
                self._delete_unreferenced_files(document, tuple(created_artifacts))
            else:
                self._delete_uncommitted_artifacts(tuple(created_artifacts.values()))
            raise

    def cleanup_created_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None:
        self._delete_unreferenced_files(document, file_ids)

    def reclaim_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None:
        """Reconcile durable replacement candidates and surface failures for retry."""

        for file_id in dict.fromkeys(file_ids):
            self._files.delete_file(tenant_id=document.ref.dataset.tenant_id, file_id=file_id)

    def _delete_unreferenced_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None:
        for file_id in dict.fromkeys(file_ids):
            try:
                self._files.delete_file(tenant_id=document.ref.dataset.tenant_id, file_id=file_id)
            except Exception:
                logger.exception("Failed to clean file created by document indexing: %s", file_id)

    def _delete_uncommitted_artifacts(self, artifacts: Sequence[CreatedUploadArtifact]) -> None:
        for artifact in {artifact.key: artifact for artifact in artifacts}.values():
            try:
                self._files.delete_uncommitted_artifact(artifact=artifact)
            except Exception:
                logger.exception(
                    "Failed to clean uncommitted extraction artifact: file_id=%s, key=%s",
                    artifact.id,
                    artifact.key,
                )

    def transform(self, document: IndexingDocument, texts: list[Document]) -> IndexingTransformResult:
        dataset, _ = self._documents.get_indexing_models(document.ref)
        user = self._documents.get_indexing_user(document.ref)
        model = None
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            manager = ModelManager.for_tenant(tenant_id=dataset.tenant_id)
            if dataset.embedding_model_provider:
                model = manager.get_model_instance(
                    tenant_id=dataset.tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            else:
                model = manager.get_default_model_instance(
                    tenant_id=dataset.tenant_id, model_type=ModelType.TEXT_EMBEDDING
                )
        processor = IndexProcessorFactory(document.doc_form, files=self._files).init_index_processor()
        created_upload_file_ids: list[str] = []
        try:
            with self._session_factory() as session:
                chunks = processor.transform(
                    texts,
                    user,
                    embedding_model_instance=model,
                    process_rule=document.processing_rule,
                    tenant_id=dataset.tenant_id,
                    doc_language=document.doc_language,
                    on_upload_file_created=created_upload_file_ids.append,
                    session=session,
                )
                session.commit()
        except Exception:
            self.cleanup_created_upload_files(document, created_upload_file_ids)
            raise
        return IndexingTransformResult(chunks=chunks, created_upload_file_ids=tuple(created_upload_file_ids))

    def count_tokens(self, document: IndexingDocument, chunks: list[Document]) -> list[int]:
        dataset, _ = self._documents.get_indexing_models(document.ref)
        return calculate_segment_token_counts(dataset=dataset, documents=chunks)

    def ensure_admission(self, document: IndexingDocument, chunks: list[Document]) -> None:
        dataset, _ = self._documents.get_indexing_models(document.ref)
        with self._session_factory() as session:
            VectorSpaceAdmissionService().ensure_document_can_be_indexed(
                dataset=dataset,
                document_id=document.ref.document_id,
                doc_form=document.doc_form,
                documents=chunks,
                include_summaries=document.need_summary,
                session=session,
            )

    def load(self, document: IndexingDocument, chunks: list[Document]) -> None:
        dataset, _ = self._documents.get_indexing_models(document.ref)
        app = cast(LocalProxy[Flask], current_app)._get_current_object()
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            groups: list[list[Document]] = [[] for _ in range(10)]
            for chunk in chunks:
                groups[int(helper.generate_text_hash(chunk.page_content), 16) % 10].append(chunk)
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = [
                    executor.submit(propagate_context(self._process_chunk), app, document.ref, group, False)
                    for group in groups
                    if group
                ]
                for future in futures:
                    future.result()
        elif (
            dataset.indexing_technique == IndexTechniqueType.ECONOMY
            and document.doc_form != IndexStructureType.PARENT_CHILD_INDEX
        ):
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(propagate_context(self._process_chunk), app, document.ref, chunks, True).result()

    def _process_chunk(self, app: Flask, ref: DocumentRef, chunks: list[Document], keywords: bool) -> None:
        with app.app_context():
            self.check_paused(ref)
            dataset, document = self._documents.get_indexing_models(ref)
            if keywords:
                Jieba(dataset).update_texts(
                    chunks,
                    read=lambda: self._segments.get_keyword_table(ref.dataset),
                    write=lambda storage_type, data, selected: self._segments.save_keyword_table(
                        ref.dataset, storage_type=storage_type, data=data, keywords=selected
                    ),
                    lock=redis_client.lock(f"keyword_indexing_lock_{dataset.id}", timeout=600),
                )
            elif dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
                with self._session_factory() as session:
                    vector_type = Vector.resolve_vector_type(dataset, session=session)
                attachments = (
                    [attachment for chunk in chunks for attachment in chunk.attachments or []]
                    if dataset.is_multimodal
                    else []
                )
                files = self._files.get_files(
                    tenant_id=ref.dataset.tenant_id,
                    file_ids=[str(attachment.metadata["doc_id"]) for attachment in attachments],
                )
                vector = Vector(dataset, session=None, vector_type=vector_type)
                if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    child_documents = [
                        Document.model_validate(child.model_dump())
                        for chunk in chunks
                        for child in chunk.children or []
                    ]
                    if child_documents:
                        vector.create(child_documents)
                else:
                    vector.create(chunks)
                if attachments:
                    vector.create_multimodal(
                        attachments, upload_file_keys={file_id: file.key for file_id, file in files.items()}
                    )
            self.check_paused(ref)
            self._segments.complete_indexing_segments(ref, [str(chunk.metadata["doc_id"]) for chunk in chunks])


def build_indexing_segment_repository(*, session_factory: sessionmaker[Session]) -> SQLAlchemySegmentRepository:
    return SQLAlchemySegmentRepository(session_factory=session_factory)


def build_document_indexing_service(
    *,
    session_factory: sessionmaker[Session],
    enforce_vector_space_admission: bool = False,
) -> DocumentIndexingService:
    """Assemble a fresh indexing use case from explicit database dependencies."""
    documents = SQLAlchemyDocumentRepository(session_factory=session_factory)
    segments = build_indexing_segment_repository(session_factory=session_factory)
    uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=session_factory)
    files = build_file_service(session_factory=session_factory)
    credentials = build_data_source_credentials(database_client=session_factory)
    website_jobs = build_website_service(database_client=session_factory)
    sources = CompositeStoredSourceResolver(
        adapters={
            DataSourceType.UPLOAD_FILE: FileSourceAdapter(uploads=uploads),
            DataSourceType.NOTION_IMPORT: NotionSourceResolver(
                actor_credentials=credentials.actor, stored_credentials=credentials.stored
            ),
            DataSourceType.WEBSITE_CRAWL: WebsiteSourceAdapter(jobs=website_jobs),
        }
    )
    return DocumentIndexingService(
        documents=documents,
        segments=segments,
        indexing_locks=RedisKnowledgeIndexingLock(redis=redis_client),
        backend=IndexingExecutionAdapter(
            session_factory=session_factory,
            documents=documents,
            segments=segments,
            sources=sources,
            files=files,
            website=website_jobs,
        ),
        enforce_vector_space_admission=enforce_vector_space_admission,
    )
