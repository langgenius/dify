"""Explicit reads for knowledge models within the caller's transaction.

These query functions are shared by repositories and existing transaction owners;
they never create, commit, or close a session and perform no external I/O.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session, scoped_session

from core.app.file_access import DatabaseFileAccessController
from core.rag.entities import ParentMode, Rule
from models.account import Account
from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetBindingItem,
    DatasetKeywordTable,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
    PipelineCustomizedTemplate,
    SegmentAttachmentBinding,
)
from models.model import App, Tag, TagBinding, UploadFile
from models.tools import ToolFile


@dataclass(frozen=True)
class DocumentReadBatch:
    uploads: dict[tuple[str, str], UploadFile] = field(default_factory=dict)
    metadatas: dict[str, list[DatasetMetadata]] = field(default_factory=dict)
    built_in_enabled: dict[tuple[str, str], bool] = field(default_factory=dict)
    uploader_names: dict[str, str] = field(default_factory=dict)
    segment_counts: dict[str, int] = field(default_factory=dict)
    hit_counts: dict[str, int] = field(default_factory=dict)
    process_rules: dict[str, DatasetProcessRule] = field(default_factory=dict)


def load_document_read_batch(documents: Sequence[Document], *, session: Session) -> DocumentReadBatch:
    """Load a page's document relations with a bounded number of queries."""
    if not documents:
        return DocumentReadBatch()
    owners = [(doc.tenant_id, doc.dataset_id, doc.id) for doc in documents]
    dataset_owners = list({(doc.tenant_id, doc.dataset_id) for doc in documents})
    upload_owners = list(
        {
            (doc.tenant_id, file_id)
            for doc in documents
            if doc.data_source_type == "upload_file" and (file_id := doc.data_source_info_dict.get("upload_file_id"))
        }
    )
    uploads = (
        {
            (file.tenant_id, file.id): file
            for file in session.scalars(
                select(UploadFile).where(tuple_(UploadFile.tenant_id, UploadFile.id).in_(upload_owners))
            )
        }
        if upload_owners
        else {}
    )
    metadatas: dict[str, list[DatasetMetadata]] = {}
    for doc_id, metadata in session.execute(
        select(DatasetMetadataBinding.document_id, DatasetMetadata)
        .join(DatasetMetadata, DatasetMetadata.id == DatasetMetadataBinding.metadata_id)
        .where(
            tuple_(
                DatasetMetadataBinding.tenant_id, DatasetMetadataBinding.dataset_id, DatasetMetadataBinding.document_id
            ).in_(owners),
            DatasetMetadata.tenant_id == DatasetMetadataBinding.tenant_id,
            DatasetMetadata.dataset_id == DatasetMetadataBinding.dataset_id,
        )
    ):
        metadatas.setdefault(doc_id, []).append(metadata)
    built_in_enabled = {
        (tenant_id, dataset_id): enabled
        for tenant_id, dataset_id, enabled in session.execute(
            select(Dataset.tenant_id, Dataset.id, Dataset.built_in_field_enabled).where(
                tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owners)
            )
        )
    }
    uploader_names = dict(
        session.execute(select(Account.id, Account.name).where(Account.id.in_({doc.created_by for doc in documents})))
        .tuples()
        .all()
    )
    counts = session.execute(
        select(
            DocumentSegment.document_id,
            func.count(DocumentSegment.id),
            func.coalesce(func.sum(DocumentSegment.hit_count), 0),
        )
        .where(tuple_(DocumentSegment.tenant_id, DocumentSegment.dataset_id, DocumentSegment.document_id).in_(owners))
        .group_by(DocumentSegment.document_id)
    ).all()
    rule_ids = {doc.dataset_process_rule_id for doc in documents if doc.dataset_process_rule_id}
    process_rules = (
        {
            rule.id: rule
            for rule in session.scalars(
                select(DatasetProcessRule)
                .join(Dataset, Dataset.id == DatasetProcessRule.dataset_id)
                .where(DatasetProcessRule.id.in_(rule_ids), tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owners))
            )
        }
        if rule_ids
        else {}
    )
    return DocumentReadBatch(
        uploads=uploads,
        metadatas=metadatas,
        built_in_enabled=built_in_enabled,
        uploader_names=uploader_names,
        segment_counts={doc_id: count for doc_id, count, _ in counts},
        hit_counts={doc_id: hits for doc_id, _, hits in counts},
        process_rules=process_rules,
    )


