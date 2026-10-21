"""Adapt legacy processors to committed document-indexing phases."""

import logging
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any, cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import HTTPException
from werkzeug.local import LocalProxy

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
from core.rag.docstore.dataset_docstore import SegmentAttachmentWriter
from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor, IndexProcessorFactory
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.models.document import Document
from core.workflow.nodes.knowledge_index.exc import KnowledgeIndexNodeError
from core.workflow.nodes.knowledge_index.protocols import IndexingResultDict
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_redis import redis_client
from extensions.otel import propagate_context
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from models.enums import DataSourceType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.documents.contracts import (
    DocumentIndexingExecutionClaimLostError,
    DocumentPersistenceDatasetNotFoundError,
)
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.contracts import DocumentIndexingExecution, IndexingDocument
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.vector_space_admission_service import VectorSpaceAdmissionService

logger = logging.getLogger(__name__)


class PipelineSummaryIndexDispatcher:
    """Validate the legacy summary callback after atomic pipeline completion."""

    def __init__(
        self,
        *,
        documents: object,
        ref: DocumentRef,
        execution: DocumentIndexingExecution,
    ) -> None:
        del documents
        self._ref = ref
        self._execution = execution

    def generate_and_vectorize_summary(
        self,
        dataset_id: str,
        document_id: str,
        is_preview: bool,
        summary_index_setting: SummaryIndexSettingDict | None = None,
        *,
        expected_generation: str | None = None,
    ) -> None:
        del summary_index_setting
        if is_preview:
            raise ValueError("Pipeline summary dispatch is unavailable in preview mode")
        if dataset_id != self._ref.dataset.dataset_id or document_id != self._ref.document_id:
            raise ValueError("Pipeline summary target does not match its indexing execution")
        if expected_generation != self._execution.expected_generation:
            raise DocumentIndexingGenerationChangedError(document_id)
        # PipelineIndexProcessor persists the summary intent in the same
        # transaction as document completion. The workflow callback remains
        # during the rolling migration only to validate its exact target.


class PipelineIndexProcessor(IndexProcessor):
    """Own pipeline indexing persistence outside the workflow runtime."""

    def __init__(
        self,
        *,
        attachment_writer: SegmentAttachmentWriter,
        execution: DocumentIndexingExecution,
        repair_stale_execution: Callable[[], object],
        documents: SQLAlchemyDocumentRepository | None = None,
    ) -> None:
        super().__init__(attachment_writer=attachment_writer)
        self._pipeline_attachment_writer = attachment_writer
        self._execution = execution
        self._repair_stale_execution = repair_stale_execution
        self._documents = documents

    @property
    def expected_generation(self) -> str | None:
        return self._execution.expected_generation

    def _assert_owned(self) -> None:
        self._execution.assert_owned()

    def index_and_clean(
        self,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        chunks: Mapping[str, Any],
        batch: Any,
        summary_index_setting: SummaryIndexSettingDict | None = None,
        *,
        session: Session,
    ) -> IndexingResultDict:
        side_effect_started = False
        try:
            self._assert_owned()
            documents = self._documents or SQLAlchemyDocumentRepository(
                session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
            )
            try:
                dataset, document, index_node_ids = documents.load_pipeline_indexing_context(
                    session,
                    dataset_id=dataset_id,
                    document_id=document_id,
                    original_document_id=original_document_id,
                    execution=self._execution,
                )
            except DocumentPersistenceDatasetNotFoundError as error:
                raise KnowledgeIndexNodeError(f"Dataset {dataset_id} not found.") from error
            ref = DatasetRef(dataset.tenant_id, dataset.id).document(document_id)

            dataset_name = dataset.name
            document_name = document.name
            created_at = document.created_at
            if summary_index_setting is None:
                summary_index_setting = dataset.summary_index_setting

            index_processor = IndexProcessorFactory(
                dataset.chunk_structure,
                attachment_writer=self._pipeline_attachment_writer,
            ).init_index_processor()
            indexing_started_at = time.perf_counter()
            documents.commit_pipeline_indexing_phase(session, ref, execution=self._execution)

            if not original_document_id:
                self._assert_owned()
                VectorSpaceAdmissionService().ensure_pipeline_can_be_indexed(
                    dataset=dataset,
                    document_id=document.id,
                    chunk_structure=dataset.chunk_structure,
                    chunks=chunks,
                    include_summaries=bool(summary_index_setting and summary_index_setting.get("enable")),
                    session=session,
                )
                self._assert_owned()

            if index_node_ids:
                side_effect_started = True
                index_processor.clean(
                    dataset,
                    list(index_node_ids),
                    with_keywords=True,
                    delete_child_chunks=False,
                    session=session,
                )
                documents.commit_pipeline_indexing_phase(session, ref, execution=self._execution)
                documents.require_pipeline_indexing_document(session, ref, execution=self._execution)
                self._pipeline_attachment_writer.delete_segments_for_replacement(
                    session,
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=original_document_id,
                )

            self._assert_owned()
            document = documents.require_pipeline_indexing_document(session, ref, execution=self._execution)
            side_effect_started = True
            index_processor.index(dataset, document, chunks, session)
            documents.commit_pipeline_indexing_phase(session, ref, execution=self._execution)

            self._assert_owned()
            documents.complete_pipeline_indexing(
                session,
                ref,
                latency=time.perf_counter() - indexing_started_at,
                need_summary=bool(summary_index_setting and summary_index_setting.get("enable") is True),
                execution=self._execution,
            )

            return IndexingResultDict(
                dataset_id=dataset_id,
                dataset_name=dataset_name,
                batch=batch,
                document_id=document_id,
                document_name=document_name,
                created_at=created_at.timestamp(),
                display_status="completed",
            )
        except (
            DocumentIndexingExecutionClaimLostError,
            DocumentIndexingGenerationChangedError,
            KnowledgeIndexingLeaseLostError,
        ):
            if side_effect_started:
                try:
                    session.rollback()
                except Exception:
                    logger.exception("Failed to roll back stale pipeline indexing transaction")
                    session.close()
                self._repair_stale_execution()
            raise


