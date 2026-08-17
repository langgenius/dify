"""Unit tests for DocumentService behaviors in dataset_service."""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from models.account import Tenant
from models.dataset import Dataset, DatasetCollectionBinding, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from models.source import DataSourceOauthBinding
from services.dataset_ref_service import DatasetRefService

from .dataset_service_test_helpers import (
    Account,
    BuiltInField,
    CloudPlan,
    DatasetProcessRule,
    DatasetService,
    DataSource,
    Document,
    DocumentIndexingError,
    DocumentService,
    FileInfo,
    FileNotExistsError,
    IndexStructureType,
    InfoList,
    KnowledgeConfig,
    NotFound,
    NotionIcon,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    ProcessRule,
    RerankingModel,
    RetrievalMethod,
    RetrievalModel,
    Rule,
    Segmentation,
    SimpleNamespace,
    WebsiteInfo,
    _make_features,
    _make_lock_context,
    _make_upload_knowledge_config,
    json,
    patch,
    pytest,
)


def _account(*, account_id: str = "user-1", tenant_id: str = "tenant-1") -> Account:
    account = Account(name="User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


def _dataset_row(
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    built_in_field_enabled: bool = False,
    data_source_type: str | None = None,
    indexing_technique: str | None = "economy",
) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        provider="vendor",
        created_by="user-1",
        maintainer="user-1",
        built_in_field_enabled=built_in_field_enabled,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
        data_source_type=data_source_type,
        indexing_technique=indexing_technique,
    )


def _document_row(
    *,
    document_id: str = "document-1",
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    name: str = "Document",
    indexing_status: str = IndexingStatus.COMPLETED,
    data_source_type: str = DataSourceType.UPLOAD_FILE,
    data_source_info: str = "{}",
    enabled: bool = True,
    archived: bool = False,
    is_paused: bool = False,
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=data_source_type,
        data_source_info=data_source_info,
        batch="batch-1",
        name=name,
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
        indexing_status=indexing_status,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=10,
        enabled=enabled,
        archived=archived,
        is_paused=is_paused,
        completed_at=datetime(2026, 1, 2) if indexing_status == IndexingStatus.COMPLETED else None,
    )


def _upload_file(*, file_id: str, tenant_id: str = "tenant-1", name: str = "upload.txt") -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="opendal",
        key=f"key-{file_id}",
        name=name,
        size=1,
        extension="txt",
        mime_type="text/plain",
        created_by_role="account",
        created_by="user-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


def _process_rule(
    *, dataset_id: str = "dataset-1", rule_id: str = "rule-1", mode: str = "automatic"
) -> DatasetProcessRule:
    rules = (
        json.dumps(DatasetProcessRule.AUTOMATIC_RULES)
        if mode == "automatic"
        else Rule(
            pre_processing_rules=[PreProcessingRule(id="remove_extra_spaces", enabled=True)],
            segmentation=Segmentation(separator="\n", max_tokens=100),
        ).model_dump_json()
    )
    process_rule = DatasetProcessRule(dataset_id=dataset_id, mode=mode, rules=rules, created_by="user-1")
    process_rule.id = rule_id
    return process_rule


class _RetryFlagLock:
    def __init__(self, store: "_RetryFlagStore", key: str):
        self.store = store
        self.key = key
        self.token = f"owner-{store.next_token}"
        store.next_token += 1

    def acquire(self, *, blocking: bool):
        assert blocking is False
        if self.key in self.store.values:
            if self.store.replacement_on_conflict:
                replacement_key, replacement_value = self.store.replacement_on_conflict
                self.store.values[replacement_key] = replacement_value
            return False
        self.store.values[self.key] = self.token
        return True

    def release(self):
        if self.store.values.get(self.key) == self.token:
            self.store.values.pop(self.key)


class _RetryFlagStore:
    def __init__(
        self,
        values: dict[str, str] | None = None,
        replacement_on_conflict: tuple[str, str] | None = None,
    ):
        self.values = values or {}
        self.replacement_on_conflict = replacement_on_conflict
        self.next_token = 1

    def lock(self, key: str, *, timeout: int, thread_local: bool):
        assert timeout == 600
        assert thread_local is False
        return _RetryFlagLock(self, key)


class TestDocumentServiceDisplayStatus:
    """Unit tests for DocumentService display-status helpers."""

    @pytest.mark.parametrize(
        ("raw_status", "expected"),
        [
            ("enabled", "available"),
            ("AVAILABLE", "available"),
            ("paused", "paused"),
            ("unknown", None),
            (None, None),
        ],
    )
    def test_normalize_display_status(self, raw_status, expected):
        assert DocumentService.normalize_display_status(raw_status) == expected

    def test_build_display_status_filters_returns_empty_tuple_for_unknown_status(self):
        assert DocumentService.build_display_status_filters("missing") == ()

    def test_apply_display_status_filter_returns_original_query_for_unknown_status(self):
        query = select(Document)

        result = DocumentService.apply_display_status_filter(query, "missing")

        assert result is query

    def test_apply_display_status_filter_applies_where_for_known_status(self):
        query = select(Document)

        result = DocumentService.apply_display_status_filter(query, "enabled")

        assert result is not query
        assert "documents.enabled" in str(result)