def get_segment_content_file_ids(
    segment: DocumentSegment, *, upload_ids: set[str], tool_ids: set[str], session: Session
) -> tuple[set[str], set[str]]:
    access = DatabaseFileAccessController()
    uploads = (
        session.scalars(
            access.apply_upload_file_filters(
                select(UploadFile).where(UploadFile.id.in_(upload_ids), UploadFile.tenant_id == segment.tenant_id)
            )
        ).all()
        if upload_ids
        else []
    )
    tools = (
        session.scalars(
            access.apply_tool_file_filters(
                select(ToolFile).where(ToolFile.id.in_(tool_ids), ToolFile.tenant_id == segment.tenant_id)
            )
        ).all()
        if tool_ids
        else []
    )
    return {file.id for file in uploads}, {file.id for file in tools}


def get_segment_attachment_files(segment: DocumentSegment, *, session: Session) -> Sequence[UploadFile]:
    return session.scalars(
        select(UploadFile)
        .join(SegmentAttachmentBinding, UploadFile.id == SegmentAttachmentBinding.attachment_id)
        .where(
            SegmentAttachmentBinding.tenant_id == segment.tenant_id,
            SegmentAttachmentBinding.dataset_id == segment.dataset_id,
            SegmentAttachmentBinding.document_id == segment.document_id,
            SegmentAttachmentBinding.segment_id == segment.id,
            UploadFile.tenant_id == segment.tenant_id,
        )
    ).all()


def is_retrieved_segment_owned(
    segment: DocumentSegment, *, tenant_id: str, dataset_ids: Sequence[str], session: Session
) -> bool:
    """Validate retrieved identifiers against the complete persisted owner chain."""
    if segment.tenant_id != tenant_id or segment.dataset_id not in dataset_ids:
        return False
    return (
        session.scalar(
            select(DocumentSegment.id)
            .join(Document, Document.id == DocumentSegment.document_id)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Dataset.tenant_id == tenant_id,
                Dataset.id == segment.dataset_id,
                Document.tenant_id == tenant_id,
                Document.dataset_id == segment.dataset_id,
                Document.id == segment.document_id,
                Document.enabled.is_(True),
                Document.archived.is_(False),
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == segment.dataset_id,
                DocumentSegment.id == segment.id,
                DocumentSegment.enabled.is_(True),
            )
        )
        is not None
    )


def get_document_upload_file(document: Document, *, session: Session) -> UploadFile | None:
    file_id = document.data_source_info_dict.get("upload_file_id")
    if not file_id:
        return None
    return session.scalar(
        select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == document.tenant_id)
    )


def get_document_metadata_rows(document: Document, *, session: Session) -> Sequence[DatasetMetadata]:
    return session.scalars(
        select(DatasetMetadata)
        .join(DatasetMetadataBinding, DatasetMetadataBinding.metadata_id == DatasetMetadata.id)
        .where(
            DatasetMetadata.tenant_id == document.tenant_id,
            DatasetMetadata.dataset_id == document.dataset_id,
            DatasetMetadataBinding.tenant_id == document.tenant_id,
            DatasetMetadataBinding.dataset_id == document.dataset_id,
            DatasetMetadataBinding.document_id == document.id,
        )
    ).all()


def get_query_upload_files(query: DatasetQuery, file_ids: set[str], *, session: Session) -> dict[str, UploadFile]:
    if not file_ids:
        return {}
    rows = session.scalars(
        select(UploadFile)
        .join(Dataset, Dataset.tenant_id == UploadFile.tenant_id)
        .where(Dataset.id == query.dataset_id, UploadFile.id.in_(file_ids))
    ).all()
    return {file.id: file for file in rows}


def get_external_api_bindings_batch(
    apis: Sequence[ExternalKnowledgeApis], *, session: Session
) -> dict[str, list[DatasetBindingItem]]:
    if not apis:
        return {}
    allowed = {(api.id, api.tenant_id) for api in apis}
    rows = session.execute(
        select(
            ExternalKnowledgeBindings.external_knowledge_api_id,
            ExternalKnowledgeBindings.tenant_id,
            Dataset.id,
            Dataset.name,
        )
        .join(Dataset, Dataset.id == ExternalKnowledgeBindings.dataset_id)
        .where(
            tuple_(ExternalKnowledgeBindings.external_knowledge_api_id, ExternalKnowledgeBindings.tenant_id).in_(
                allowed
            ),
            Dataset.tenant_id == ExternalKnowledgeBindings.tenant_id,
        )
        .distinct()
    ).all()
    bindings: dict[str, list[DatasetBindingItem]] = {}
    for api_id, tenant_id, dataset_id, name in rows:
        if (api_id, tenant_id) in allowed:
            bindings.setdefault(api_id, []).append({"id": dataset_id, "name": name})
    return bindings


