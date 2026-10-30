import json
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

import tasks.clean_document_task as clean_document_task_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, DatasetProcessRule, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository, save_prepared_documents
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentWriteConfig,
    DocumentWriteNotionPage,
    DocumentWriteNotionSource,
    DocumentWriteSource,
)
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from tests.unit_tests.model_factories import make_account, make_tenant


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
    doc_metadata: dict[str, object] | None = None,
    pending_file_ids: tuple[str, ...] = (),
) -> Document:
    source_info: dict[str, object] = (
        {"notion_page_id": f"page-{document_id}"}
        if source_type == DataSourceType.NOTION_IMPORT
        else {"upload_file_id": f"file-{document_id}"}
    )
    if pending_file_ids:
        source_info["_pending_upload_cleanup_ids"] = list(pending_file_ids)
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
        doc_metadata=doc_metadata,
    )


def _upload_file(*, key: str) -> UploadFile:
    return UploadFile(
        tenant_id="workspace-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name=f"{key}.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )


def test_retry_accepts_and_reenables_disabled_error_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("failed", status=IndexingStatus.ERROR, enabled=False),
            ]
        )
        failed = session.get_one(Document, "failed")
        failed.disabled_at = datetime(2026, 1, 2)
        failed.disabled_by = "account-1"

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    batch = repository.retry_documents(
        DatasetRef("workspace-1", "dataset-1"),
        ["failed"],
        actor_id="account-1",
    )

    assert batch is not None
    assert batch.document_ids == ("failed",)
    with sqlite_session_factory() as session:
        failed = session.get_one(Document, "failed")
        assert failed.indexing_status == IndexingStatus.WAITING
        assert failed.enabled is True
        assert failed.disabled_at is None
        assert failed.disabled_by is None


def test_retry_dispatch_failure_compensates_only_the_same_generation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("failed", status=IndexingStatus.ERROR),
                _document("newer", status=IndexingStatus.ERROR),
            ]
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    retry_generation = datetime(2026, 10, 29, 12, 30, 45, 123456)
    with patch("repositories.knowledge.document_repository.naive_utc_now", return_value=retry_generation):
        batch = repository.retry_documents(dataset_ref, ["failed", "newer"], actor_id="account-1")
    assert batch is not None
    assert batch.document_ids == ("failed", "newer")
    assert batch.started_at == retry_generation

    newer_generation = datetime(2026, 10, 29, 12, 30, 45, 654321)
    with sqlite_session_factory.begin() as session:
        newer = session.get_one(Document, "newer")
        newer.processing_started_at = newer_generation

    repository.fail_retry_dispatch(dataset_ref, batch)

    with sqlite_session_factory() as session:
        failed = session.get_one(Document, "failed")
        assert failed.indexing_status == IndexingStatus.ERROR
        assert failed.processing_started_at == batch.started_at
        assert failed.error == "Document retry could not be queued."
        assert failed.stopped_at is not None
        newer = session.get_one(Document, "newer")
        assert newer.indexing_status == IndexingStatus.WAITING
        assert newer.processing_started_at == newer_generation
        assert newer.error is None


def test_status_dispatch_failure_rolls_back_only_the_matching_committed_transition(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    disabled_at = datetime(2026, 1, 2)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("published", enabled=False),
                _document("failed", enabled=False),
            ]
        )
        for document_id in ("published", "failed"):
            document = session.get_one(Document, document_id)
            document.disabled_at = disabled_at
            document.disabled_by = "account-1"

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1")
    mutation = repository.change_status(
        ref,
        ("published", "failed"),
        action="enable",
        actor_id="account-1",
    )
    failed_rollback = tuple(rollback for rollback in mutation.rollbacks if rollback.document_id == "failed")

    assert repository.rollback_status_change(ref, failed_rollback) == ("failed",)
    with sqlite_session_factory() as session:
        published = session.get_one(Document, "published")
        failed = session.get_one(Document, "failed")
        assert published.enabled is True
        assert published.disabled_at is None
        assert failed.enabled is False
        assert failed.disabled_at == disabled_at
        assert failed.disabled_by == "account-1"

    retry = repository.change_status(
        ref,
        ("published", "failed"),
        action="enable",
        actor_id="account-1",
    )
    assert retry.indexing_document_ids == ("failed",)