class TestDocumentServiceRetrieval:
    def test_get_document_by_id_uses_provided_session(self, sqlite_session: Session):
        document = _document_row()
        sqlite_session.add(document)
        sqlite_session.commit()

        assert DocumentService.get_document_by_id(document.id, session=sqlite_session) is document
        assert DocumentService.get_document_by_id("missing", session=sqlite_session) is None

    def test_get_document_by_ids_enforces_dataset_owner_and_state(self, sqlite_session: Session):
        dataset = _dataset_row()
        expected = _document_row(document_id="expected")
        sqlite_session.add_all(
            [
                dataset,
                expected,
                _document_row(document_id="disabled", enabled=False),
                _document_row(document_id="archived", archived=True),
                _document_row(document_id="waiting", indexing_status=IndexingStatus.WAITING),
                _document_row(document_id="other-dataset", dataset_id="dataset-2"),
                _document_row(document_id="other-tenant", tenant_id="tenant-2"),
            ]
        )
        sqlite_session.commit()

        documents = DocumentService.get_document_by_ids(
            DatasetRefService.create_dataset_ref(dataset),
            ["expected", "disabled", "archived", "waiting", "other-dataset", "other-tenant"],
            sqlite_session,
        )

        assert [document.id for document in documents] == [expected.id]