def get_external_api_dataset_bindings(api: ExternalKnowledgeApis, *, session: Session) -> list[DatasetBindingItem]:
    return get_external_api_bindings_batch([api], session=session).get(api.id, [])


def get_dataset_keyword_table(dataset: Dataset, *, session: Session) -> DatasetKeywordTable | None:
    return session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset.id))


def get_dataset_creator(dataset: Dataset, *, session: Session) -> Account | None:
    return session.get(Account, dataset.created_by)


def get_dataset_author_name(dataset: Dataset, *, session: Session) -> str | None:
    account = get_dataset_creator(dataset, session=session)
    if account:
        return account.name
    return None


def get_latest_dataset_process_rule(dataset: Dataset, *, session: Session) -> DatasetProcessRule | None:
    return session.scalar(
        select(DatasetProcessRule)
        .where(DatasetProcessRule.dataset_id == dataset.id)
        .order_by(DatasetProcessRule.created_at.desc())
        .limit(1)
    )


def get_dataset_app_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(AppDatasetJoin.id)).where(
                AppDatasetJoin.dataset_id == dataset.id,
                App.id == AppDatasetJoin.app_id,
                App.tenant_id == dataset.tenant_id,
            )
        )
        or 0
    )


def get_dataset_document_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(Document.id)).where(
                Document.dataset_id == dataset.id, Document.tenant_id == dataset.tenant_id
            )
        )
        or 0
    )


def get_dataset_available_document_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(Document.id)).where(
                Document.dataset_id == dataset.id,
                Document.tenant_id == dataset.tenant_id,
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
            )
        )
        or 0
    )


def get_dataset_available_segment_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(DocumentSegment.id)).where(
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.status == "completed",
                DocumentSegment.enabled == True,
            )
        )
        or 0
    )


def get_dataset_word_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.coalesce(func.sum(Document.word_count), 0)).where(
                Document.dataset_id == dataset.id, Document.tenant_id == dataset.tenant_id
            )
        )
        or 0
    )


def get_dataset_doc_form(dataset: Dataset, *, session: Session) -> str | None:
    if dataset.chunk_structure:
        return dataset.chunk_structure
    return session.scalar(
        select(Document.doc_form)
        .where(Document.dataset_id == dataset.id, Document.tenant_id == dataset.tenant_id)
        .limit(1)
    )


def get_dataset_tags(dataset: Dataset, *, session: Session) -> Sequence[Tag]:
    tags = session.scalars(
        select(Tag)
        .join(TagBinding, Tag.id == TagBinding.tag_id)
        .where(
            TagBinding.target_id == dataset.id,
            TagBinding.tenant_id == dataset.tenant_id,
            Tag.tenant_id == dataset.tenant_id,
            Tag.type == "knowledge",
        )
    ).all()
    return tags or []


def get_external_knowledge_info(dataset: Dataset, *, session: Session) -> dict[str, Any] | None:
    if dataset.provider != "external":
        return None
    external_knowledge_binding = session.scalar(
        select(ExternalKnowledgeBindings).where(
            ExternalKnowledgeBindings.dataset_id == dataset.id, ExternalKnowledgeBindings.tenant_id == dataset.tenant_id
        )
    )
    if not external_knowledge_binding:
        return None
    external_knowledge_api = session.scalar(
        select(ExternalKnowledgeApis).where(
            ExternalKnowledgeApis.id == external_knowledge_binding.external_knowledge_api_id,
            ExternalKnowledgeApis.tenant_id == dataset.tenant_id,
        )
    )
    return dataset.build_external_knowledge_info(external_knowledge_binding, external_knowledge_api)


def get_dataset_is_published(dataset: Dataset, *, session: Session) -> bool:
    if dataset.pipeline_id:
        pipeline = session.scalar(
            select(Pipeline).where(Pipeline.id == dataset.pipeline_id, Pipeline.tenant_id == dataset.tenant_id)
        )
        if pipeline:
            return pipeline.is_published
    return False