def test_status_dispatch_compensation_does_not_overwrite_a_newer_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1", enabled=False)])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1")
    mutation = repository.change_status(ref, ("document-1",), action="enable", actor_id="account-1")

    with sqlite_session_factory.begin() as session:
        document = session.get_one(Document, "document-1")
        document.archived = True
        document.updated_at = datetime(2026, 1, 3)

    assert repository.rollback_status_change(ref, mutation.rollbacks) == ()
    with sqlite_session_factory() as session:
        document = session.get_one(Document, "document-1")
        assert document.enabled is True
        assert document.archived is True


@pytest.mark.parametrize("archived", [False, True])
def test_delete_returns_batch_cleanup_job_with_document_removal(
    sqlite_session_factory: sessionmaker[Session],
    archived: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document(
                    "document-1",
                    source_type=DataSourceType.UPLOAD_FILE,
                    archived=archived,
                    pending_file_ids=("old-image",),
                ),
            ]
        )

    cleanup = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).delete_document(
        DatasetRef("workspace-1", "dataset-1").document("document-1")
    )

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is None
    assert cleanup == DocumentBatchCleanupJob(
        document_ids=("document-1",),
        dataset_id="dataset-1",
        doc_form="text_model",
        file_ids=("old-image", "file-document-1"),
    )


def test_batch_delete_allows_archived_documents(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document(
                    "archived",
                    source_type=DataSourceType.UPLOAD_FILE,
                    archived=True,
                    pending_file_ids=("old-image",),
                ),
            ]
        )

    cleanup = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).delete_documents(
        DatasetRef("workspace-1", "dataset-1"),
        ["archived"],
    )

    with sqlite_session_factory() as session:
        assert session.get(Document, "archived") is None
    assert cleanup == DocumentBatchCleanupJob(
        document_ids=("archived",),
        dataset_id="dataset-1",
        doc_form="text_model",
        file_ids=("old-image", "file-archived"),
    )


def test_notion_selection_stages_removed_document_and_complete_cleanup_job(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant = make_tenant(tenant_id="workspace-1")
    account = make_account(account_id="account-1", tenant=tenant)
    process_rule = DatasetProcessRule(
        dataset_id="dataset-1",
        mode=ProcessRuleMode.AUTOMATIC,
        rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
        created_by=account.id,
    )
    kept = _document("kept")
    removed = _document("removed", pending_file_ids=("pending-image",))
    config = DocumentWriteConfig(
        original_document_id=None,
        duplicate=False,
        indexing_technique="economy",
        data_source=DocumentWriteSource(
            data_source_type="notion_import",
            notion_sources=(
                DocumentWriteNotionSource(
                    credential_id="credential-1",
                    workspace_id="notion-workspace-1",
                    pages=(
                        DocumentWriteNotionPage(
                            page_id="page-kept",
                            page_name="Kept",
                            page_icon=None,
                            type="page",
                        ),
                    ),
                ),
            ),
        ),
        process_rule=None,
        retrieval_model=None,
        summary_index_setting=None,
        doc_form="text_model",
        doc_language="English",
        embedding_model=None,
        embedding_model_provider=None,
        name=None,
        is_multimodal=False,
    )

    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        session.add_all([tenant, dataset, process_rule, kept, removed])
        session.flush()

        documents, _batch, jobs = save_prepared_documents(
            dataset,
            config,
            account,
            dataset_process_rule=process_rule,
            session=session,
        )

        assert [document.id for document in documents] == ["kept"]
        assert jobs.removed_notion_cleanup == DocumentBatchCleanupJob(
            document_ids=("removed",),
            dataset_id="dataset-1",
            doc_form="text_model",
            file_ids=("pending-image",),
        )

    with sqlite_session_factory() as session:
        assert session.get(Document, "kept") is not None
        assert session.get(Document, "removed") is None

    with sqlite_session_factory.begin() as session:
        dataset = session.get_one(Dataset, "dataset-1")
        persisted_rule = session.get_one(DatasetProcessRule, process_rule.id)
        documents, _batch, repeated_jobs = save_prepared_documents(
            dataset,
            config,
            account,
            dataset_process_rule=persisted_rule,
            session=session,
        )

        assert [document.id for document in documents] == ["kept"]
        assert repeated_jobs.created == ()
        assert repeated_jobs.removed_notion_cleanup is None


def test_single_delete_without_pending_cleanup_keeps_document_task_contract(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("document-1", source_type=DataSourceType.UPLOAD_FILE),
            ]
        )

    cleanup = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).delete_document(
        DatasetRef("workspace-1", "dataset-1").document("document-1")
    )

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is None
    assert cleanup == DocumentCleanupJob(
        document_id="document-1",
        dataset_id="dataset-1",
        doc_form="text_model",
        file_id="file-document-1",
    )


