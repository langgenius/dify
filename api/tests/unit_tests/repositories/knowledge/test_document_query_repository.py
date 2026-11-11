import json
from datetime import UTC, datetime

from sqlalchemy import Table, insert
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.account import Account
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    Document,
    DocumentSegment,
)
from models.enums import (
    DatasetMetadataType,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    ProcessRuleMode,
    SegmentStatus,
)
from models.model import UploadFile
from repositories.knowledge.document_query_repository import (
    DocumentReadBatch,
    get_document_dataset,
    get_document_hit_count,
    get_document_metadata_rows,
    get_document_process_rule,
    get_document_segment_count,
    get_document_segment_counts,
    get_document_upload_file,
    get_document_uploader,
    get_documents_by_ids,
    get_documents_position,
    get_error_documents,
    list_dataset_documents,
    load_document_read_batch,
    load_document_read_projections,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
_DATASET_ID = "00000000-0000-0000-0000-000000000011"
_OTHER_DATASET_ID = "00000000-0000-0000-0000-000000000012"
_FOREIGN_DATASET_ID = "00000000-0000-0000-0000-000000000013"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000021"


def _dataset(*, dataset_id: str = _DATASET_ID, tenant_id: str = _TENANT_ID) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"dataset-{dataset_id}",
        provider="vendor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=_ACCOUNT_ID,
        built_in_field_enabled=True,
    )


def _document(
    *,
    document_id: str,
    tenant_id: str = _TENANT_ID,
    dataset_id: str = _DATASET_ID,
    position: int = 1,
    status: IndexingStatus = IndexingStatus.WAITING,
    upload_file_id: str | None = None,
    process_rule_id: str | None = None,
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": upload_file_id}) if upload_file_id else "{}",
        dataset_process_rule_id=process_rule_id,
        batch="batch",
        name=f"document-{document_id}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=_ACCOUNT_ID,
        indexing_status=status,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


def _segment(
    document: Document,
    *,
    position: int,
    status: SegmentStatus = SegmentStatus.COMPLETED,
    hit_count: int = 0,
    tenant_id: str | None = None,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id or document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=position,
        content=f"segment-{position}",
        word_count=1,
        tokens=1,
        created_by=_ACCOUNT_ID,
        status=status,
        hit_count=hit_count,
    )
    if status == SegmentStatus.COMPLETED:
        segment.completed_at = datetime.now(UTC).replace(tzinfo=None)
    return segment


def _upload(*, file_id: str, tenant_id: str = _TENANT_ID) -> UploadFile:
    file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"knowledge/{file_id}",
        name=f"{file_id}.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACCOUNT_ID,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    file.id = file_id
    return file


def test_document_collection_queries_enforce_tenant_dataset_and_id_scope(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _dataset(),
            _dataset(dataset_id=_OTHER_DATASET_ID),
            _dataset(dataset_id=_FOREIGN_DATASET_ID, tenant_id=_OTHER_TENANT_ID),
        ]
    )
    sqlite_session.flush()
    selected = _document(document_id="00000000-0000-0000-0000-000000000101")
    error = _document(
        document_id="00000000-0000-0000-0000-000000000102",
        position=2,
        status=IndexingStatus.ERROR,
    )
    paused = _document(
        document_id="00000000-0000-0000-0000-000000000103",
        position=3,
        status=IndexingStatus.PAUSED,
    )
    other_dataset = _document(
        document_id="00000000-0000-0000-0000-000000000104",
        dataset_id=_OTHER_DATASET_ID,
    )
    other_tenant = _document(
        document_id="00000000-0000-0000-0000-000000000105",
        tenant_id=_OTHER_TENANT_ID,
        dataset_id=_FOREIGN_DATASET_ID,
    )
    sqlite_session.add_all([selected, error, paused, other_dataset, other_tenant])
    sqlite_session.flush()

    by_ids = get_documents_by_ids(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        document_ids=[selected.id, other_dataset.id, other_tenant.id, selected.id],
    )

    assert [document.id for document in by_ids] == [selected.id]
    assert {
        document.id for document in list_dataset_documents(sqlite_session, tenant_id=_TENANT_ID, dataset_id=_DATASET_ID)
    } == {
        selected.id,
        error.id,
        paused.id,
    }
    assert {
        document.id for document in get_error_documents(sqlite_session, tenant_id=_TENANT_ID, dataset_id=_DATASET_ID)
    } == {
        error.id,
        paused.id,
    }
    assert get_documents_position(sqlite_session, tenant_id=_TENANT_ID, dataset_id=_DATASET_ID) == 4


def test_document_queries_return_detached_empty_results_without_fabricated_rows(sqlite_session: Session) -> None:
    assert (
        get_documents_by_ids(
            sqlite_session,
            tenant_id=_TENANT_ID,
            dataset_id=_DATASET_ID,
            document_ids=[],
        )
        == ()
    )
    assert load_document_read_batch([], session=sqlite_session) == DocumentReadBatch()
    assert load_document_read_projections([], session=sqlite_session) == ()
    assert get_document_segment_counts(sqlite_session, []) == {}
    assert get_documents_position(sqlite_session, tenant_id=_TENANT_ID, dataset_id=_DATASET_ID) == 1