def get_dataset_doc_metadata(dataset: Dataset, *, session: Session) -> list[dict[str, str]]:
    dataset_metadatas = session.scalars(
        select(DatasetMetadata).where(
            DatasetMetadata.dataset_id == dataset.id, DatasetMetadata.tenant_id == dataset.tenant_id
        )
    ).all()
    return dataset.build_doc_metadata(dataset_metadatas)


def get_document_process_rule(document: Document, *, session: Session) -> DatasetProcessRule | None:
    if document.dataset_process_rule_id:
        return session.scalar(
            select(DatasetProcessRule).where(
                DatasetProcessRule.id == document.dataset_process_rule_id,
                DatasetProcessRule.dataset_id == document.dataset_id,
            )
        )
    return None


def get_document_dataset(document: Document, *, session: Session) -> Dataset | None:
    """Load the owning dataset with the caller-owned database session."""
    return session.scalar(
        select(Dataset).where(Dataset.id == document.dataset_id, Dataset.tenant_id == document.tenant_id)
    )


def get_document_segment_count(document: Document, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(DocumentSegment.id)).where(
                DocumentSegment.document_id == document.id,
                DocumentSegment.dataset_id == document.dataset_id,
                DocumentSegment.tenant_id == document.tenant_id,
            )
        )
        or 0
    )


def get_document_hit_count(document: Document, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.coalesce(func.sum(DocumentSegment.hit_count), 0)).where(
                DocumentSegment.document_id == document.id,
                DocumentSegment.dataset_id == document.dataset_id,
                DocumentSegment.tenant_id == document.tenant_id,
            )
        )
        or 0
    )


def get_document_uploader(document: Document, *, session: Session) -> str | None:
    user = session.scalar(select(Account).where(Account.id == document.created_by))
    return user.name if user else None


def get_segment_dataset(segment: DocumentSegment, *, session: Session) -> Dataset | None:
    """Load the owning dataset with the caller-owned database session."""
    return session.scalar(
        select(Dataset).where(Dataset.id == segment.dataset_id, Dataset.tenant_id == segment.tenant_id)
    )


def get_segment_document(segment: DocumentSegment, *, session: Session) -> Document | None:
    """Load the owning document with the caller-owned database session."""
    return session.scalar(
        select(Document).where(
            Document.id == segment.document_id,
            Document.dataset_id == segment.dataset_id,
            Document.tenant_id == segment.tenant_id,
        )
    )


def get_previous_segment(segment: DocumentSegment, session: Session) -> DocumentSegment | None:
    return session.scalar(
        select(DocumentSegment).where(
            DocumentSegment.document_id == segment.document_id,
            DocumentSegment.dataset_id == segment.dataset_id,
            DocumentSegment.tenant_id == segment.tenant_id,
            DocumentSegment.position == segment.position - 1,
        )
    )


def get_next_segment(segment: DocumentSegment, session: Session) -> DocumentSegment | None:
    return session.scalar(
        select(DocumentSegment).where(
            DocumentSegment.document_id == segment.document_id,
            DocumentSegment.dataset_id == segment.dataset_id,
            DocumentSegment.tenant_id == segment.tenant_id,
            DocumentSegment.position == segment.position + 1,
        )
    )


def get_segment_child_chunks(
    segment: DocumentSegment, *, session: Session, include_full_doc: bool = True
) -> Sequence[ChildChunk]:
    """Load hierarchical child chunks with the caller-owned database session."""
    document = get_segment_document(segment, session=session)
    if not document:
        return []
    process_rule = get_document_process_rule(document, session=session)
    if process_rule and process_rule.mode == "hierarchical":
        rules_dict = process_rule.rules_dict
        if rules_dict:
            rules = Rule.model_validate(rules_dict)
            if rules.parent_mode and (include_full_doc or rules.parent_mode != ParentMode.FULL_DOC):
                child_chunks = session.scalars(
                    select(ChildChunk)
                    .where(
                        ChildChunk.segment_id == segment.id,
                        ChildChunk.tenant_id == segment.tenant_id,
                        ChildChunk.dataset_id == segment.dataset_id,
                        ChildChunk.document_id == segment.document_id,
                    )
                    .order_by(ChildChunk.position.asc())
                ).all()
                return child_chunks or []
    return []


