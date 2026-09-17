"""Adapt legacy processors to committed document-indexing phases."""

from concurrent.futures import ThreadPoolExecutor
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.local import LocalProxy

from core.model_manager import ModelManager
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_redis import redis_client
from extensions.otel import propagate_context
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from models.enums import DataSourceType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingDocument
from services.knowledge.resource_scope import DocumentRef
from services.vector_space_admission_service import VectorSpaceAdmissionService


class IndexingExecutionAdapter:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        documents: SQLAlchemyDocumentRepository,
        segments: SQLAlchemySegmentRepository,
        sources: CompositeStoredSourceResolver,
    ) -> None:
        self._session_factory = session_factory
        self._documents = documents
        self._segments = segments
        self._sources = sources

    def check_paused(self, ref: DocumentRef) -> None:
        if redis_client.get(f"document_{ref.document_id}_is_paused"):
            raise DocumentIsPausedError(f"Document paused, document id: {ref.document_id}")

    def extract(self, document: IndexingDocument) -> list[Document]:
        if not document.processing_rule:
            raise ValueError("no process rule found")
        setting = self._sources.resolve_for_indexing(document.source)
        processor = IndexProcessorFactory(document.doc_form).init_index_processor()
        # Legacy extractors persist downloaded images and Notion source metadata.
        # Their session is independent of document-state write transactions.
        with self._session_factory() as session:
            texts = processor.extract(setting, process_rule_mode=document.processing_rule["mode"], session=session)
            session.commit()
        for text in texts:
            text.metadata.update(document_id=document.ref.document_id, dataset_id=document.ref.dataset.dataset_id)
        return texts

    def transform(self, document: IndexingDocument, texts: list[Document]) -> list[Document]:
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
            session.commit()
        return chunks

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
                    executor.submit(
                        propagate_context(self._process_chunk),
                        app,
                        document.ref,
                        group,
                        False,
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
                executor.submit(propagate_context(self._process_chunk), app, document.ref, chunks, True).result()

    def _process_chunk(self, app: Flask, ref: DocumentRef, chunks: list[Document], keywords: bool) -> None:
        with app.app_context():
            self.check_paused(ref)
            # Workers load their own inputs and own their sessions. No ORM
            # instance or session crosses the executor boundary.
            dataset, document = self._documents.get_indexing_models(ref)
            with self._session_factory() as session:
                if keywords:
                    Keyword(dataset).create(chunks, session)
                else:
                    attachments = (
                        [attachment for chunk in chunks for attachment in chunk.attachments or []]
                        if dataset.is_multimodal
                        else []
                    )
                    IndexProcessorFactory(document.doc_form).init_index_processor().load(
                        dataset,
                        chunks,
                        multimodal_documents=attachments,
                        with_keywords=False,
                        session=session,
                    )
                # Vector/keyword implementations still use this local session
                # for their own metadata. Commit it before document state writes.
                session.commit()
            self.check_paused(ref)
            self._segments.complete_indexing_segments(ref, [chunk.metadata["doc_id"] for chunk in chunks])


def build_document_indexing_service(
    *,
    session_factory: sessionmaker[Session],
    enforce_vector_space_admission: bool = False,
) -> DocumentIndexingService:
    """Assemble a fresh indexing use case from explicit database dependencies."""
    documents = SQLAlchemyDocumentRepository(session_factory=session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=session_factory)
    credentials = build_data_source_credentials(database_client=session_factory)
    sources = CompositeStoredSourceResolver(
        adapters={
            DataSourceType.UPLOAD_FILE: FileSourceAdapter(
                uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=session_factory)
            ),
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
            session_factory=session_factory, documents=documents, segments=segments, sources=sources
        ),
        enforce_vector_space_admission=enforce_vector_space_admission,
    )