def test_delete_commit_failure_preserves_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1")])

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit, once=True)
    with pytest.raises(RuntimeError, match="commit failed"):
        SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).delete_document(
            DatasetRef("workspace-1", "dataset-1").document("document-1")
        )

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is not None


def test_cleanup_job_retains_pending_file_for_task_retry(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_image = _upload_file(key="old-indexing-image")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _document("document-1", pending_file_ids=(old_image.id,)),
                old_image,
            ]
        )

    cleanup = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).delete_document(
        DatasetRef("workspace-1", "dataset-1").document("document-1")
    )
    assert isinstance(cleanup, DocumentBatchCleanupJob)
    assert cleanup.file_ids == (old_image.id,)

    def fail_commit(session: Session) -> None:
        if not session.in_nested_transaction():
            raise RuntimeError("commit failed")

    deleted_keys: list[str] = []
    monkeypatch.setattr(clean_document_task_module.storage, "delete", deleted_keys.append)
    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            clean_document_task_module._delete_document_rows_and_unreferenced_files(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_ids=("document-1",),
                file_ids=(old_image.id,),
            )
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_commit)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, old_image.id) is not None
    assert cleanup.file_ids == (old_image.id,)
    assert deleted_keys == []

    clean_document_task_module._delete_document_rows_and_unreferenced_files(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_ids=("document-1",),
        file_ids=(old_image.id,),
    )

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, old_image.id) is None
    assert deleted_keys == [old_image.key]


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

    record = repository.get_estimate_document(document_ref)

    assert record is not None
    assert record.workspace_id == "workspace-1"
    assert record.data_source_info == {"notion_page_id": "page-document-1"}
    assert repository.get_estimate_document(DatasetRef("workspace-2", "dataset-1").document("document-1")) is None


def test_retrieval_document_batches_validate_owners_and_current_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document_ids = ["owned", "foreign", "broken-chain", "wrong-document-tenant", "disabled", "archived", "pending"]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("owned"),
                _document("foreign", workspace_id="workspace-2", dataset_id="dataset-2"),
                _document("broken-chain", dataset_id="dataset-2"),
                _document("wrong-document-tenant", workspace_id="workspace-2"),
                _document("disabled", enabled=False),
                _document("archived", archived=True),
                _document("pending", status=IndexingStatus.INDEXING),
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1")

    documents = repository.get_retrieval_documents(ref, document_ids)

    assert set(documents) == {"owned"}
    assert documents["owned"].values["name"] == "Document owned"
    assert repository.get_hit_testing_document_filter(ref, {"conditions": None}) == ["owned"]
    assert repository.get_retrieval_documents(DatasetRef("workspace-2", "dataset-1"), document_ids) == {}
    assert repository.get_retrieval_documents(ref, []) == {}


