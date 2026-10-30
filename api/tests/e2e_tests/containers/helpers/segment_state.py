"""Shared real-database setup for legacy segment-state task integration tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4

from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import AttachmentDocument
from core.rag.models.document import Document as IndexDocument
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import (
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)


@dataclass(frozen=True, slots=True)
class SegmentStateGraph:
    account: Account
    tenant: Tenant
    dataset: Dataset
    document: Document


@dataclass(slots=True)
class RecordingIndexProcessor:
    """Typed external-index fake; persistence remains backed by the container DB."""

    loaded_documents: list[tuple[IndexDocument, ...]] = field(default_factory=list)
    cleaned_node_ids: list[tuple[str, ...]] = field(default_factory=list)

    def load(
        self,
        _dataset: Dataset,
        documents: list[IndexDocument],
        multimodal_documents: list[AttachmentDocument] | None = None,
        with_keywords: bool = True,
        *,
        session: Session,
        **_kwargs: object,
    ) -> None:
        del multimodal_documents, with_keywords, session
        self.loaded_documents.append(tuple(documents))

    def clean(
        self,
        _dataset: Dataset,
        node_ids: list[str] | None,
        with_keywords: bool = True,
        *,
        session: Session,
        **_kwargs: object,
    ) -> None:
        del with_keywords, session
        self.cleaned_node_ids.append(tuple(node_ids or ()))


@dataclass(frozen=True, slots=True)
class RecordingIndexProcessorFactory:
    processor: RecordingIndexProcessor

    def init_index_processor(self) -> RecordingIndexProcessor:
        return self.processor


def create_graph(
    session: Session,
    *,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
) -> SegmentStateGraph:
    suffix = uuid4().hex
    account = Account(
        email=f"segment-state-{suffix}@example.com",
        name="Segment state owner",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    tenant = Tenant(name=f"Segment state tenant {suffix}", status=TenantStatus.NORMAL)
    session.add_all([account, tenant])
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
    )
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name=f"Segment state dataset {suffix}",
        description="",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=indexing_technique,
        created_by=account.id,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=str(uuid4()),
        name="segment-state.txt",
        created_from=DocumentCreatedFrom.API,
        created_by=account.id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=doc_form,
        word_count=0,
    )
    session.add_all([dataset, document])
    session.commit()
    return SegmentStateGraph(account, tenant, dataset, document)


def create_segment(
    session: Session,
    graph: SegmentStateGraph,
    *,
    position: int,
    enabled: bool,
    status: SegmentStatus = SegmentStatus.COMPLETED,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=graph.tenant.id,
        dataset_id=graph.dataset.id,
        document_id=graph.document.id,
        position=position,
        content=f"segment content {position}",
        word_count=3,
        tokens=3,
        index_node_id=f"node-{uuid4()}",
        index_node_hash=f"hash-{position}",
        enabled=enabled,
        status=status,
        created_by=graph.account.id,
    )
    session.add(segment)
    session.commit()
    return segment


def create_summary(
    session: Session,
    graph: SegmentStateGraph,
    segment: DocumentSegment,
    *,
    enabled: bool,
) -> DocumentSegmentSummary:
    summary = DocumentSegmentSummary(
        dataset_id=graph.dataset.id,
        document_id=graph.document.id,
        chunk_id=segment.id,
        summary_content="retained summary",
        summary_index_node_id=f"summary-{uuid4()}",
        status=SummaryStatus.COMPLETED,
        enabled=enabled,
    )
    session.add(summary)
    session.commit()
    return summary
