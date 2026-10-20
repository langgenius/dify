import json
import logging
from collections import defaultdict
from typing import Any, cast

from sqlalchemy import and_, func, literal, or_, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt, wait_exponential

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities import DocumentContext, MetadataFilteringCondition, RetrievalSourceMetadata
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.tools.signature import sign_upload_file_preview_url
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.knowledge_retrieval.retrieval import (
    KnowledgeRetrievalRequest,
    Source,
    SourceChildChunk,
    SourceMetadata,
)
from graphon.file import File, FileTransferMethod, FileType
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetMetadata,
    DatasetQuery,
    DocumentSegment,
    RateLimitLog,
    SegmentAttachmentBinding,
)
from models.dataset import Document as DatasetDocument
from models.dataset import Document as DocumentModel
from models.enums import CreatorUserRole, DatasetQuerySource
from models.model import App
from repositories.knowledge.dataset_read_repository import authorize_retrieved_segment
from repositories.knowledge.external_retrieval_repository import prepare_external_retrieval
from repositories.knowledge.segment_read_adapter import sign_segment_content
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)

logger = logging.getLogger(__name__)

_POSTGRES_DEADLOCK_SQLSTATE = "40P01"
_HIT_COUNT_UPDATE_MAX_ATTEMPTS = 3


def _is_postgres_deadlock_error(exc: BaseException) -> bool:
    if not isinstance(exc, DBAPIError) or exc.orig is None:
        return False
    orig = cast(Any, exc.orig)
    return (hasattr(orig, "sqlstate") and orig.sqlstate == _POSTGRES_DEADLOCK_SQLSTATE) or (
        hasattr(orig, "pgcode") and orig.pgcode == _POSTGRES_DEADLOCK_SQLSTATE
    )


class KnowledgeRetrievalRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def available_datasets(self, tenant_id: str, dataset_ids: list[str]) -> list[Dataset]:
        with self._sessions() as session:
            subquery = (
                select(DocumentModel.dataset_id, func.count(DocumentModel.id).label("available_document_count"))
                .where(
                    DocumentModel.indexing_status == "completed",
                    DocumentModel.enabled == True,
                    DocumentModel.archived == False,
                    DocumentModel.dataset_id.in_(dataset_ids),
                )
                .group_by(DocumentModel.dataset_id)
                .having(func.count(DocumentModel.id) > 0)
                .subquery()
            )

            results = session.scalars(
                select(Dataset)
                .outerjoin(subquery, Dataset.id == subquery.c.dataset_id)
                .where(
                    Dataset.tenant_id == tenant_id,
                    Dataset.id.in_(dataset_ids),
                    (subquery.c.available_document_count > 0) | (Dataset.provider == "external"),
                )
            ).all()

        available_datasets = []
        for dataset in results:
            if not dataset:
                continue
            available_datasets.append(dataset)
        return available_datasets

    def metadata_fields(self, tenant_id: str, dataset_ids: list[str]) -> list[str]:
        with self._sessions() as session:
            return list(
                session.scalars(
                    select(DatasetMetadata.name).where(
                        DatasetMetadata.tenant_id == tenant_id, DatasetMetadata.dataset_id.in_(dataset_ids)
                    )
                )
            )

    def dataset(self, tenant_id: str, dataset_id: str) -> Dataset | None:
        with self._sessions() as session:
            return session.scalar(select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id))

    def filter_documents(
        self, tenant_id: str, dataset_ids: list[str], condition: MetadataFilteringCondition | None
    ) -> dict[str, list[str]] | None:
        filters = []
        if condition:
            for sequence, item in enumerate(condition.conditions or []):
                self.process_metadata_filter_func(sequence, item.comparison_operator, item.name, item.value, filters)
        query = select(DatasetDocument.dataset_id, DatasetDocument.id).where(
            DatasetDocument.tenant_id == tenant_id,
            DatasetDocument.dataset_id.in_(dataset_ids),
            DatasetDocument.indexing_status == "completed",
            DatasetDocument.enabled == True,
            DatasetDocument.archived == False,
        )
        if condition is not None and filters:
            query = query.where(and_(*filters) if condition.logical_operator == "and" else or_(*filters))
        with self._sessions() as session:
            rows = session.execute(query).all()
        if not rows:
            return None
        result: dict[str, list[str]] = defaultdict(list)
        for dataset_id, document_id in rows:
            result[dataset_id].append(document_id)
        return result

    @classmethod
    def process_metadata_filter_func(
        cls, sequence: int, condition: str, metadata_name: str, value: Any | None, filters: list
    ):
        if value is None and condition not in ("empty", "not empty"):
            return filters

        json_field = DatasetDocument.doc_metadata[metadata_name].as_string()

        from libs.helper import escape_like_pattern

        match condition:
            case "contains":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"%{escaped_value}%", escape="\\"))

            case "not contains":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.notlike(f"%{escaped_value}%", escape="\\"))

            case "start with":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"{escaped_value}%", escape="\\"))

            case "end with":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"%{escaped_value}", escape="\\"))

            case "is" | "=":
                match value:
                    case str():
                        filters.append(json_field == value)
                    case int() | float():
                        filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() == value)

            case "is not" | "≠":
                match value:
                    case str():
                        filters.append(json_field != value)
                    case int() | float():
                        filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() != value)

            case "empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].is_(None))

            case "not empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].isnot(None))

            case "before" | "<":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() < value)

            case "after" | ">":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() > value)

            case "≤" | "<=":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() <= value)

            case "≥" | ">=":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() >= value)
            case "in" | "not in":
                match value:
                    case str():
                        value_list = [v.strip() for v in value.split(",") if v.strip()]
                    case list() | tuple():
                        value_list = [str(v) for v in value if v is not None]
                    case _:
                        value_list = [str(value)] if value is not None else []

                if not value_list:
                    # `field in []` is False, `field not in []` is True
                    filters.append(literal(condition == "not in"))
                else:
                    op = json_field.in_ if condition == "in" else json_field.notin_
                    filters.append(op(value_list))
            case _:
                pass

        return filters

    def record_queries(
        self,
        tenant_id: str,
        *,
        query: str | None,
        attachment_ids: list[str] | None,
        dataset_ids: list[str],
        app_id: str,
        role: CreatorUserRole,
        user_id: str,
    ) -> None:
        contents = [{"content_type": QueryType.TEXT_QUERY, "content": query}] if query else []
        contents.extend({"content_type": QueryType.IMAGE_QUERY, "content": id} for id in (attachment_ids or []))
        if not contents:
            return
        with self._sessions.begin() as session:
            owned_ids = session.scalars(
                select(Dataset.id).where(Dataset.tenant_id == tenant_id, Dataset.id.in_(dataset_ids))
            ).all()
            session.add_all(
                DatasetQuery(
                    dataset_id=id,
                    content=json.dumps(contents),
                    source=DatasetQuerySource.APP,
                    source_app_id=app_id,
                    created_by_role=role,
                    created_by=user_id,
                )
                for id in owned_ids
            )

    def record_limit(self, tenant_id: str, subscription_plan: str) -> None:
        with self._sessions.begin() as session:
            session.add(RateLimitLog(tenant_id=tenant_id, subscription_plan=subscription_plan, operation="knowledge"))

    @retry(
        retry=retry_if_exception(_is_postgres_deadlock_error),
        stop=stop_after_attempt(_HIT_COUNT_UPDATE_MAX_ATTEMPTS),
        wait=wait_exponential(multiplier=0.05, min=0.05, max=0.1),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    def record_hits(self, tenant_id: str, documents: list[Document]) -> None:
        dify_documents = [document for document in documents if document.provider == "dify"]
        if not dify_documents:
            return
        with self._sessions.begin() as session:
            # Collect all document_ids and batch fetch DatasetDocuments
            document_ids = {
                doc.metadata["document_id"] for doc in dify_documents if doc.metadata and "document_id" in doc.metadata
            }
            if not document_ids:
                return

            dataset_docs_stmt = select(DatasetDocument).where(
                DatasetDocument.tenant_id == tenant_id, DatasetDocument.id.in_(document_ids)
            )
            dataset_docs = session.scalars(dataset_docs_stmt).all()
            dataset_doc_map = {str(doc.id): doc for doc in dataset_docs}

            # Categorize documents by type and collect necessary IDs
            parent_child_text_docs: list[tuple[Document, DatasetDocument]] = []
            parent_child_image_docs: list[tuple[Document, DatasetDocument]] = []
            normal_text_docs: list[tuple[Document, DatasetDocument]] = []
            normal_image_docs: list[tuple[Document, DatasetDocument]] = []

            for doc in dify_documents:
                if not doc.metadata or "document_id" not in doc.metadata:
                    continue
                dataset_doc = dataset_doc_map.get(doc.metadata["document_id"])
                if not dataset_doc:
                    continue

                is_image = doc.metadata.get("doc_type") == DocType.IMAGE
                is_parent_child = dataset_doc.doc_form == IndexStructureType.PARENT_CHILD_INDEX

                if is_parent_child:
                    if is_image:
                        parent_child_image_docs.append((doc, dataset_doc))
                    else:
                        parent_child_text_docs.append((doc, dataset_doc))
                else:
                    if is_image:
                        normal_image_docs.append((doc, dataset_doc))
                    else:
                        normal_text_docs.append((doc, dataset_doc))

            segment_ids_to_update: set[str] = set()

            # Process PARENT_CHILD_INDEX text documents - batch fetch ChildChunks
            if parent_child_text_docs:
                index_node_ids = [doc.metadata["doc_id"] for doc, _ in parent_child_text_docs if doc.metadata]
                if index_node_ids:
                    child_chunks_stmt = select(ChildChunk).where(ChildChunk.index_node_id.in_(index_node_ids))
                    child_chunks = session.scalars(child_chunks_stmt).all()
                    child_chunk_map = {chunk.index_node_id: chunk.segment_id for chunk in child_chunks}
                    for doc, _ in parent_child_text_docs:
                        if doc.metadata:
                            segment_id = child_chunk_map.get(doc.metadata["doc_id"])
                            if segment_id:
                                segment_ids_to_update.add(str(segment_id))

            # Process non-PARENT_CHILD_INDEX text documents - batch fetch DocumentSegments
            if normal_text_docs:
                index_node_ids = [doc.metadata["doc_id"] for doc, _ in normal_text_docs if doc.metadata]
                if index_node_ids:
                    segments_stmt = select(DocumentSegment).where(DocumentSegment.index_node_id.in_(index_node_ids))
                    segments = session.scalars(segments_stmt).all()
                    segment_map = {seg.index_node_id: seg.id for seg in segments}
                    for doc, _ in normal_text_docs:
                        if doc.metadata:
                            segment_id = segment_map.get(doc.metadata["doc_id"])
                            if segment_id:
                                segment_ids_to_update.add(str(segment_id))

            # Process IMAGE documents - batch fetch SegmentAttachmentBindings
            all_image_docs = parent_child_image_docs + normal_image_docs
            if all_image_docs:
                attachment_ids = [
                    doc.metadata["doc_id"] for doc, _ in all_image_docs if doc.metadata and doc.metadata.get("doc_id")
                ]
                if attachment_ids:
                    bindings_stmt = select(SegmentAttachmentBinding).where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.attachment_id.in_(attachment_ids),
                    )
                    bindings = session.scalars(bindings_stmt).all()
                    segment_ids_to_update.update(str(binding.segment_id) for binding in bindings)

            # Batch update hit_count for all segments
            if segment_ids_to_update:
                # PostgreSQL does not guarantee that an IN predicate is visited in parameter order.
                # Lock every target row explicitly and consistently before the multi-row update.
                session.scalars(
                    select(DocumentSegment.id)
                    .where(DocumentSegment.tenant_id == tenant_id, DocumentSegment.id.in_(segment_ids_to_update))
                    .order_by(DocumentSegment.id)
                    .with_for_update()
                ).all()
                session.execute(
                    update(DocumentSegment)
                    .where(DocumentSegment.tenant_id == tenant_id, DocumentSegment.id.in_(segment_ids_to_update))
                    .values(hit_count=DocumentSegment.hit_count + 1)
                    .execution_options(synchronize_session=False)
                )

    def workflow_sources(
        self, request: KnowledgeRetrievalRequest, dify_documents: list[Document], available_datasets_ids: list[str]
    ) -> list[Source]:
        retrieval_resource_list = []
        if dify_documents:
            # Materialize authorized, signed response values before closing the owned session.
            with self._sessions() as retrieval_session:
                records = RetrievalService.format_retrieval_documents(retrieval_session, dify_documents)
                dataset_ids = [i.segment.dataset_id for i in records]
                document_ids = [i.segment.document_id for i in records]
                datasets = retrieval_session.scalars(select(Dataset).where(Dataset.id.in_(dataset_ids))).all()
                documents = retrieval_session.scalars(
                    select(DatasetDocument).where(DatasetDocument.id.in_(document_ids))
                ).all()

                dataset_map = {i.id: i for i in datasets}
                document_map = {i.id: i for i in documents}

                for record in records:
                    segment = record.segment
                    if (
                        authorize_retrieved_segment(
                            segment,
                            tenant_id=request.tenant_id,
                            dataset_ids=available_datasets_ids,
                            session=retrieval_session,
                        )
                        is None
                    ):
                        continue
                    dataset = dataset_map.get(segment.dataset_id)
                    document = document_map.get(segment.document_id)

                    if dataset and document:
                        content = sign_segment_content(segment, session=retrieval_session)
                        source = Source(
                            metadata=SourceMetadata(
                                source="knowledge",
                                dataset_id=dataset.id,
                                dataset_name=dataset.name,
                                document_id=document.id,
                                document_name=document.name,
                                data_source_type=document.data_source_type,
                                segment_id=segment.id,
                                retriever_from="workflow",
                                score=record.score or 0.0,
                                segment_hit_count=segment.hit_count,
                                segment_word_count=segment.word_count,
                                segment_position=segment.position,
                                segment_index_node_hash=segment.index_node_hash,
                                doc_metadata=document.doc_metadata,
                                child_chunks=[
                                    SourceChildChunk(
                                        id=str(chunk.id),
                                        content=str(chunk.content),
                                        position=int(chunk.position),
                                        score=float(chunk.score),
                                    )
                                    for chunk in (record.child_chunks or [])
                                ],
                                position=None,
                            ),
                            title=document.name,
                            files=list(record.files) if record.files else None,
                            content=content,
                        )
                        if segment.answer:
                            source.content = f"question:{content} \nanswer:{segment.answer}"

                        if record.summary:
                            source.summary = record.summary

                        retrieval_resource_list.append(source)

        return retrieval_resource_list

    def context_records(
        self,
        tenant_id: str,
        available_datasets_ids: list[str],
        dify_documents: list[Document],
        show_retrieve_source: bool,
        vision_enabled: bool,
        invoke_from: InvokeFrom,
    ) -> tuple[list[DocumentContext], list[File], list[RetrievalSourceMetadata]]:
        document_context_list = []
        context_files = []
        retrieval_resource_list = []
        with self._sessions() as session:
            records = RetrievalService.format_retrieval_documents(session, dify_documents)
            if records:
                authorized_records = []
                for record in records:
                    segment = record.segment
                    attachments = authorize_retrieved_segment(
                        segment, tenant_id=tenant_id, dataset_ids=available_datasets_ids, session=session
                    )
                    if attachments is None:
                        continue
                    authorized_records.append(record)
                    # Build content: if summary exists, add it before the segment content
                    if segment.answer:
                        segment_content = (
                            f"question:{sign_segment_content(segment, session=session)} answer:{segment.answer}"
                        )
                    else:
                        segment_content = sign_segment_content(segment, session=session)

                    # If summary exists, prepend it to the content
                    if record.summary:
                        final_content = f"{record.summary}\n{segment_content}"
                    else:
                        final_content = segment_content

                    document_context_list.append(
                        DocumentContext(
                            content=final_content,
                            score=record.score,
                        )
                    )
                    if vision_enabled:
                        if attachments:
                            for upload_file in attachments:
                                attachment_info = File(
                                    file_id=upload_file.id,
                                    filename=upload_file.name,
                                    extension="." + upload_file.extension,
                                    mime_type=upload_file.mime_type,
                                    file_type=FileType.IMAGE,
                                    transfer_method=FileTransferMethod.LOCAL_FILE,
                                    remote_url=upload_file.source_url,
                                    reference=build_file_reference(
                                        record_id=str(upload_file.id),
                                    ),
                                    size=upload_file.size,
                                    storage_key=upload_file.key,
                                    url=sign_upload_file_preview_url(upload_file.id, upload_file.extension),
                                )
                                context_files.append(attachment_info)
                if show_retrieve_source:
                    dataset_ids = [record.segment.dataset_id for record in authorized_records]
                    document_ids = [record.segment.document_id for record in authorized_records]
                    dataset_document_stmt = select(DatasetDocument).where(
                        DatasetDocument.id.in_(document_ids),
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                    documents = session.execute(dataset_document_stmt).scalars().all()  # type: ignore
                    dataset_stmt = select(Dataset).where(
                        Dataset.id.in_(dataset_ids),
                    )
                    datasets = session.execute(dataset_stmt).scalars().all()  # type: ignore
                    dataset_map = {i.id: i for i in datasets}
                    document_map = {i.id: i for i in documents}
                    for record in authorized_records:
                        segment = record.segment
                        dataset_item = dataset_map.get(segment.dataset_id)
                        document_item = document_map.get(segment.document_id)
                        if dataset_item and document_item:
                            source = RetrievalSourceMetadata(
                                dataset_id=dataset_item.id,
                                dataset_name=dataset_item.name,
                                document_id=document_item.id,
                                document_name=document_item.name,
                                data_source_type=document_item.data_source_type,
                                segment_id=segment.id,
                                retriever_from=invoke_from.to_source(),
                                score=record.score or 0.0,
                                doc_metadata=document_item.doc_metadata,
                            )

                            if invoke_from.to_source() == "dev":
                                source.hit_count = segment.hit_count
                                source.word_count = segment.word_count
                                source.segment_position = segment.position
                                source.index_node_hash = segment.index_node_hash
                            if segment.answer:
                                source.content = f"question:{segment.content} \nanswer:{segment.answer}"
                            else:
                                source.content = segment.content
                            # Add summary if this segment was retrieved via summary
                            if record.summary:
                                source.summary = record.summary
                            retrieval_resource_list.append(source)
        return document_context_list, context_files, retrieval_resource_list

    def external_request(
        self,
        tenant_id: str,
        dataset_id: str,
        query: str,
        parameters: dict[str, Any],
        condition: MetadataFilteringCondition | None,
    ) -> ExternalKnowledgeApiSetting:
        with self._sessions() as session:
            return prepare_external_retrieval(
                session=session,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                query=query,
                external_retrieval_parameters=parameters,
                metadata_condition=condition,
            )

    def validate_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        with self._sessions() as session:
            self._validate_caller_app(tenant_id=tenant_id, app_id=app_id, session=session)
            self._validate_datasets(tenant_id=tenant_id, dataset_ids=dataset_ids, session=session)

    def _validate_caller_app(self, *, tenant_id: str, app_id: str, session: Session) -> None:
        app = session.scalar(select(App).where(App.id == app_id).limit(1))
        if app is None:
            raise InnerKnowledgeRetrieveAppNotFoundError(f"App '{app_id}' not found")
        if app.tenant_id != tenant_id:
            raise InnerKnowledgeRetrieveAppTenantMismatchError(
                f"App '{app_id}' does not belong to tenant '{tenant_id}'"
            )

    def _validate_datasets(self, *, tenant_id: str, dataset_ids: list[str], session: Session) -> None:
        datasets = session.scalars(select(Dataset).where(Dataset.id.in_(dataset_ids))).all()

        found_ids = {dataset.id for dataset in datasets}
        missing_ids = sorted(set(dataset_ids) - found_ids)
        if missing_ids:
            raise InnerKnowledgeRetrieveDatasetNotFoundError(f"Datasets not found: {', '.join(missing_ids)}")

        mismatched_ids = sorted(dataset.id for dataset in datasets if dataset.tenant_id != tenant_id)
        if mismatched_ids:
            raise InnerKnowledgeRetrieveDatasetTenantMismatchError(
                f"Datasets do not belong to tenant '{tenant_id}': {', '.join(mismatched_ids)}"
            )