def get_child_dataset(chunk: ChildChunk, session: Session) -> Dataset | None:
    return session.scalar(select(Dataset).where(Dataset.id == chunk.dataset_id, Dataset.tenant_id == chunk.tenant_id))


def get_child_document(chunk: ChildChunk, session: Session) -> Document | None:
    return session.scalar(
        select(Document).where(
            Document.id == chunk.document_id,
            Document.dataset_id == chunk.dataset_id,
            Document.tenant_id == chunk.tenant_id,
        )
    )


def get_child_segment(chunk: ChildChunk, session: Session) -> DocumentSegment | None:
    return session.scalar(
        select(DocumentSegment).where(
            DocumentSegment.id == chunk.segment_id,
            DocumentSegment.document_id == chunk.document_id,
            DocumentSegment.dataset_id == chunk.dataset_id,
            DocumentSegment.tenant_id == chunk.tenant_id,
        )
    )


def get_joined_app(binding: AppDatasetJoin, session: Session) -> App | None:
    return session.get(App, binding.app_id)


def get_pipeline_template_creator_name(template: PipelineCustomizedTemplate, session: Session) -> str:
    account = session.scalar(select(Account).where(Account.id == template.created_by))
    if account:
        return account.name
    return ""


def get_pipeline_dataset(pipeline: Pipeline, session: Session | scoped_session) -> Dataset | None:
    return session.scalar(
        select(Dataset).where(Dataset.pipeline_id == pipeline.id, Dataset.tenant_id == pipeline.tenant_id)
    )


@dataclass(frozen=True)
class DatasetDetailPrefetch:
    """Batch-loaded values backing the session-scoped fields of a page of datasets.

    Building a detail response for a single dataset issues about ten queries for
    that row alone, so a list endpoint costs one query per dataset per field.
    Loading the same values for every dataset on the page up front keeps the
    query count bounded regardless of the page size.
    """

    app_counts: dict[str, int] = field(default_factory=dict)
    document_counts: dict[str, int] = field(default_factory=dict)
    word_counts: dict[str, int] = field(default_factory=dict)
    available_document_counts: dict[str, int] = field(default_factory=dict)
    author_names: dict[str, str] = field(default_factory=dict)
    tags: dict[tuple[str, str], list[Tag]] = field(default_factory=dict)
    doc_forms: dict[tuple[str, str], str | None] = field(default_factory=dict)
    external_knowledge_infos: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    doc_metadata: dict[str, list[DatasetMetadata]] = field(default_factory=dict)
    pipeline_published: dict[str, bool] = field(default_factory=dict)