class IndexingExecutionAdapter:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        documents: SQLAlchemyDocumentRepository,
        segments: SQLAlchemySegmentRepository,
        uploads: SQLAlchemyKnowledgeUploadRepository,
        sources: CompositeStoredSourceResolver,
    ) -> None:
        self._session_factory = session_factory
        self._documents = documents
        self._segments = segments
        self._uploads = uploads
        self._sources = sources

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

    def extract(self, document: IndexingDocument) -> list[Document]:
        self._assert_owned(document)
        if not document.processing_rule:
            raise ValueError("no process rule found")
        setting = self._sources.resolve_for_indexing(document.source)
        processor = IndexProcessorFactory(document.doc_form).init_index_processor()
        # Legacy extractors persist downloaded images and Notion source metadata.
        # Their session is independent of document-state write transactions.
        with self._session_factory() as session:
            texts = processor.extract(setting, process_rule_mode=document.processing_rule["mode"], session=session)
            self._assert_owned(document)
            session.commit()
        for text in texts:
            text.metadata.update(document_id=document.ref.document_id, dataset_id=document.ref.dataset.dataset_id)
        return texts

    def transform(self, document: IndexingDocument, texts: list[Document]) -> list[Document]:
        self._assert_owned(document)
        dataset, _ = self._get_indexing_models(document)
        user = self._get_indexing_user(document)
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
        processor = IndexProcessorFactory(document.doc_form).init_index_processor()
        with self._session_factory() as session:
            chunks = processor.transform(
                texts,
                user,
                embedding_model_instance=model,
                process_rule=document.processing_rule,
                tenant_id=dataset.tenant_id,
                doc_language=document.doc_language,
                session=session,
            )
            self._assert_owned(document)
            session.commit()
        return chunks

    def count_tokens(self, document: IndexingDocument, chunks: list[Document]) -> list[int]:
        self._assert_owned(document)
        dataset, _ = self._get_indexing_models(document)
        return calculate_segment_token_counts(dataset=dataset, documents=chunks)

    def ensure_admission(self, document: IndexingDocument, chunks: list[Document]) -> None:
        self._assert_owned(document)
        dataset, _ = self._get_indexing_models(document)
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
        self._assert_owned(document)
        dataset, _ = self._get_indexing_models(document)
        app = cast(LocalProxy[Flask], current_app)._get_current_object()
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            groups: list[list[Document]] = [[] for _ in range(10)]
            for chunk in chunks:
                groups[int(helper.generate_text_hash(chunk.page_content), 16) % 10].append(chunk)
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = [
                    executor.submit(
                        propagate_context(self._process_chunk),
                        app,
                        document.ref,
                        group,
                        False,
                        document,
                    )
                    for group in groups
                    if group
                ]
                for future in futures:
                    future.result()
        elif (
            dataset.indexing_technique == IndexTechniqueType.ECONOMY
            and document.doc_form != IndexStructureType.PARENT_CHILD_INDEX
        ):
            # A future propagates keyword failures; Thread.join() used to hide
            # them and incorrectly let the document become completed.
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(
                    propagate_context(self._process_chunk), app, document.ref, chunks, True, document
                ).result()
        self._assert_owned(document)

    def _process_chunk(
        self,
        app: Flask,
        ref: DocumentRef,
        chunks: list[Document],
        keywords: bool,
        indexing_document: IndexingDocument | None = None,
    ) -> None:
        with app.app_context():
            self._assert_owned(indexing_document)
            self.check_paused(ref)
            # Workers load their own inputs and own their sessions. No ORM
            # instance or session crosses the executor boundary.
            if indexing_document is None or indexing_document.execution is None:
                dataset, document = self._documents.get_indexing_models(ref)
            else:
                dataset, document = self._documents.get_indexing_models(ref, execution=indexing_document.execution)
            if keywords:
                # Keep the read/modify/write lock while each repository call
                # closes its transaction before keyword extraction or storage I/O.
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
                files = self._uploads.get_files(
                    workspace_id=ref.dataset.tenant_id,
                    file_ids=[attachment.metadata["doc_id"] for attachment in attachments],
                )
                # All database inputs are materialized before initializing the
                # vector backend, embedding text/images, or reading object storage.
                vector = Vector(dataset, session=None, vector_type=vector_type)
                if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    for chunk in chunks:
                        if chunk.children:
                            self._assert_owned(indexing_document)
                            vector.create([Document.model_validate(child.model_dump()) for child in chunk.children])
                else:
                    self._assert_owned(indexing_document)
                    vector.create(chunks)
                if attachments:
                    self._assert_owned(indexing_document)
                    vector.create_multimodal(attachments, upload_files=files)
            self._assert_owned(indexing_document)
            self.check_paused(ref)
            self._segments.complete_indexing_segments(
                ref,
                [chunk.metadata["doc_id"] for chunk in chunks],
                execution=indexing_document.execution if indexing_document is not None else None,
            )
            self._assert_owned(indexing_document)

    @staticmethod
    def _assert_owned(document: IndexingDocument | None) -> None:
        if document is not None and document.execution is not None:
            document.execution.assert_owned()

    def _get_indexing_models(self, document: IndexingDocument):
        if document.execution is None:
            return self._documents.get_indexing_models(document.ref)
        return self._documents.get_indexing_models(document.ref, execution=document.execution)

    def _get_indexing_user(self, document: IndexingDocument):
        if document.execution is None:
            return self._documents.get_indexing_user(document.ref)
        return self._documents.get_indexing_user(document.ref, execution=document.execution)


def build_document_indexing_service(
    *,
    session_factory: sessionmaker[Session],
    enforce_vector_space_admission: bool = False,
) -> DocumentIndexingService:
    """Assemble a fresh indexing use case from explicit database dependencies."""
    documents = SQLAlchemyDocumentRepository(session_factory=session_factory)
    segments = SQLAlchemySegmentRepository(
        session_factory=session_factory,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=session_factory)
    credentials = build_data_source_credentials(database_client=session_factory)
    sources = CompositeStoredSourceResolver(
        adapters={
            DataSourceType.UPLOAD_FILE: FileSourceAdapter(uploads=uploads),
            DataSourceType.NOTION_IMPORT: NotionSourceResolver(
                actor_credentials=credentials.actor, stored_credentials=credentials.stored
            ),
            DataSourceType.WEBSITE_CRAWL: WebsiteSourceAdapter(),
        }
    )
    return DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=IndexingExecutionAdapter(
            session_factory=session_factory, documents=documents, segments=segments, uploads=uploads, sources=sources
        ),
        enforce_vector_space_admission=enforce_vector_space_admission,
    )
