"""Indexing adapters that materialize database inputs before external I/O."""

import logging
from collections.abc import Callable, Mapping, Sequence
from uuid import uuid4

from sqlalchemy.orm import Session

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.entities import Rule
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models.enums import SegmentType
from repositories.knowledge.segment_repository import SegmentIndexingSnapshot, SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.entities.knowledge_entities.segments import ChildChunkRecord
from services.knowledge.resource_scope import DocumentRef, SegmentRef
from services.knowledge.segments.adapters import RedisSegmentClient
from services.knowledge.segments.application import ChildChunkState, SegmentDatasetRecord, SegmentIndexTarget
from services.summary_index_service import SummaryIndexService

logger = logging.getLogger(__name__)


class SegmentIndexingGateway:
    def __init__(
        self,
        *,
        segments: SQLAlchemySegmentRepository,
        uploads: SQLAlchemyKnowledgeUploadRepository,
        redis: RedisSegmentClient,
        new_session: Callable[[], Session],
        delete_task: Callable[..., object],
        enable_task: Callable[..., object],
        disable_task: Callable[..., object],
    ) -> None:
        self._segments = segments
        self._uploads = uploads
        self._redis = redis
        self._new_session = new_session
        self._delete_task = delete_task
        self._enable_task = enable_task
        self._disable_task = disable_task

    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int:
        if dataset.indexing_technique != "high_quality":
            return 0
        model = ModelManager.for_tenant(tenant_id=dataset.workspace_id).get_model_instance(
            tenant_id=dataset.workspace_id,
            provider=dataset.embedding_model_provider or "",
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model or "",
        )
        return model.get_text_embedding_num_tokens(texts=[text])[0]

    @staticmethod
    def _vector(snapshot: SegmentIndexingSnapshot) -> Vector:
        return Vector(snapshot.dataset, session=None, vector_type=snapshot.vector_type)

    @staticmethod
    def _document(snapshot: SegmentIndexingSnapshot) -> Document:
        segment = snapshot.segment
        return Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
                "doc_type": DocType.TEXT,
            },
        )

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def create(self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, attachment_ids: Sequence[str]) -> None:
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        files = self._uploads.get_files(workspace_id=segment_ref.document.dataset.tenant_id, file_ids=attachment_ids)
        self._segments.replace_attachments(segment_ref, tuple(files))
        if snapshot.document.doc_form == "hierarchical_model":
            self._regenerate_children(segment_ref, snapshot, replace_existing=False)
        elif snapshot.dataset.indexing_technique == "high_quality":
            self._vector(snapshot).create([self._document(snapshot)])
        else:
            self._update_keywords(segment_ref, snapshot, keywords, replace_existing=False)
        if files and snapshot.dataset.is_multimodal:
            self._vector(snapshot).create_multimodal(
                self._attachment_documents(snapshot, files.values()), upload_files=files
            )

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def update(self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, regenerate_children: bool) -> None:
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        if regenerate_children:
            self._regenerate_children(segment_ref, snapshot, replace_existing=True)
        elif snapshot.dataset.indexing_technique == "high_quality":
            vector = self._vector(snapshot)
            assert snapshot.segment.index_node_id is not None
            vector.delete_by_ids([snapshot.segment.index_node_id])
            vector.add_texts([self._document(snapshot)], duplicate_check=True)
        else:
            self._update_keywords(segment_ref, snapshot, keywords, replace_existing=True)

    def _regenerate_children(
        self, segment_ref: SegmentRef, snapshot: SegmentIndexingSnapshot, *, replace_existing: bool
    ) -> None:
        if snapshot.dataset.indexing_technique != "high_quality":
            raise ValueError("The knowledge base index technique is not high quality!")
        rule = snapshot.process_rule
        if rule is None:
            if replace_existing:
                return
            raise ValueError("No processing rule found.")
        manager = ModelManager.for_tenant(tenant_id=snapshot.dataset.tenant_id)
        model = (
            manager.get_model_instance(
                tenant_id=snapshot.dataset.tenant_id,
                provider=snapshot.dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=snapshot.dataset.embedding_model,
            )
            if snapshot.dataset.embedding_model_provider
            else manager.get_default_model_instance(
                tenant_id=snapshot.dataset.tenant_id, model_type=ModelType.TEXT_EMBEDDING
            )
        )
        children = ParentChildIndexProcessor().split_child_nodes(
            self._document(snapshot), Rule.model_validate(rule.to_dict()["rules"]), rule.mode, model
        )
        previous = self._segments.get_children(segment_ref) or ()
        vector = self._vector(snapshot)
        if replace_existing and previous:
            vector.delete_by_ids([child.index_node_id for child in previous if child.index_node_id])
        if children:
            vector.create([Document.model_validate(child.model_dump()) for child in children])
        now = naive_utc_now()
        added = tuple(
            ChildChunkState(
                data=ChildChunkRecord(
                    id=str(uuid4()),
                    segment_id=segment_ref.segment_id,
                    content=child.page_content,
                    position=position,
                    word_count=len(child.page_content),
                    type=SegmentType.AUTOMATIC,
                    created_at=now,
                    updated_at=now,
                ),
                index_node_id=child.metadata["doc_id"],
                index_node_hash=child.metadata["doc_hash"],
                created_by=snapshot.document.created_by,
            )
            for position, child in enumerate(children, start=1)
        )
        self._segments.save_children(segment_ref, added=added, deleted=previous if replace_existing else ())

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def update_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None:
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        if snapshot.dataset.indexing_technique != "high_quality":
            return
        documents = [
            Document(
                page_content=child.data.content,
                metadata={
                    "doc_id": child.index_node_id,
                    "doc_hash": child.index_node_hash,
                    "document_id": segment_ref.document.document_id,
                    "dataset_id": segment_ref.document.dataset.dataset_id,
                },
            )
            for child in (*added, *updated)
        ]
        vector = self._vector(snapshot)
        deleted_ids = []
        for child in (*updated, *deleted):
            assert child.index_node_id is not None
            deleted_ids.append(child.index_node_id)
        if deleted_ids:
            vector.delete_by_ids(deleted_ids)
        if documents:
            vector.add_texts(documents, duplicate_check=True)

    @staticmethod
    def _attachment_documents(snapshot: SegmentIndexingSnapshot, files) -> list[Document]:
        return [
            Document(
                page_content=file.name,
                metadata={
                    "doc_id": file.id,
                    "doc_hash": "",
                    "dataset_id": snapshot.dataset.id,
                    "document_id": snapshot.document.id,
                    "doc_type": DocType.IMAGE,
                },
            )
            for file in files
        ]

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def update_attachments(self, segment_ref: SegmentRef, attachment_ids: Sequence[str]) -> None:
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        if snapshot.dataset.indexing_technique != "high_quality" or set(snapshot.attachment_ids) == set(attachment_ids):
            return
        files = self._uploads.get_files(workspace_id=snapshot.dataset.tenant_id, file_ids=attachment_ids)
        if snapshot.dataset.is_multimodal:
            vector = self._vector(snapshot)
            if snapshot.attachment_ids:
                vector.delete_by_ids(list(snapshot.attachment_ids))
            if files:
                vector.create_multimodal(self._attachment_documents(snapshot, files.values()), upload_files=files)
        self._segments.replace_attachments(segment_ref, tuple(files))

    def update_summary(self, segment_ref: SegmentRef, *, summary: str | None, content_changed: bool) -> None:
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        if snapshot.dataset.indexing_technique != "high_quality" or snapshot.document.doc_form == "qa_model":
            return
        setting = snapshot.dataset.summary_index_setting
        previous = snapshot.summary
        if summary is None or (previous is not None and summary == previous.summary_content):
            if not (content_changed and previous and setting and setting.get("enable") is True):
                return
            try:
                self._segments.save_summary(segment_ref, previous.summary_content or "")
                summary, _ = ParagraphIndexProcessor.generate_summary_from_inputs(
                    snapshot.dataset.tenant_id,
                    snapshot.segment.content,
                    setting,
                    document_language=snapshot.document.doc_language,
                    image_loader=lambda: self._segments.get_summary_images(segment_ref),
                )
                if not summary.strip():
                    raise ValueError("Generated summary is empty")
            except Exception as error:
                self._segments.save_summary(segment_ref, previous.summary_content or "", error=str(error))
                raise
        if not summary.strip():
            if previous and previous.summary_index_node_id:
                try:
                    self._vector(snapshot).delete_by_ids([previous.summary_index_node_id])
                except Exception:
                    logger.exception("Failed to delete summary vector for %s", segment_ref.segment_id)
            self._segments.save_summary(segment_ref, None)
            return
        record = self._segments.save_summary(segment_ref, summary)
        assert record is not None
        SummaryIndexService.vectorize_summary(
            record,
            snapshot.segment,
            snapshot.dataset,
            new_session=self._new_session,
            vector_factory=lambda: self._vector(snapshot),
        )

    def _update_keywords(
        self,
        segment_ref: SegmentRef,
        snapshot: SegmentIndexingSnapshot,
        keywords: Sequence[str] | None,
        *,
        replace_existing: bool,
    ) -> None:
        assert snapshot.segment.index_node_id is not None
        dataset_ref = segment_ref.document.dataset

        def persist(storage_type: str, data: str, selected: Mapping[str, Sequence[str]]) -> None:
            self._segments.save_keyword_table(dataset_ref, storage_type=storage_type, data=data, keywords=selected)

        Jieba(snapshot.dataset).update_texts(
            [self._document(snapshot)],
            read=lambda: self._segments.get_keyword_table(dataset_ref),
            write=persist,
            lock=self._redis.lock(f"keyword_indexing_lock_{snapshot.dataset.id}", timeout=600),
            keywords_list=[keywords],
            replace_existing=replace_existing,
        )

    def delete(
        self, document_ref: DocumentRef, segments: Sequence[SegmentIndexTarget], children: Sequence[ChildChunkState]
    ) -> None:
        self._delete_task(
            [segment.index_node_id for segment in segments],
            document_ref.dataset.dataset_id,
            document_ref.document_id,
            [segment.id for segment in segments],
            [child.index_node_id for child in children if child.index_node_id],
        )

    def change_status(self, document_ref: DocumentRef, segment_ids: Sequence[str], action: str) -> None:
        task = self._enable_task if action == "enable" else self._disable_task
        task(list(segment_ids), document_ref.dataset.dataset_id, document_ref.document_id)