class TestDocumentServiceMutations:
    """Unit tests for DocumentService mutation and orchestration helpers."""

    @pytest.mark.parametrize(("archived", "expected"), [(True, True), (False, False)])
    def test_check_archived_returns_boolean_status(self, archived, expected):
        document = _document_row(archived=archived)

        assert DocumentService.check_archived(document) is expected

    def test_delete_documents_limits_query_and_cleanup_to_dataset_ref(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(
            document_id="doc-1",
            data_source_info=json.dumps({"upload_file_id": "file-1"}),
        )
        other_dataset = _document_row(document_id="other-dataset", dataset_id="dataset-2")
        other_tenant = _document_row(document_id="other-tenant", tenant_id="tenant-2")
        sqlite_session.add_all([dataset, document, other_dataset, other_tenant])
        sqlite_session.commit()

        with patch("services.dataset_service.batch_clean_document_task") as clean_task:
            dataset_ref = DatasetRefService.create_dataset_ref(dataset)
            DocumentService.delete_documents(
                dataset_ref,
                [document.id, other_dataset.id, other_tenant.id],
                IndexStructureType.PARAGRAPH_INDEX,
                sqlite_session,
            )

        assert sqlite_session.get(Document, document.id) is None
        assert sqlite_session.get(Document, other_dataset.id) is other_dataset
        assert sqlite_session.get(Document, other_tenant.id) is other_tenant
        clean_task.delay.assert_called_once_with(
            [document.id], dataset.id, IndexStructureType.PARAGRAPH_INDEX, ["file-1"]
        )

    def test_delete_documents_with_empty_ids_does_not_commit(self, sqlite_session: Session):
        commits = 0

        def count_commit(_session):
            nonlocal commits
            commits += 1

        event.listen(sqlite_session, "after_commit", count_commit)
        DocumentService.delete_documents(
            DatasetRefService.create_dataset_ref(_dataset_row()), [], IndexStructureType.PARAGRAPH_INDEX, sqlite_session
        )
        event.remove(sqlite_session, "after_commit", count_commit)
        assert commits == 0

    def test_rename_document_raises_when_dataset_is_missing(self, sqlite_session: Session):
        with patch("services.dataset_service.current_user", _account()):
            with pytest.raises(ValueError, match="Dataset not found"):
                DocumentService.rename_document("dataset-1", "doc-1", "New Name", sqlite_session)

    def test_rename_document_raises_when_document_is_missing(self, sqlite_session: Session):
        dataset = _dataset_row()
        sqlite_session.add(dataset)
        sqlite_session.commit()
        with patch("services.dataset_service.current_user", _account()):
            with pytest.raises(ValueError, match="Document not found"):
                DocumentService.rename_document(dataset.id, "doc-1", "New Name", sqlite_session)

    def test_rename_document_rejects_cross_tenant_access(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(tenant_id="tenant-other")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        with patch("services.dataset_service.current_user", _account()):
            with pytest.raises(ValueError, match="No permission"):
                DocumentService.rename_document(dataset.id, document.id, "New Name", sqlite_session)

    def test_rename_document_updates_document_metadata_and_upload_file_name(self, sqlite_session: Session):
        dataset = _dataset_row(built_in_field_enabled=True)
        document = _document_row(
            data_source_info=json.dumps({"upload_file_id": "file-1"}),
        )
        document.doc_metadata = {BuiltInField.document_name: "Old"}
        upload_file = UploadFile(
            tenant_id=dataset.tenant_id,
            storage_type="opendal",
            key="key",
            name="old.txt",
            size=1,
            extension="txt",
            mime_type="text/plain",
            created_by_role="account",
            created_by="user-1",
            created_at=datetime(2026, 1, 1),
            used=False,
        )
        upload_file.id = "file-1"
        sqlite_session.add_all([dataset, document, upload_file])
        sqlite_session.commit()
        commits = 0

        def count_commit(_session):
            nonlocal commits
            commits += 1

        event.listen(sqlite_session, "after_commit", count_commit)
        with patch("services.dataset_service.current_user", _account()):
            result = DocumentService.rename_document(dataset.id, document.id, "New Name", sqlite_session)
        event.remove(sqlite_session, "after_commit", count_commit)

        assert result is document
        assert document.name == "New Name"
        assert document.doc_metadata[BuiltInField.document_name] == "New Name"
        assert sqlite_session.get(UploadFile, upload_file.id).name == "New Name"
        assert commits == 0

    def test_recover_document_raises_when_document_is_not_paused(self, unbound_session: Session):
        document = _document_row(is_paused=False)
        with pytest.raises(DocumentIndexingError):
            DocumentService.recover_document(document, unbound_session)

    def test_recover_document_persists_and_dispatches(self, sqlite_session: Session):
        document = _document_row(is_paused=True)
        sqlite_session.add(document)
        sqlite_session.commit()
        with (
            patch("services.dataset_service.redis_client") as redis,
            patch("services.dataset_service.recover_document_indexing_task") as task,
        ):
            DocumentService.recover_document(document, sqlite_session)

        sqlite_session.expire_all()
        recovered = sqlite_session.get(Document, document.id)
        assert recovered is not None
        assert recovered.is_paused is False
        redis.delete.assert_called_once_with(f"document_{document.id}_is_paused")
        task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_retry_document_raises_when_retry_flag_is_already_set(self, sqlite_session: Session):
        document = _document_row(indexing_status=IndexingStatus.ERROR)
        sqlite_session.add(document)
        sqlite_session.commit()
        retry_flags = _RetryFlagStore({f"document_{document.id}_is_retried": "other-request"})
        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client", retry_flags),
        ):
            with pytest.raises(ValueError, match="being retried"):
                DocumentService.retry_document("dataset-1", [document], sqlite_session)

    def test_retry_document_leaves_batch_unchanged_when_later_document_is_already_being_retried(
        self, sqlite_session: Session
    ):
        first_document = _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR)
        second_document = _document_row(document_id="doc-2", indexing_status=IndexingStatus.ERROR)
        sqlite_session.add_all([first_document, second_document])
        sqlite_session.commit()
        first_retry_key = "document_doc-1_is_retried"
        second_retry_key = "document_doc-2_is_retried"
        retry_flags = _RetryFlagStore({second_retry_key: "other-request"})
        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client", retry_flags),
            patch("services.dataset_service.retry_document_indexing_task") as retry_task,
        ):
            with pytest.raises(ValueError, match="being retried"):
                DocumentService.retry_document(
                    "dataset-1",
                    [first_document, second_document],
                    sqlite_session,
                )

        assert first_document.indexing_status == IndexingStatus.ERROR
        assert second_document.indexing_status == IndexingStatus.ERROR
        assert first_retry_key not in retry_flags.values
        assert retry_flags.values[second_retry_key] == "other-request"
        retry_task.delay.assert_not_called()

    def test_retry_document_does_not_release_a_retry_flag_reacquired_by_another_request(self, sqlite_session: Session):
        first_retry_key = "document_doc-1_is_retried"
        second_retry_key = "document_doc-2_is_retried"
        retry_flags = _RetryFlagStore(
            {second_retry_key: "other-request"},
            replacement_on_conflict=(first_retry_key, "new-owner"),
        )
        documents = [
            _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR),
            _document_row(document_id="doc-2", indexing_status=IndexingStatus.ERROR),
        ]
        sqlite_session.add_all(documents)
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client", retry_flags),
        ):
            with pytest.raises(ValueError, match="being retried"):
                DocumentService.retry_document("dataset-1", documents, sqlite_session)

        assert retry_flags.values[first_retry_key] == "new-owner"
        assert retry_flags.values[second_retry_key] == "other-request"

    def test_retry_document_releases_flags_when_status_commit_fails(self, sqlite_session: Session):
        retry_flags = _RetryFlagStore()
        document = _document_row(indexing_status=IndexingStatus.ERROR)
        sqlite_session.add(document)
        sqlite_session.commit()

        def fail_commit(_session):
            raise RuntimeError("database unavailable")

        event.listen(sqlite_session, "before_commit", fail_commit)
        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client", retry_flags),
            patch("services.dataset_service.retry_document_indexing_task") as retry_task,
        ):
            with pytest.raises(RuntimeError, match="database unavailable"):
                DocumentService.retry_document("dataset-1", [document], sqlite_session)
        event.remove(sqlite_session, "before_commit", fail_commit)

        assert retry_flags.values == {}
        retry_task.delay.assert_not_called()

    def test_retry_document_persists_status_and_dispatches(self, sqlite_session: Session):
        documents = [
            _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR),
            _document_row(document_id="doc-2", indexing_status=IndexingStatus.PAUSED),
        ]
        sqlite_session.add_all(documents)
        sqlite_session.commit()
        retry_flags = _RetryFlagStore()
        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client", retry_flags),
            patch("services.dataset_service.retry_document_indexing_task") as task,
        ):
            DocumentService.retry_document("dataset-1", documents, sqlite_session)

        sqlite_session.expire_all()
        statuses = sqlite_session.scalars(select(Document.indexing_status).order_by(Document.id)).all()
        assert statuses == [IndexingStatus.WAITING, IndexingStatus.WAITING]
        task.delay.assert_called_once_with("dataset-1", ["doc-1", "doc-2"], "user-1")

    def test_sync_website_document_raises_when_sync_flag_exists(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row()
        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="being synced"):
                DocumentService.sync_website_document(dataset, document, sqlite_session)

    def test_sync_website_document_rejects_document_outside_dataset(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(dataset_id="dataset-2")

        with (
            pytest.raises(ValueError, match="Document not found"),
            patch("services.dataset_service.redis_client") as mock_redis,
        ):
            DocumentService.sync_website_document(dataset, document, sqlite_session)

        mock_redis.get.assert_not_called()

    def test_sync_website_document_updates_status_sets_cache_and_dispatches_task(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(
            data_source_type=DataSourceType.WEBSITE_CRAWL,
            data_source_info=json.dumps({"mode": "crawl"}),
        )
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.sync_website_document_indexing_task") as sync_task,
        ):
            mock_redis.get.return_value = None

            DocumentService.sync_website_document(dataset, document, sqlite_session)

        sqlite_session.expire_all()
        synced = sqlite_session.get(Document, document.id)
        assert synced is not None
        assert synced.indexing_status == IndexingStatus.WAITING
        assert synced.data_source_info_dict["mode"] == "scrape"
        mock_redis.setex.assert_called_once_with(f"document_{document.id}_is_sync", 600, 1)
        sync_task.delay.assert_called_once_with(dataset.id, document.id)


class TestDocumentServiceSaveDocumentWithoutDatasetId:
    """Unit tests for dataset creation around save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_creates_high_quality_dataset_with_default_retrieval_model(
        self, account_context, sqlite_session: Session
    ):
        knowledge_config = KnowledgeConfig(
            indexing_technique="high_quality",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            embedding_model="embedding-model",
            embedding_model_provider="provider",
            summary_index_setting={"enable": True},
            is_multimodal=True,
        )
        binding = DatasetCollectionBinding(
            provider_name="provider",
            model_name="embedding-model",
            type="dataset",
            collection_name="collection",
        )
        binding.id = "binding-1"
        first_document = _document_row(name="VeryLongDocumentNameForDataset.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=binding,
            ),
            patch.object(
                DocumentService, "save_document_with_dataset_id", return_value=([first_document], "batch-1")
            ) as save_document,
        ):
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id="tenant-1",
                knowledge_config=knowledge_config,
                account=account_context,
                session=sqlite_session,
            )

        assert documents == [first_document]
        assert batch == "batch-1"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.retrieval_model["search_method"] == RetrievalMethod.SEMANTIC_SEARCH
        assert dataset.retrieval_model["top_k"] == 4
        assert dataset.summary_index_setting == {"enable": True}
        assert dataset.is_multimodal is True
        assert dataset.name == first_document.name[:18] + "..."
        assert (
            dataset.description
            == "useful for when you want to answer queries about the VeryLongDocumentNameForDataset.txt"
        )
        assert sqlite_session.get(Dataset, dataset.id) is dataset
        save_document.assert_called_once_with(
            dataset,
            knowledge_config,
            account_context,
            session=sqlite_session,
        )

    def test_save_document_without_dataset_id_uses_provided_retrieval_model(
        self, account_context, sqlite_session: Session
    ):
        retrieval_model = RetrievalModel(
            search_method=RetrievalMethod.SEMANTIC_SEARCH,
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=9,
            score_threshold_enabled=True,
            score_threshold=0.6,
        )
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            retrieval_model=retrieval_model,
        )
        first_document = _document_row(name="Doc")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([first_document], "batch-1"),
            ),
        ):
            dataset, _, _ = DocumentService.save_document_without_dataset_id(
                "tenant-1",
                knowledge_config,
                account_context,
                sqlite_session,
            )

        assert dataset.retrieval_model == retrieval_model.model_dump()
        assert dataset.collection_binding_id is None
        assert sqlite_session.get(Dataset, dataset.id) is dataset

    def test_save_document_without_dataset_id_rejects_sandbox_batch_upload(
        self, account_context, unbound_session: Session
    ):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1", "file-2"]),
                )
            ),
        )

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_without_dataset_id(
                    "tenant-1", knowledge_config, account_context, unbound_session
                )

        check_quota.assert_not_called()


class TestDocumentServiceUpdateDocumentWithDatasetId:
    """Unit tests for the document-update orchestration path."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_update_document_with_dataset_id_raises_when_document_is_missing(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )
        with patch.object(DatasetService, "check_dataset_model_setting") as check_model_setting:
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        check_model_setting.assert_called_once_with(dataset)

    def test_update_document_with_dataset_id_rejects_non_available_documents(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1", indexing_status=IndexingStatus.INDEXING)
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )
        with patch.object(DatasetService, "check_dataset_model_setting"):
            with pytest.raises(ValueError, match="Document is not available"):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

    def test_update_document_with_dataset_id_upload_file_process_rule_and_name_override(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        upload_file = UploadFile(
            tenant_id=dataset.tenant_id,
            storage_type="opendal",
            key="key",
            name="upload.txt",
            size=1,
            extension="txt",
            mime_type="text/plain",
            created_by_role="account",
            created_by=account_context.id,
            created_at=datetime(2026, 1, 1),
            used=False,
        )
        upload_file.id = "file-1"
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="content",
            word_count=1,
            tokens=1,
            created_by=account_context.id,
        )
        sqlite_session.add_all([dataset, document, upload_file, segment])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            name="Renamed document",
            doc_form=IndexStructureType.QA_INDEX,
        )
        updated_at = datetime(2026, 2, 1)

        with (
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.naive_utc_now", return_value=updated_at),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            result = DocumentService.update_document_with_dataset_id(
                dataset,
                document_data,
                account_context,
                session=sqlite_session,
            )

        assert result is document
        assert document.dataset_process_rule_id is not None
        assert sqlite_session.get(DatasetProcessRule, document.dataset_process_rule_id) is not None
        assert document.data_source_type == "upload_file"
        assert document.data_source_info == '{"upload_file_id": "file-1"}'
        assert document.name == "Renamed document"
        assert document.indexing_status == "waiting"
        assert document.completed_at is None
        assert document.processing_started_at is None
        assert document.parsing_completed_at is None
        assert document.cleaning_completed_at is None
        assert document.splitting_completed_at is None
        assert document.updated_at == updated_at
        assert document.created_from == "web"
        assert document.doc_form == IndexStructureType.QA_INDEX
        sqlite_session.expire_all()
        persisted = sqlite_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.name == "Renamed document"
        assert sqlite_session.get(DocumentSegment, segment.id).status == "re_segment"
        update_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_update_document_with_dataset_id_notion_import_requires_binding(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page")],
                        )
                    ],
                )
            ),
        )

        with patch.object(DatasetService, "check_dataset_model_setting"):
            with pytest.raises(ValueError, match="Data source binding not found"):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

    def test_update_document_with_dataset_id_website_crawl_updates_segments_and_dispatches_task(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="content",
            word_count=1,
            tokens=1,
            created_by=account_context.id,
        )
        sqlite_session.add_all([dataset, document, segment])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com"],
                        only_main_content=False,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        )

        with (
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            result = DocumentService.update_document_with_dataset_id(
                dataset,
                document_data,
                account_context,
                session=sqlite_session,
            )

        assert result is document
        assert document.data_source_type == "website_crawl"
        assert document.data_source_info == (
            '{"url": "https://example.com", "provider": "firecrawl", "job_id": "job-1", '
            '"only_main_content": false, "mode": "crawl"}'
        )
        assert document.name == ""
        assert document.doc_form == IndexStructureType.PARENT_CHILD_INDEX
        sqlite_session.expire_all()
        assert sqlite_session.get(DocumentSegment, segment.id).status == "re_segment"
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceCreateValidation:
    """Unit tests for document creation validation helpers."""

    def test_document_create_args_validate_requires_data_source_or_process_rule(self):
        knowledge_config = SimpleNamespace(data_source=None, process_rule=None)

        with pytest.raises(ValueError, match="Data source or Process rule is required"):
            DocumentService.document_create_args_validate(knowledge_config)

    def test_document_create_args_validate_delegates_to_sub_validators(self):
        knowledge_config = SimpleNamespace(data_source=object(), process_rule=object())

        with (
            patch.object(DocumentService, "data_source_args_validate") as validate_data_source,
            patch.object(DocumentService, "process_rule_args_validate") as validate_process_rule,
        ):
            DocumentService.document_create_args_validate(knowledge_config)

        validate_data_source.assert_called_once_with(knowledge_config)
        validate_process_rule.assert_called_once_with(knowledge_config)

    def test_data_source_args_validate_rejects_invalid_type(self):
        knowledge_config = SimpleNamespace(
            data_source=SimpleNamespace(
                info_list=SimpleNamespace(
                    data_source_type="bad-source",
                    file_info_list=None,
                    notion_info_list=None,
                    website_info_list=None,
                )
            )
        )

        with pytest.raises(ValueError, match="Data source type is invalid"):
            DocumentService.data_source_args_validate(knowledge_config)

    @pytest.mark.parametrize(
        ("data_source_type", "field_name", "message"),
        [
            ("upload_file", "file_info_list", "File source info is required"),
            ("notion_import", "notion_info_list", "Notion source info is required"),
            ("website_crawl", "website_info_list", "Website source info is required"),
        ],
    )
    def test_data_source_args_validate_requires_source_specific_info(self, data_source_type, field_name, message):
        info_values = {
            "data_source_type": data_source_type,
            "file_info_list": object(),
            "notion_info_list": object(),
            "website_info_list": object(),
        }
        info_values[field_name] = None
        info_list = SimpleNamespace(**info_values)
        knowledge_config = SimpleNamespace(data_source=SimpleNamespace(info_list=info_list))

        with pytest.raises(ValueError, match=message):
            DocumentService.data_source_args_validate(knowledge_config)

    def test_process_rule_args_validate_clears_rules_for_automatic_mode(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is None

    def test_process_rule_args_validate_deduplicates_rules_and_skips_max_tokens_for_full_doc_hierarchical(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="hierarchical",
                rules=Rule(
                    pre_processing_rules=[
                        PreProcessingRule(id="remove_stopwords", enabled=True),
                        PreProcessingRule(id="remove_stopwords", enabled=False),
                    ],
                    segmentation=Segmentation(separator="\n", max_tokens=0),
                    parent_mode="full-doc",
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is not None
        assert len(knowledge_config.process_rule.rules.pre_processing_rules) == 1
        assert knowledge_config.process_rule.rules.pre_processing_rules[0].enabled is False

    def test_process_rule_args_validate_hierarchical_defaults_parent_mode_to_paragraph(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="hierarchical",
                rules=Rule(
                    pre_processing_rules=[
                        PreProcessingRule(id="remove_extra_spaces", enabled=True),
                    ],
                    segmentation=Segmentation(separator="\n", max_tokens=1024),
                    subchunk_segmentation=Segmentation(separator="\n", max_tokens=512),
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is not None
        assert knowledge_config.process_rule.rules.parent_mode == "paragraph"


class TestDocumentServiceSaveDocumentWithDatasetId:
    """Unit tests for non-SQL validation branches in save_document_with_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_requires_file_info_for_upload_source(
        self, account_context, unbound_session: Session
    ):
        dataset = _dataset_row()
        knowledge_config = _make_upload_knowledge_config(file_ids=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)):
            with pytest.raises(ValueError, match="File source info is required"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

    def test_save_document_with_dataset_id_blocks_batch_upload_for_sandbox_plan(
        self, account_context, unbound_session: Session
    ):
        dataset = _dataset_row()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_enforces_batch_upload_limit(
        self,
        account_context,
        unbound_session: Session,
        config_overrides: Callable[..., None],
    ):
        config_overrides(BATCH_UPLOAD_LIMIT=1)
        dataset = _dataset_row()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_updates_existing_document_and_data_source_type(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        updated_document = _document_row(document_id="doc-1")
        updated_document.batch = "batch-existing"

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch.object(
                DocumentService, "update_document_with_dataset_id", return_value=updated_document
            ) as update_document,
        ):
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        assert dataset.data_source_type == "upload_file"
        assert documents == [updated_document]
        assert batch == "batch-existing"
        update_document.assert_called_once_with(dataset, knowledge_config, account_context, session=sqlite_session)

    def test_save_document_with_dataset_id_requires_data_source_for_new_documents(
        self, account_context, unbound_session: Session
    ):
        dataset = _dataset_row()
        knowledge_config = _make_upload_knowledge_config(data_source=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Data source is required when creating new documents"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

    def test_save_document_with_dataset_id_requires_existing_process_rule_for_custom_mode(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        sqlite_session.add(dataset)
        sqlite_session.commit()
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="custom"),
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="No process rule found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

    def test_save_document_with_dataset_id_rejects_invalid_indexing_technique(
        self, account_context, unbound_session: Session
    ):
        dataset = _dataset_row(indexing_technique=None)
        knowledge_config = SimpleNamespace(
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            original_document_id=None,
            data_source=None,
            indexing_technique="broken-technique",
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Indexing technique is invalid"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

    def test_save_document_with_dataset_id_returns_empty_for_invalid_process_rule_mode(
        self, account_context, unbound_session: Session
    ):
        dataset = _dataset_row()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"])
        knowledge_config.process_rule = SimpleNamespace(mode="unsupported-mode", rules=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=unbound_session,
            )

        assert documents == []
        assert batch == ""

    def test_save_document_with_dataset_id_upload_file_creates_and_reindexes_documents(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
        dataset_process_rule = _process_rule()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
        duplicate_document = _document_row(document_id="doc-duplicate", name="existing.txt")
        upload_file_a = _upload_file(file_id="file-1", name="existing.txt")
        upload_file_b = _upload_file(file_id="file-2", name="new.txt")
        sqlite_session.add_all([dataset, dataset_process_rule, duplicate_document, upload_file_a, upload_file_b])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.DuplicateDocumentIndexingTaskProxy") as duplicate_proxy_cls,
            patch("services.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
                session=sqlite_session,
            )

        assert [document.name for document in documents] == ["existing.txt", "new.txt"]
        assert batch == "20260101010101100023"
        assert duplicate_document.dataset_process_rule_id == "rule-1"
        assert duplicate_document.updated_at == datetime(2026, 2, 1)
        assert duplicate_document.batch == batch
        assert duplicate_document.indexing_status == IndexingStatus.WAITING
        created_document = next(document for document in documents if document.name == "new.txt")
        sqlite_session.expire_all()
        assert sqlite_session.get(Document, created_document.id) is not None
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, [created_document.id])
        document_proxy_cls.return_value.delay.assert_called_once()
        duplicate_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-duplicate"])
        duplicate_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_notion_import_truncates_names_and_cleans_removed_pages(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.NOTION_IMPORT)
        dataset_process_rule = _process_rule()
        notion_page_name = "a" * 300
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-keep", page_name="Keep page", type="page"),
                                NotionPage(
                                    page_id="page-new",
                                    page_name=notion_page_name,
                                    page_icon=NotionIcon(type="emoji", emoji="page"),
                                    type="page",
                                ),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        existing_keep = _document_row(
            document_id="doc-keep",
            data_source_type=DataSourceType.NOTION_IMPORT,
        )
        existing_keep.data_source_info = json.dumps({"notion_page_id": "page-keep"})
        existing_remove = _document_row(
            document_id="doc-remove",
            data_source_type=DataSourceType.NOTION_IMPORT,
        )
        existing_remove.data_source_info = json.dumps({"notion_page_id": "page-remove"})
        sqlite_session.add_all([dataset, dataset_process_rule, existing_keep, existing_remove])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.clean_notion_document_task") as clean_task,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.uuid.uuid4", return_value="doc-new"),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
                session=sqlite_session,
            )

        created_document = next(document for document in documents if document.id == "doc-new")
        assert created_document in documents
        assert len(created_document.name) == 255
        assert sqlite_session.get(Document, created_document.id) is created_document
        clean_task.delay.assert_called_once_with(["doc-remove"], dataset.id)
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-new"])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_website_crawl_truncates_long_urls(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.WEBSITE_CRAWL)
        dataset_process_rule = _process_rule()
        sqlite_session.add_all([dataset, dataset_process_rule])
        sqlite_session.commit()
        long_url = "https://example.com/" + ("a" * 260)
        short_url = "https://example.com/short"
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=[long_url, short_url],
                        only_main_content=True,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
        ):
            mock_redis.lock.return_value = _make_lock_context()

            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
                session=sqlite_session,
            )

        assert [document.name for document in documents] == [long_url[:200] + "...", short_url]
        assert sqlite_session.scalars(select(Document).order_by(Document.position)).all() == documents
        document_proxy_cls.assert_called_once_with(
            dataset.tenant_id, dataset.id, [document.id for document in documents]
        )
        document_proxy_cls.return_value.delay.assert_called_once()


class TestDocumentServiceBatchUpdateStatus:
    """Unit tests for batch_update_document_status orchestration and helper branches."""

    def test_prepare_disable_update_requires_completed_document(self):
        document = _document_row(indexing_status=IndexingStatus.WAITING)
        document.completed_at = None

        with pytest.raises(DocumentIndexingError, match="is not completed"):
            DocumentService._prepare_disable_update(document, user=_account(), now=datetime(2026, 2, 1))

    def test_prepare_archive_update_sets_async_task_for_enabled_document(self):
        document = _document_row(enabled=True, archived=False)

        result = DocumentService._prepare_archive_update(document, user=_account(), now=datetime(2026, 2, 1))

        assert result is not None
        assert result["updates"]["archived"] is True
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_prepare_unarchive_update_sets_async_task_for_enabled_document(self):
        document = _document_row(enabled=True, archived=True)

        result = DocumentService._prepare_unarchive_update(document, now=datetime(2026, 2, 1))

        assert result is not None
        assert result["updates"]["archived"] is False
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_batch_update_document_status_rejects_indexing_documents(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(name="Busy document")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(DocumentIndexingError, match="Busy document is being indexed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "archive", _account(), sqlite_session
                )

        sqlite_session.refresh(document)
        assert document.archived is False

    def test_batch_update_document_status_rolls_back_when_commit_fails(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(enabled=False)
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()

        def fail_commit(_session):
            raise RuntimeError("commit failed")

        event.listen(sqlite_session, "before_commit", fail_commit)
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
        ):
            mock_redis.get.return_value = None

            with pytest.raises(RuntimeError, match="commit failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", _account(), sqlite_session
                )
        event.remove(sqlite_session, "before_commit", fail_commit)

        sqlite_session.refresh(document)
        assert document.enabled is False

    def test_batch_update_document_status_raises_async_task_error_after_commit(self, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(enabled=False)
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.add_document_to_index_task") as add_task,
        ):
            mock_redis.get.return_value = None
            add_task.delay.side_effect = RuntimeError("task failed")

            with pytest.raises(RuntimeError, match="task failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", _account(), sqlite_session
                )

        sqlite_session.refresh(document)
        assert document.enabled is True
        mock_redis.setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)


class TestDocumentServiceTenantAndUpdateEdges:
    """Unit tests for tenant-count and update edge cases."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_tenant_documents_count_scopes_state_and_tenant(self, account_context, sqlite_session: Session):
        sqlite_session.add_all(
            [
                _document_row(document_id="one"),
                _document_row(document_id="two"),
                _document_row(document_id="disabled", enabled=False),
                _document_row(document_id="archived", archived=True),
                _document_row(document_id="unfinished", indexing_status=IndexingStatus.WAITING),
                _document_row(document_id="foreign", tenant_id="tenant-2"),
            ]
        )
        sqlite_session.commit()

        result = DocumentService.get_tenant_documents_count(sqlite_session)

        assert result == 2

    def test_update_document_with_dataset_id_uses_automatic_process_rule_payload(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        upload_file = _upload_file(file_id="file-1")
        sqlite_session.add_all([dataset, document, upload_file])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        updated_at = datetime(2026, 2, 1)

        with (
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.naive_utc_now", return_value=updated_at),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            result = DocumentService.update_document_with_dataset_id(
                dataset,
                document_data,
                account_context,
                session=sqlite_session,
            )

        assert result is document
        assert document.dataset_process_rule_id is not None
        assert document.name == "upload.txt"
        process_rule = sqlite_session.get(DatasetProcessRule, document.dataset_process_rule_id)
        assert process_rule is not None
        assert process_rule.mode == "automatic"
        assert process_rule.rules == json.dumps(DatasetProcessRule.AUTOMATIC_RULES)
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")

    def test_update_document_with_dataset_id_requires_upload_file_info(self, account_context, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="upload_file")),
        )

        with patch.object(DatasetService, "check_dataset_model_setting"):
            with pytest.raises(ValueError, match="No file info list found"):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

    def test_update_document_with_dataset_id_raises_when_upload_file_is_missing(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with patch.object(DatasetService, "check_dataset_model_setting"):
            with pytest.raises(FileNotExistsError):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

    def test_update_document_with_dataset_id_requires_notion_info_list(self, account_context, sqlite_session: Session):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
        )

        with patch.object(DatasetService, "check_dataset_model_setting"):
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

    def test_update_document_with_dataset_id_notion_import_updates_page_info(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row()
        document = _document_row(document_id="doc-1")
        binding = DataSourceOauthBinding(
            tenant_id=dataset.tenant_id,
            access_token="token",
            provider="notion",
            source_info={"workspace_id": '"workspace-1"'},
            disabled=False,
        )
        sqlite_session.add_all([dataset, document, binding])
        sqlite_session.commit()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="database"),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with (
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            result = DocumentService.update_document_with_dataset_id(
                dataset,
                document_data,
                account_context,
                session=sqlite_session,
            )

        assert result is document
        assert document.data_source_type == "notion_import"
        assert document.name == ""
        assert document.data_source_info == json.dumps(
            {
                "credential_id": "credential-1",
                "notion_workspace_id": "workspace-1",
                "notion_page_id": "page-2",
                "notion_page_icon": None,
                "type": "database",
            }
        )
        sqlite_session.refresh(document)
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceSaveWithoutDatasetBilling:
    """Unit tests for batch-count and quota branches in save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_counts_notion_pages_for_quota(
        self,
        account_context,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
    ):
        config_overrides(BATCH_UPLOAD_LIMIT="10")
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="page"),
                            ],
                        ),
                        NotionInfo(
                            credential_id="credential-2",
                            workspace_id="workspace-2",
                            pages=[NotionPage(page_id="page-3", page_name="Page 3", page_icon=None, type="page")],
                        ),
                    ],
                )
            ),
        )
        features = _make_features(enabled=True)
        document = _document_row(name="Doc")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([document], "batch-1"),
            ),
        ):
            dataset, _, _ = DocumentService.save_document_without_dataset_id(
                "tenant-1",
                knowledge_config,
                account_context,
                sqlite_session,
            )

        check_quota.assert_called_once_with(3, features)
        assert sqlite_session.get(Dataset, dataset.id) is dataset

    def test_save_document_without_dataset_id_enforces_batch_limit_for_website_urls(
        self,
        account_context,
        unbound_session: Session,
        config_overrides: Callable[..., None],
    ):
        config_overrides(BATCH_UPLOAD_LIMIT="1")
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com/a", "https://example.com/b"],
                        only_main_content=True,
                    ),
                )
            ),
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_without_dataset_id(
                    "tenant-1", knowledge_config, account_context, unbound_session
                )

        check_quota.assert_not_called()


class TestDocumentServiceEstimateValidation:
    """Unit tests for estimate_args_validate branches."""

    def test_estimate_args_validate_rejects_missing_info_list(self):
        with pytest.raises(ValueError, match="Field required"):
            DocumentService.estimate_args_validate({})

    def test_estimate_args_validate_sets_empty_rules_for_automatic_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {"mode": "automatic", "rules": {"ignored": True}},
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"] == {}

    def test_estimate_args_validate_rejects_unknown_pre_processing_rule_id(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "unknown", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        with pytest.raises(ValueError, match="pre_processing_rules id is invalid"):
            DocumentService.estimate_args_validate(args)

    def test_estimate_args_validate_deduplicates_rules_for_custom_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [
                        {"id": "remove_stopwords", "enabled": True},
                        {"id": "remove_stopwords", "enabled": False},
                    ],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"]["pre_processing_rules"] == [{"id": "remove_stopwords", "enabled": False}]

    def test_estimate_args_validate_custom_mode_drops_hierarchical_fields(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                    "parent_mode": "full-doc",
                    "subchunk_segmentation": {"separator": "###", "max_tokens": 64},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"] == {
            "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
            "segmentation": {"separator": "\n", "max_tokens": 128},
        }

    def test_estimate_args_validate_requires_summary_index_provider_name(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
                "summary_index_setting": {"enable": True, "model_name": "summary-model"},
            },
        }

        with pytest.raises(ValueError, match="Field required"):
            DocumentService.estimate_args_validate(args)

    def test_estimate_args_validate_preserves_hierarchical_fields(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "hierarchical",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 512},
                    "parent_mode": "full-doc",
                    "subchunk_segmentation": {"separator": "###", "max_tokens": 128},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"]["parent_mode"] == "full-doc"
        assert args["process_rule"]["rules"]["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}

    def test_estimate_args_validate_hierarchical_defaults_parent_mode_to_paragraph(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "hierarchical",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 512},
                    "subchunk_segmentation": {"separator": "###", "max_tokens": 128},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"]["parent_mode"] == "paragraph"
        assert args["process_rule"]["rules"]["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}


class TestDocumentServiceSaveDocumentAdditionalBranches:
    """Additional unit tests for dataset bootstrap and process-rule branches."""

    @pytest.fixture
    def account_context(self):
        account = _account()

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_initializes_high_quality_dataset_from_default_embedding_model(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=None, indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = None
        knowledge_config.embedding_model_provider = None
        updated_document = _document_row(document_id="doc-1")
        updated_document.batch = "batch-existing"
        binding = DatasetCollectionBinding(
            provider_name="default-provider",
            model_name="default-embedding",
            type="dataset",
            collection_name="collection",
        )
        binding.id = "binding-1"

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=binding,
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=updated_document),
        ):
            model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = SimpleNamespace(
                model_name="default-embedding",
                provider="default-provider",
            )

            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        assert documents == [updated_document]
        assert batch == "batch-existing"
        assert dataset.data_source_type == "upload_file"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "default-embedding"
        assert dataset.embedding_model_provider == "default-provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.retrieval_model == {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
            "top_k": 4,
            "score_threshold_enabled": False,
        }
        get_binding.assert_called_once_with("default-provider", "default-embedding", sqlite_session)

    def test_save_document_with_dataset_id_uses_explicit_embedding_and_retrieval_model(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = "explicit-model"
        knowledge_config.embedding_model_provider = "explicit-provider"
        knowledge_config.retrieval_model = RetrievalModel(
            search_method="semantic_search",
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=7,
            score_threshold_enabled=True,
            score_threshold=0.3,
        )
        binding = DatasetCollectionBinding(
            provider_name="explicit-provider",
            model_name="explicit-model",
            type="dataset",
            collection_name="collection",
        )
        binding.id = "binding-2"
        updated_document = _document_row(document_id="doc-1")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=binding,
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=updated_document),
        ):
            DocumentService.save_document_with_dataset_id(
                dataset, knowledge_config, account_context, session=sqlite_session
            )

        model_manager_cls.for_tenant.return_value.get_default_model_instance.assert_not_called()
        get_binding.assert_called_once_with("explicit-provider", "explicit-model", sqlite_session)
        assert dataset.embedding_model == "explicit-model"
        assert dataset.embedding_model_provider == "explicit-provider"
        assert dataset.retrieval_model == knowledge_config.retrieval_model.model_dump()

    def test_save_document_with_dataset_id_creates_custom_process_rule_for_new_upload_document(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )
        upload_file = _upload_file(file_id="file-1", name="file.txt")
        sqlite_session.add_all([dataset, upload_file])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        assert len(documents) == 1
        created_document = documents[0]
        assert created_document.name == "file.txt"
        assert batch == "20260101010101100023"
        created_rule = sqlite_session.get(DatasetProcessRule, created_document.dataset_process_rule_id)
        assert created_rule is not None
        assert created_rule.mode == "custom"
        assert created_rule.rules == knowledge_config.process_rule.rules.model_dump_json()
        document_proxy_cls.assert_called_once_with("tenant-1", "dataset-1", [created_document.id])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_creates_automatic_process_rule_for_new_upload_document(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="automatic"),
        )
        sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        created_rule = sqlite_session.get(DatasetProcessRule, documents[0].dataset_process_rule_id)
        assert created_rule is not None
        assert created_rule.mode == "automatic"
        assert created_rule.rules == json.dumps(DatasetProcessRule.AUTOMATIC_RULES)
        assert sqlite_session.get(Document, documents[0].id) is documents[0]

    def test_save_document_with_dataset_id_creates_fallback_automatic_process_rule_when_latest_is_missing(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"], process_rule=None)
        sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        created_rule = sqlite_session.get(DatasetProcessRule, documents[0].dataset_process_rule_id)
        assert created_rule is not None
        assert created_rule.mode == "automatic"
        assert created_rule.rules == json.dumps(DatasetProcessRule.AUTOMATIC_RULES)

    def test_save_document_with_dataset_id_raises_when_upload_file_lookup_is_incomplete(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
        sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(FileNotExistsError, match="One or more files not found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

    def test_save_document_with_dataset_id_requires_notion_info_list_for_notion_import(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.NOTION_IMPORT)
        process_rule = _process_rule()
        sqlite_session.add_all([dataset, process_rule])
        sqlite_session.commit()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=process_rule,
                    session=sqlite_session,
                )

    def test_save_document_with_dataset_id_requires_website_info_list_for_website_crawl(
        self, account_context, sqlite_session: Session
    ):
        dataset = _dataset_row(data_source_type=DataSourceType.WEBSITE_CRAWL)
        process_rule = _process_rule()
        sqlite_session.add_all([dataset, process_rule])
        sqlite_session.commit()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="website_crawl")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No website info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=process_rule,
                    session=sqlite_session,
                )
