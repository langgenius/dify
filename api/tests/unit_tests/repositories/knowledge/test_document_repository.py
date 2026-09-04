import json
from datetime import datetime

from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.dataset_reference import DatasetRef
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository


def _dataset(dataset_id: str, workspace_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        created_by="account-1",
        maintainer="account-1",
        data_source_type="notion_import",
        indexing_technique="economy",
    )


def _document(
    document_id: str,
    *,
    workspace_id: str = "workspace-1",
    dataset_id: str = "dataset-1",
    source_type: str = DataSourceType.NOTION_IMPORT,
    enabled: bool = True,
    archived: bool = False,
    status: str = IndexingStatus.COMPLETED,
    batch: str = "batch-1",
) -> Document:
    source_info = (
        {"notion_page_id": f"page-{document_id}"}
        if source_type == DataSourceType.NOTION_IMPORT
        else {"upload_file_id": f"file-{document_id}"}
    )
    return Document(
        id=document_id,
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=source_type,
        data_source_info=json.dumps(source_info),
        batch=batch,
        name=f"Document {document_id}",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        indexing_status=status,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=1,
        enabled=enabled,
        archived=archived,
        is_paused=False,
    )


def test_document_queries_enforce_the_complete_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("document-1"),
                _document("document-2", workspace_id="workspace-2", dataset_id="dataset-2"),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    document_ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    record = repository.get_by_ref(document_ref)

    assert record is not None
    assert record.workspace_id == "workspace-1"
    assert record.data_source_info == {"notion_page_id": "page-document-1"}
    assert repository.get_by_ref(DatasetRef("workspace-2", "dataset-1").document("document-1")) is None
    assert repository.get_by_id_for_workspace(workspace_id="workspace-2", document_id="document-1") is None


def test_active_notion_queries_exclude_other_sources_and_inactive_documents(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all(
            [
                _document("notion"),
                _document("upload", source_type=DataSourceType.UPLOAD_FILE),
                _document("disabled", enabled=False),
                _document("archived", archived=True),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    assert repository.list_active_notion_refs(dataset_ref) == (dataset_ref.document("notion"),)
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset({"page-notion"})


def test_document_records_normalize_invalid_mapping_data_and_ignore_invalid_notion_page_ids(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    invalid_json = _document("invalid-json")
    invalid_json.data_source_info = "{invalid"
    missing_info = _document("missing-info")
    missing_info.data_source_info = None
    invalid_page_id = _document("invalid-page-id")
    invalid_page_id.data_source_info = json.dumps({"notion_page_id": 42})
    invalid_page_id.doc_metadata = {"rank": 1}
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all([invalid_json, missing_info, invalid_page_id])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    invalid_record = repository.get_by_ref(dataset_ref.document("invalid-json"))
    missing_record = repository.get_by_ref(dataset_ref.document("missing-info"))
    assert invalid_record is not None
    assert invalid_record.data_source_info == {}
    assert missing_record is not None
    assert missing_record.data_source_info is None
    metadata_record = repository.get_by_ref(dataset_ref.document("invalid-page-id"))
    assert metadata_record is not None
    assert metadata_record.doc_metadata == {"rank": 1}
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset()


def test_batch_and_available_queries_keep_explicit_state_semantics(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-1"),
                _dataset("dataset-3", "workspace-2"),
            ]
        )
        session.add_all(
            [
                _document("available"),
                _document("waiting", status=IndexingStatus.WAITING),
                _document("disabled", enabled=False),
                _document("archived", archived=True),
                _document("other-batch", batch="batch-2"),
                _document("other-dataset", dataset_id="dataset-2"),
                _document("other-workspace", workspace_id="workspace-2", dataset_id="dataset-3"),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    assert repository.list_by_refs(dataset_ref, []) == ()
    assert repository.list_available_by_refs(dataset_ref, []) == ()
    assert {record.id for record in repository.list_by_batch(dataset_ref, "batch-1")} == {
        "available",
        "waiting",
        "disabled",
        "archived",
    }
    assert [record.id for record in repository.list_by_refs(dataset_ref, ["waiting", "available", "missing"])] == [
        "waiting",
        "available",
    ]
    assert [
        record.id
        for record in repository.list_available_by_refs(
            dataset_ref,
            ["waiting", "disabled", "archived", "available"],
        )
    ] == ["available"]
    assert {record.id for record in repository.list_working_by_dataset(dataset_ref)} == {"available", "other-batch"}