def test_metadata_empty_filters_use_extracted_scalar_null_semantics(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    metadata_by_document: dict[str, dict[str, object]] = {
        "missing": {},
        "json-null": {"topic": None},
        "text": {"topic": "value"},
        "zero": {"topic": 0},
        "false": {"topic": False},
        "empty-string": {"topic": ""},
    }
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all(
            [_document(document_id, doc_metadata=metadata) for document_id, metadata in metadata_by_document.items()]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1")

    def matching(operator: str) -> set[str]:
        return set(
            repository.get_hit_testing_document_filter(
                ref,
                {
                    "logical_operator": "and",
                    "conditions": [{"name": "topic", "comparison_operator": operator, "value": None}],
                },
            )
        )

    assert matching("empty") == {"missing", "json-null"}
    assert matching("not empty") == {"text", "zero", "false", "empty-string"}


def test_document_store_owns_sessions_and_scopes_writes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1"))

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    assert repository.exists(workspace_id="workspace-1", dataset_id="dataset-1", document_id="document-1")
    assert not repository.exists(workspace_id="workspace-2", dataset_id="dataset-1", document_id="document-1")
    repository.mark_failed(
        workspace_id="workspace-2",
        dataset_id="dataset-1",
        document_id="document-1",
        error="foreign",
    )
    with sqlite_session_factory() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.indexing_status == IndexingStatus.COMPLETED


def test_active_notion_sync_excludes_archived_while_binding_includes_it(
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
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset({"page-notion", "page-archived"})


def test_document_records_normalize_invalid_mapping_data_and_ignore_invalid_notion_page_ids(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    invalid_json = _document("invalid-json")
    invalid_json.data_source_info = "{invalid"
    missing_info = _document("missing-info")
    missing_info.data_source_info = None
    invalid_page_id = _document("invalid-page-id")
    invalid_page_id.data_source_info = json.dumps({"notion_page_id": 42})
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add_all([invalid_json, missing_info, invalid_page_id])

    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    invalid_record = repository.get_estimate_document(dataset_ref.document("invalid-json"))
    missing_record = repository.get_estimate_document(dataset_ref.document("missing-info"))
    assert invalid_record is not None
    assert invalid_record.data_source_info == {}
    assert missing_record is not None
    assert missing_record.data_source_info is None
    assert repository.list_bound_notion_page_ids(dataset_ref) == frozenset()


def test_batch_query_is_scoped_and_keeps_explicit_state_semantics(
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

    assert {record.id for record in repository.list_estimate_documents_by_batch(dataset_ref, "batch-1")} == {
        "available",
        "waiting",
        "disabled",
        "archived",
    }


@pytest.mark.parametrize(
    ("tenant", "dataset", "document"),
    [
        ("wrong", "dataset-1", "document-1"),
        ("workspace-1", "wrong", "document-1"),
        ("workspace-1", "dataset-1", "wrong"),
    ],
)
def test_indexing_state_writes_reject_wrong_owner_chain(
    sqlite_session_factory: sessionmaker[Session], tenant: str, dataset: str, document: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1")])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef(tenant, dataset).document(document)
    for operation in [
        lambda: repository.get_indexing_document(ref),
        lambda: repository.mark_splitting(ref),
        lambda: repository.complete_indexing(ref, tokens=9, latency=1),
    ]:
        with pytest.raises(DocumentIsDeletedPausedError):
            operation()
    repository.fail_indexing(ref, "wrong owner")
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.error is None


def test_indexing_load_validates_dataset_owner_and_process_rule(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1")
        document.dataset_process_rule_id = "other-rule"
        rule = DatasetProcessRule(
            dataset_id="dataset-2", mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        rule.id = "other-rule"
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                document,
                rule,
            ]
        )
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    assert repository.get_indexing_document(ref).processing_rule == {}
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, "dataset-1")
        assert persisted_dataset is not None
        persisted_dataset.tenant_id = "workspace-2"
    with pytest.raises(DocumentIsDeletedPausedError):
        repository.get_indexing_document(ref)


def test_notion_source_version_is_staged_and_published_only_on_completion(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.PARSING)
    document.data_source_info = json.dumps(
        {
            "notion_page_id": "page-document-1",
            "last_edited_time": "2026-01-01T00:00:00Z",
        }
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).mark_splitting(
        ref,
        source_version="2026-02-01T00:00:00Z",
    )

    with sqlite_session_factory() as session:
        staged = session.get(Document, document.id)
        assert staged is not None
        assert staged.data_source_info_dict["last_edited_time"] == "2026-01-01T00:00:00Z"
        assert staged.data_source_info_dict["pending_last_edited_time"] == "2026-02-01T00:00:00Z"
        assert staged.indexing_status == IndexingStatus.SPLITTING

    # Recovery may run in a different process; completion must read the persisted pending version.
    SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).complete_indexing(ref, tokens=37, latency=2)

    with sqlite_session_factory() as session:
        completed = session.get(Document, document.id)
        assert completed is not None
        assert completed.data_source_info_dict["last_edited_time"] == "2026-02-01T00:00:00Z"
        assert "pending_last_edited_time" not in completed.data_source_info_dict
        assert (completed.indexing_status, completed.tokens, completed.indexing_latency) == (
            IndexingStatus.COMPLETED,
            37,
            2,
        )


def test_failed_notion_indexing_discards_pending_source_version(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.PARSING)
    document.data_source_info = json.dumps(
        {
            "notion_page_id": "page-document-1",
            "last_edited_time": "2026-01-01T00:00:00Z",
        }
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    repository.mark_splitting(ref, source_version="2026-02-01T00:00:00Z")

    repository.fail_indexing(ref, "provider unavailable")

    with sqlite_session_factory() as session:
        failed = session.get(Document, document.id)
        assert failed is not None
        assert failed.data_source_info_dict["last_edited_time"] == "2026-01-01T00:00:00Z"
        assert "pending_last_edited_time" not in failed.data_source_info_dict
        assert failed.indexing_status == IndexingStatus.ERROR


@pytest.mark.parametrize("status", [IndexingStatus.PARSING, IndexingStatus.INDEXING])
def test_stale_unchanged_notion_sync_does_not_overwrite_active_indexing(
    sqlite_session_factory: sessionmaker[Session],
    status: str,
) -> None:
    document = _document("document-1", status=status)
    document.data_source_info = json.dumps({"last_edited_time": "2026-01-01T00:00:00Z"})
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    outcome = repository.complete_unchanged_notion_sync(
        ref,
        expected_source_info={"last_edited_time": "2026-01-01T00:00:00Z"},
    )

    assert outcome == "stale"
    with sqlite_session_factory() as session:
        persisted = session.get_one(Document, document.id)
        assert persisted.indexing_status == status
        assert persisted.completed_at is None


def test_stale_unchanged_notion_sync_cannot_complete_a_replaced_source_with_the_same_version(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.WAITING)
    document.data_source_info = json.dumps(
        {
            "notion_workspace_id": "workspace-1",
            "notion_page_id": "replacement-page",
            "type": "page",
            "credential_id": "credential-1",
            "last_edited_time": "2026-01-01T00:00:00Z",
        }
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    outcome = repository.complete_unchanged_notion_sync(
        ref,
        expected_source_info={
            "notion_workspace_id": "workspace-1",
            "notion_page_id": "original-page",
            "type": "page",
            "credential_id": "credential-1",
            "last_edited_time": "2026-01-01T00:00:00Z",
        },
    )

    assert outcome == "stale"
    with sqlite_session_factory() as session:
        persisted = session.get_one(Document, document.id)
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert persisted.completed_at is None


def test_unchanged_first_notion_index_requires_real_indexing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.WAITING)
    document.data_source_info = json.dumps({"last_edited_time": "2026-01-01T00:00:00Z"})
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    outcome = repository.complete_unchanged_notion_sync(
        ref,
        expected_source_info={"last_edited_time": "2026-01-01T00:00:00Z"},
    )

    assert outcome == "requires_indexing"
    with sqlite_session_factory() as session:
        persisted = session.get_one(Document, document.id)
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert persisted.completed_at is None


def test_unchanged_notion_sync_restores_a_previously_completed_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document = _document("document-1", status=IndexingStatus.WAITING)
    document.completed_at = datetime(2026, 1, 1)
    document.data_source_info = json.dumps({"last_edited_time": "2026-01-01T00:00:00Z"})
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")

    outcome = repository.complete_unchanged_notion_sync(
        ref,
        expected_source_info={"last_edited_time": "2026-01-01T00:00:00Z"},
    )

    assert outcome == "completed"
    with sqlite_session_factory() as session:
        persisted = session.get_one(Document, document.id)
        assert persisted.indexing_status == IndexingStatus.COMPLETED


def test_indexing_transitions_preserve_pause(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), _document("document-1", status=IndexingStatus.PARSING)])
    repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    repository.mark_splitting(ref, source_version="2026-02-01T00:00:00Z")
    with sqlite_session_factory.begin() as session:
        row = session.get(Document, "document-1")
        assert row is not None
        row.is_paused = True
    with pytest.raises(DocumentIsPausedError):
        repository.fail_indexing(ref, "late worker error")
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.error is None
        assert persisted_document.data_source_info_dict["pending_last_edited_time"] == "2026-02-01T00:00:00Z"