def build_dataset_detail_prefetch(datasets: Sequence[Dataset], *, session: Session) -> DatasetDetailPrefetch:
    """Load every session-scoped detail field for the given datasets in a fixed number of queries."""
    dataset_ids = [dataset.id for dataset in datasets]
    if not dataset_ids:
        return DatasetDetailPrefetch()

    tenant_ids = {dataset.tenant_id for dataset in datasets}
    dataset_owners = [(dataset.tenant_id, dataset.id) for dataset in datasets]

    app_counts = dict(
        session.execute(
            select(AppDatasetJoin.dataset_id, func.count(AppDatasetJoin.id))
            .where(
                AppDatasetJoin.dataset_id.in_(dataset_ids),
                App.id == AppDatasetJoin.app_id,
                tuple_(App.tenant_id, AppDatasetJoin.dataset_id).in_(dataset_owners),
            )
            .group_by(AppDatasetJoin.dataset_id)
        )
        .tuples()
        .all()
    )

    document_counts: dict[str, int] = {}
    word_counts: dict[str, int] = {}
    available_document_counts: dict[str, int] = {}
    available_document_case = sa.case(
        (
            sa.and_(
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
            ),
            1,
        ),
        else_=0,
    )
    document_rows = session.execute(
        select(
            Document.dataset_id,
            func.count(Document.id),
            func.coalesce(func.sum(Document.word_count), 0),
            func.coalesce(func.sum(available_document_case), 0),
        )
        .where(tuple_(Document.tenant_id, Document.dataset_id).in_(dataset_owners))
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, document_count, word_count, available_count in document_rows:
        document_counts[dataset_id] = document_count
        word_counts[dataset_id] = word_count
        available_document_counts[dataset_id] = available_count

    # doc_form only falls back to the documents table for datasets without a
    # chunk structure of their own.
    doc_forms: dict[tuple[str, str], str | None] = {}
    doc_form_dataset_ids = [dataset.id for dataset in datasets if not dataset.chunk_structure]
    if doc_form_dataset_ids:
        doc_forms = {
            (dataset_id, tenant_id): doc_form
            for dataset_id, tenant_id, doc_form in session.execute(
                select(Document.dataset_id, Document.tenant_id, func.min(Document.doc_form))
                .where(
                    Document.dataset_id.in_(doc_form_dataset_ids),
                    tuple_(Document.tenant_id, Document.dataset_id).in_(dataset_owners),
                )
                .group_by(Document.dataset_id, Document.tenant_id)
            ).all()
        }

    author_ids = {dataset.created_by for dataset in datasets if dataset.created_by}
    author_names = dict(
        session.execute(select(Account.id, Account.name).where(Account.id.in_(author_ids))).tuples().all()
    )

    tags: dict[tuple[str, str], list[Tag]] = {}
    tag_rows = session.execute(
        select(TagBinding.target_id, TagBinding.tenant_id, Tag)
        .join(TagBinding, Tag.id == TagBinding.tag_id)
        .where(
            tuple_(TagBinding.tenant_id, TagBinding.target_id).in_(dataset_owners),
            Tag.tenant_id == TagBinding.tenant_id,
            Tag.type == "knowledge",
        )
    ).all()
    for target_id, tenant_id, tag in tag_rows:
        tags.setdefault((target_id, tenant_id), []).append(tag)

    doc_metadata: dict[str, list[DatasetMetadata]] = {}
    for dataset_metadata in session.scalars(
        select(DatasetMetadata).where(tuple_(DatasetMetadata.tenant_id, DatasetMetadata.dataset_id).in_(dataset_owners))
    ).all():
        doc_metadata.setdefault(dataset_metadata.dataset_id, []).append(dataset_metadata)

    pipeline_ids = {dataset.pipeline_id for dataset in datasets if dataset.pipeline_id}
    pipeline_published: dict[str, bool] = {}
    if pipeline_ids:
        pipeline_owners = [(dataset.tenant_id, dataset.pipeline_id) for dataset in datasets if dataset.pipeline_id]
        pipeline_published = dict(
            session.execute(
                select(Pipeline.id, Pipeline.is_published).where(
                    tuple_(Pipeline.tenant_id, Pipeline.id).in_(pipeline_owners)
                )
            )
            .tuples()
            .all()
        )

    return DatasetDetailPrefetch(
        app_counts=app_counts,
        document_counts=document_counts,
        word_counts=word_counts,
        available_document_counts=available_document_counts,
        author_names=author_names,
        tags=tags,
        doc_forms=doc_forms,
        external_knowledge_infos=_load_external_knowledge_infos(datasets, session=session),
        doc_metadata=doc_metadata,
        pipeline_published=pipeline_published,
    )


def _load_external_knowledge_infos(
    datasets: Sequence[Dataset], *, session: Session
) -> dict[tuple[str, str], dict[str, Any]]:
    external_datasets = [dataset for dataset in datasets if dataset.provider == "external"]
    if not external_datasets:
        return {}

    external_owners = [(dataset.tenant_id, dataset.id) for dataset in external_datasets]
    external_tenant_ids = {dataset.tenant_id for dataset in external_datasets}
    bindings = session.scalars(
        select(ExternalKnowledgeBindings).where(
            tuple_(ExternalKnowledgeBindings.tenant_id, ExternalKnowledgeBindings.dataset_id).in_(external_owners),
        )
    ).all()
    if not bindings:
        return {}

    apis = {
        (api.id, api.tenant_id): api
        for api in session.scalars(
            select(ExternalKnowledgeApis).where(
                ExternalKnowledgeApis.id.in_({binding.external_knowledge_api_id for binding in bindings}),
                ExternalKnowledgeApis.tenant_id.in_(external_tenant_ids),
            )
        ).all()
    }

    infos: dict[tuple[str, str], dict[str, Any]] = {}
    for binding in bindings:
        info = Dataset.build_external_knowledge_info(
            binding, apis.get((binding.external_knowledge_api_id, binding.tenant_id))
        )
        if info is not None:
            infos[(binding.dataset_id, binding.tenant_id)] = info
    return infos