def test_read_batch_follows_document_owner_chain_for_relations_and_counts(sqlite_session: Session) -> None:
    upload_id = "00000000-0000-0000-0000-000000000121"
    foreign_upload_id = "00000000-0000-0000-0000-000000000122"
    dataset = _dataset()
    account = Account(name="Ada", email="ada@example.com")
    account.id = _ACCOUNT_ID
    process_rule = DatasetProcessRule(
        dataset_id=dataset.id,
        mode=ProcessRuleMode.CUSTOM,
        rules=json.dumps({"segmentation": {"delimiter": "\n", "max_tokens": 200}}),
        created_by=account.id,
    )
    document = _document(
        document_id="00000000-0000-0000-0000-000000000123",
        upload_file_id=upload_id,
        process_rule_id=process_rule.id,
    )
    upload = _upload(file_id=upload_id)
    foreign_upload = _upload(file_id=foreign_upload_id, tenant_id=_OTHER_TENANT_ID)
    metadata = DatasetMetadata(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        type=DatasetMetadataType.STRING,
        name="department",
        created_by=_ACCOUNT_ID,
    )
    valid_binding = DatasetMetadataBinding(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        metadata_id=metadata.id,
        document_id=document.id,
        created_by=_ACCOUNT_ID,
    )
    completed = _segment(document, position=1, hit_count=3)
    pending = _segment(document, position=2, status=SegmentStatus.WAITING, hit_count=5)
    sqlite_session.add_all([dataset, account, upload, foreign_upload])
    sqlite_session.flush()
    sqlite_session.add(process_rule)
    sqlite_session.flush()
    sqlite_session.add(document)
    sqlite_session.flush()
    document_table = Document.__table__
    assert isinstance(document_table, Table)
    sqlite_session.execute(
        insert(document_table).values(
            id="00000000-0000-0000-0000-000000000124",
            tenant_id=_TENANT_ID,
            dataset_id=_DATASET_ID,
            position=2,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info=json.dumps({"upload_file_id": foreign_upload_id}),
            batch="batch",
            name="legacy-cross-tenant-file.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=_ACCOUNT_ID,
            indexing_status=IndexingStatus.WAITING,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
    )
    sqlite_session.flush()
    foreign_file_document = sqlite_session.get(Document, "00000000-0000-0000-0000-000000000124")
    assert foreign_file_document is not None
    sqlite_session.add_all([metadata, valid_binding])
    sqlite_session.flush()
    sqlite_session.add_all([completed, pending])
    sqlite_session.flush()
    segment_table = DocumentSegment.__table__
    assert isinstance(segment_table, Table)
    sqlite_session.execute(
        insert(segment_table).values(
            id="00000000-0000-0000-0000-000000000125",
            tenant_id=_OTHER_TENANT_ID,
            dataset_id=document.dataset_id,
            document_id=document.id,
            position=3,
            content="legacy-cross-tenant-segment",
            word_count=1,
            tokens=1,
            created_by=_ACCOUNT_ID,
            enabled=True,
            status=SegmentStatus.COMPLETED,
            hit_count=100,
        )
    )
    sqlite_session.flush()

    batch = load_document_read_batch([document, foreign_file_document], session=sqlite_session)
    counts = get_document_segment_counts(sqlite_session, [document])
    details = load_document_read_projections([document, foreign_file_document], session=sqlite_session)

    assert batch.uploads == {(_TENANT_ID, upload.id): upload}
    assert batch.metadatas == {document.id: [metadata]}
    assert batch.built_in_enabled == {(_TENANT_ID, _DATASET_ID): True}
    assert batch.uploader_names == {_ACCOUNT_ID: "Ada"}
    assert batch.segment_counts == {document.id: 2}
    assert batch.hit_counts == {document.id: 8}
    assert batch.process_rules == {process_rule.id: process_rule}
    assert counts == {document.id: (1, 2)}
    assert get_document_process_rule(document, session=sqlite_session) is process_rule
    assert get_document_segment_count(document, session=sqlite_session) == 2
    assert get_document_hit_count(document, session=sqlite_session) == 8
    assert get_document_upload_file(document, session=sqlite_session) is upload
    assert get_document_upload_file(foreign_file_document, session=sqlite_session) is None
    assert get_document_metadata_rows(document, session=sqlite_session) == [metadata]
    assert get_document_dataset(document, session=sqlite_session) is dataset
    assert get_document_uploader(document, session=sqlite_session) == "Ada"
    assert details[0].source_file is not None
    assert details[0].source_file.id == upload.id
    assert details[0].process_rule is not None
    assert details[0].process_rule.id == process_rule.id
    assert details[0].hit_count == 8
    assert details[1].source_file is None
    assert details[0].id == document.id
