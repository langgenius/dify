"""Indexing adapters that materialize database inputs before external I/O."""

import logging
from collections.abc import Callable, Mapping, Sequence
from typing import cast
from uuid import uuid4

from sqlalchemy.orm import Session

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.entities import Rule
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models.dataset import DocumentSegmentSummary
from models.enums import SegmentType
from repositories.knowledge.segment_repository import (
    DatasetIndexingSnapshot,
    SegmentIndexingSnapshot,
    SQLAlchemySegmentRepository,
)
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository, prepare_summary_generation
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.entities.segments import ChildChunkRecord
from services.knowledge.resource_scope import DocumentRef, SegmentRef
from services.knowledge.segments.adapters import RedisSegmentClient
from services.knowledge.segments.contracts import (
    ChildChunkState,
    SegmentChildIndexCompletion,
    SegmentDatasetRecord,
    SegmentIndexReconcileOutcome,
)
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.knowledge.summaries.application import SummaryVectorInput, SummaryWriteFence

logger = logging.getLogger(__name__)


class SegmentIndexingGateway:
    def __init__(
        self,
        *,
        segments: SQLAlchemySegmentRepository,
        uploads: SQLAlchemyKnowledgeUploadRepository,
        redis: RedisSegmentClient,
        new_session: Callable[[], Session],
    ) -> None:
        self._segments = segments
        self._uploads = uploads
        self._redis = redis
        self._new_session = new_session

    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int:
        return self.count_tokens_many(dataset, [text])[0]

    def count_tokens_many(self, dataset: SegmentDatasetRecord, texts: Sequence[str]) -> Sequence[int]:
        if dataset.indexing_technique != "high_quality":
            return [0] * len(texts)
        model = ModelManager.for_tenant(tenant_id=dataset.workspace_id).get_model_instance(
            tenant_id=dataset.workspace_id,
            provider=dataset.embedding_model_provider or "",
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model or "",
        )
        return model.get_text_embedding_num_tokens(texts=list(texts))

    @staticmethod
    def _vector(snapshot: SegmentIndexingSnapshot | DatasetIndexingSnapshot) -> Vector:
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

    @staticmethod
    def _summary_fence(snapshot: SegmentIndexingSnapshot) -> SummaryWriteFence:
        """Freeze the owner generations and model configuration before summary I/O."""

        setting = snapshot.dataset.summary_index_setting
        return SummaryWriteFence(
            expected_document_generation=snapshot.document.indexing_generation,
            enforce_document_generation=True,
            expected_segment_generation=snapshot.segment.indexing_generation,
            enforce_segment_generation=True,
            expected_indexing_technique=str(snapshot.dataset.indexing_technique),
            expected_embedding_model_provider=snapshot.dataset.embedding_model_provider,
            expected_embedding_model=snapshot.dataset.embedding_model,
            expected_summary_index_setting=dict(setting) if setting is not None else None,
            enforce_summary_index_setting=True,
        )

    @staticmethod
    def _summary_command(
        segment_ref: SegmentRef,
        record: DocumentSegmentSummary,
        fence: SummaryWriteFence,
    ) -> SummaryVectorInput:
        return SummaryVectorInput(
            segment_ref,
            record.id,
            record.summary_content or "",
            record.summary_index_node_id,
            fence,
        )

    def _prepare_manual_summary(
        self,
        segment_ref: SegmentRef,
        snapshot: SegmentIndexingSnapshot,
        fence: SummaryWriteFence,
        content: str,
    ) -> DocumentSegmentSummary:
        previous = snapshot.summary
        prepare_command = SummaryVectorInput(
            segment_ref,
            previous.id if previous is not None else str(uuid4()),
            previous.summary_content or "" if previous is not None else "",
            previous.summary_index_node_id if previous is not None else None,
            fence,
        )
        with self._new_session() as session:
            prepared = prepare_summary_generation(
                session,
                dataset_id=snapshot.dataset.id,
                segment=snapshot.segment,
                command=prepare_command,
            )
            record_id = prepared.id
            previous_node_id = prepared.summary_index_node_id
            session.commit()
        record = previous or DocumentSegmentSummary(
            dataset_id=snapshot.dataset.id,
            document_id=snapshot.document.id,
            chunk_id=snapshot.segment.id,
            summary_content=content,
        )
        record.id = record_id
        record.summary_content = content
        record.summary_index_node_id = previous_node_id
        return record

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def create_many(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None,
        attachment_ids_list: Sequence[Sequence[str]] | None = None,
    ) -> None:
        """Materialize the whole scoped batch before indexing any of its records."""
        if attachment_ids_list is not None:
            if len(attachment_ids_list) != len(segment_ids):
                raise ValueError("Attachments must correspond to the segment batch")
            requested_ids = tuple(attachment_id for ids in attachment_ids_list for attachment_id in ids)
            files = self._uploads.get_files(
                workspace_id=document_ref.dataset.tenant_id,
                file_ids=requested_ids,
            )
            for segment_id, attachment_ids in zip(segment_ids, attachment_ids_list, strict=True):
                owned_ids = tuple(dict.fromkeys(file_id for file_id in attachment_ids if file_id in files))
                self._segments.replace_attachments(document_ref.segment(segment_id), owned_ids)
        snapshots = self._segments.get_indexing_snapshots(document_ref, segment_ids)
        if not snapshots:
            return
        first = snapshots[0]
        documents = [self._document(snapshot) for snapshot in snapshots]
        if first.document.doc_form == "hierarchical_model":
            for snapshot in snapshots:
                self._regenerate_children(document_ref.segment(snapshot.segment.id), snapshot, replace_existing=False)
        elif first.dataset.indexing_technique == "high_quality":
            self._vector(first).create(documents)
        elif first.document.doc_form != "qa_model":
            self._write_keywords(document_ref, first, documents, keywords_list, replace_existing=False)
        if first.dataset.is_multimodal:
            files = self._uploads.get_files(
                workspace_id=document_ref.dataset.tenant_id,
                file_ids=tuple(attachment_id for snapshot in snapshots for attachment_id in snapshot.attachment_ids),
            )
            attachments = [
                document
                for snapshot in snapshots
                for document in self._attachment_documents(
                    snapshot, [files[file_id] for file_id in snapshot.attachment_ids if file_id in files]
                )
            ]
            if attachments and first.dataset.indexing_technique == "high_quality":
                self._vector(first).create_multimodal(attachments, upload_files=files)

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def reconcile_created(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        batch_job_id: str | None,
        assert_owned: Callable[[], None],
    ) -> SegmentIndexReconcileOutcome:
        """Idempotently materialize the committed state of newly created segments."""

        snapshots = self._segments.get_indexing_snapshots(document_ref, segment_ids)
        if not snapshots:
            return SegmentIndexReconcileOutcome.CANCELLED
        first = snapshots[0]
        documents = [self._document(snapshot) for snapshot in snapshots]
        if first.document.doc_form == "hierarchical_model":
            completion = SegmentChildIndexCompletion(
                generation=generation,
                batch_segment_ids=tuple(segment_ids),
                batch_job_id=batch_job_id,
            )
            for snapshot in snapshots:
                if snapshot.process_rule is None:
                    raise ValueError("No processing rule found.")
                self._regenerate_children(
                    document_ref.segment(snapshot.segment.id),
                    snapshot,
                    replace_existing=True,
                    completion=completion,
                    assert_owned=assert_owned,
                )
            return SegmentIndexReconcileOutcome.WAITING
        elif first.dataset.indexing_technique == "high_quality":
            vector = self._vector(first)
            node_ids = [snapshot.segment.index_node_id for snapshot in snapshots if snapshot.segment.index_node_id]
            if node_ids:
                assert_owned()
                vector.delete_by_ids(node_ids)
            assert_owned()
            vector.add_texts(documents, duplicate_check=True)
        elif first.document.doc_form != "qa_model":
            keywords_list = [
                snapshot.segment.keywords
                if isinstance(snapshot.segment.keywords, list)
                and all(isinstance(keyword, str) for keyword in snapshot.segment.keywords)
                else None
                for snapshot in snapshots
            ]
            assert_owned()
            self._write_keywords(document_ref, first, documents, keywords_list, replace_existing=True)
        if first.dataset.is_multimodal and first.dataset.indexing_technique == "high_quality":
            files = self._uploads.get_files(
                workspace_id=document_ref.dataset.tenant_id,
                file_ids=tuple(attachment_id for snapshot in snapshots for attachment_id in snapshot.attachment_ids),
            )
            attachments = [
                document
                for snapshot in snapshots
                for document in self._attachment_documents(
                    snapshot,
                    [files[file_id] for file_id in snapshot.attachment_ids if file_id in files],
                )
            ]
            if attachments:
                assert_owned()
                self._vector(first).create_multimodal(attachments, upload_files=files)
        return SegmentIndexReconcileOutcome.COMPLETED

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
        self,
        segment_ref: SegmentRef,
        snapshot: SegmentIndexingSnapshot,
        *,
        replace_existing: bool,
        completion: SegmentChildIndexCompletion | None = None,
        assert_owned: Callable[[], None] | None = None,
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
        if assert_owned is not None:
            assert_owned()
        self._segments.save_children(
            segment_ref,
            added=added,
            deleted=previous if replace_existing else (),
            completion=completion,
        )

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def reconcile_children(self, segment_ref: SegmentRef, *, delete_node_ids: Sequence[str]) -> None:
        unique_delete_ids = list(dict.fromkeys(delete_node_ids))
        try:
            snapshot = self._segments.get_indexing_snapshot(segment_ref)
        except (IndexError, LookupError):
            dataset_snapshot = self._segments.get_dataset_indexing_snapshot(segment_ref.document.dataset)
            if (
                dataset_snapshot is not None
                and dataset_snapshot.dataset.indexing_technique == "high_quality"
                and unique_delete_ids
            ):
                self._vector(dataset_snapshot).delete_by_ids(unique_delete_ids)
            return
        if snapshot.dataset.indexing_technique != "high_quality":
            return
        vector = self._vector(snapshot)
        if unique_delete_ids:
            vector.delete_by_ids(unique_delete_ids)
        children = self._segments.get_children(segment_ref)
        if children is None:
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
            for child in children
        ]
        if documents and snapshot.segment.enabled and str(snapshot.segment.status) in {"completed", "indexing"}:
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
            removed_ids = tuple(set(snapshot.attachment_ids).difference(files))
            delete_ids = self._segments.filter_attachment_ids_without_active_references(
                segment_ref.document,
                removed_ids,
                excluding_segment_ids=(segment_ref.segment_id,),
            )
            if delete_ids:
                vector.delete_by_ids(list(delete_ids))
            added_files = {file_id: file for file_id, file in files.items() if file_id not in snapshot.attachment_ids}
            if added_files:
                vector.create_multimodal(
                    self._attachment_documents(snapshot, added_files.values()), upload_files=added_files
                )
        self._segments.replace_attachments(segment_ref, tuple(files))

    def update_summary(self, segment_ref: SegmentRef, *, summary: str | None, content_changed: bool) -> None:
        if summary is None and not content_changed:
            return
        snapshot = self._segments.get_indexing_snapshot(segment_ref)
        if snapshot.dataset.indexing_technique != "high_quality" or snapshot.document.doc_form == "qa_model":
            return
        setting = snapshot.dataset.summary_index_setting
        previous = snapshot.summary
        fence = self._summary_fence(snapshot)
        store = SQLAlchemySummaryRepository(new_session=self._new_session)
        if summary is None or (previous is not None and summary == previous.summary_content):
            if not (content_changed and previous and setting and setting.get("enable") is True):
                return
            with self._new_session() as session:
                SummaryIndexAdapter.generate_and_vectorize_summary(
                    snapshot.segment,
                    snapshot.dataset,
                    cast(SummaryIndexSettingDict, dict(setting)),
                    session=session,
                    fence=fence,
                    new_session=self._new_session,
                    vector_factory=lambda: self._vector(snapshot),
                )
            return
        assert summary is not None
        if not summary.strip():
            if previous is None:
                return
            node_id = store.delete(self._summary_command(segment_ref, previous, fence))
            if node_id:
                try:
                    self._vector(snapshot).delete_by_ids([node_id])
                except Exception:
                    logger.exception("Failed to delete summary vector for %s", segment_ref.segment_id)
            return
        record = self._prepare_manual_summary(segment_ref, snapshot, fence, summary)
        command = self._summary_command(segment_ref, record, fence)
        store.generated(command)
        SummaryIndexAdapter.vectorize_summary(
            record,
            snapshot.segment,
            snapshot.dataset,
            new_session=self._new_session,
            vector_factory=lambda: self._vector(snapshot),
            fence=fence,
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
        self._write_keywords(
            segment_ref.document, snapshot, [self._document(snapshot)], [keywords], replace_existing=replace_existing
        )

    def _write_keywords(
        self,
        document_ref: DocumentRef,
        snapshot: SegmentIndexingSnapshot,
        documents: list[Document],
        keywords_list: Sequence[Sequence[str] | None] | None,
        *,
        replace_existing: bool,
    ) -> None:
        dataset_ref = document_ref.dataset

        def persist(storage_type: str, data: str, selected: Mapping[str, Sequence[str]]) -> None:
            self._segments.save_keyword_table(dataset_ref, storage_type=storage_type, data=data, keywords=selected)

        Jieba(snapshot.dataset).update_texts(
            documents,
            read=lambda: self._segments.get_keyword_table(dataset_ref),
            write=persist,
            lock=self._redis.lock(f"keyword_indexing_lock_{snapshot.dataset.id}", timeout=600),
            keywords_list=keywords_list,
            replace_existing=replace_existing,
        )
