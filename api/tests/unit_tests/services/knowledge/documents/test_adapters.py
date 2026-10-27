import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from redis.exceptions import LockNotOwnedError
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.datasets_document import DocumentDetailResponse, DocumentWithSegmentsListResponse
from core.model_manager import ModelInstance
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import CloudPlan
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentPipelineExecutionLog, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode, SegmentStatus
from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy
from services.document_indexing_proxy.document_indexing_task_proxy import DocumentIndexingTaskProxy
from services.document_indexing_proxy.duplicate_document_indexing_task_proxy import DuplicateDocumentIndexingTaskProxy
from services.entities.feature_entities import FeatureModel
from services.errors.file import FileNotExistsError
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DocumentListFilter, DocumentNotFoundError
from services.knowledge.resource_scope import DatasetRef
from tests.helpers.unit.model_factories import make_upload_file

_DOCUMENT_ADAPTERS_REF = DatasetRef("tenant-1", "dataset-1")


def _dataset(**values: object) -> Dataset:
    row = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        created_by="actor-1",
        maintainer="actor-1",
        indexing_technique="economy",
        chunk_structure="text_model",
    )
    for key, value in values.items():
        setattr(row, key, value)
    return row


def _document(**values: object) -> Document:
    row = Document(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType("local_file"),
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom("web"),
        created_by="actor-1",
    )
    row.id = "document-1"
    row.data_source_info = json.dumps({"file_path": "/path/to/file"})
    row.indexing_status = IndexingStatus.COMPLETED
    row.doc_form = IndexStructureType.PARAGRAPH_INDEX
    row.enabled = True
    row.archived = False
    row.word_count = 10
    row.created_at = datetime(2024, 1, 1)
    for key, value in values.items():
        setattr(row, key, value)
    return row


def _segment(
    segment_id: str,
    *,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    status: SegmentStatus = SegmentStatus.COMPLETED,
    completed_at: datetime | None = datetime(2024, 1, 1),
    hit_count: int = 0,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="actor-1",
        status=status,
        completed_at=completed_at,
        hit_count=hit_count,
    )
    segment.id = segment_id
    return segment


class TestDocumentAdaptersCases:
    @staticmethod
    @pytest.fixture
    def operations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentOperations:
        with sqlite_session_factory.begin() as session:
            session.add_all([_dataset(), _document()])
        return SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory)

    @staticmethod
    @pytest.mark.parametrize("foreign", [{"tenant_id": "other"}, {"dataset_id": "other"}])
    def test_document_reads_and_writes_reject_incorrect_owner(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session], foreign: dict[str, str]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(_document(id="foreign", **foreign))
        ref = _DOCUMENT_ADAPTERS_REF.document("foreign")
        assert operations.get_state(ref) is None
        with pytest.raises(DocumentNotFoundError):
            operations.get_detail(ref, metadata_only=False)
        with pytest.raises(DocumentNotFoundError):
            operations.update_document(ref, {"name": "changed"})
        with pytest.raises(DocumentNotFoundError):
            operations.rename_document(ref, "changed")
        with sqlite_session_factory() as session:
            document = session.get(Document, "foreign")
            assert document is not None
            assert document.name == "Document"

    @staticmethod
    def test_document_lookup_uses_active_workspace(operations: SQLAlchemyDocumentOperations) -> None:
        assert operations.find_document(workspace_id="other", document_id="document-1") is None
        assert operations.find_document(
            workspace_id="tenant-1", document_id="document-1"
        ) == _DOCUMENT_ADAPTERS_REF.document("document-1")

    @staticmethod
    def test_listing_filters_scope_and_materializes_values(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _document(id="matching", name="Needle", position=2),
                    _document(id="disabled", name="Needle", enabled=False),
                    _document(id="foreign", name="Needle", tenant_id="other"),
                    _document(id="other-dataset", name="Needle", dataset_id="other"),
                ]
            )
        result = operations.list_documents(
            _DOCUMENT_ADAPTERS_REF, DocumentListFilter(search="Needle", status="available", fetch=True)
        )
        response = DocumentWithSegmentsListResponse.model_validate(result).model_dump(mode="json")
        assert response["total"] == 1
        assert response["data"][0]["id"] == "matching"
        assert response["data"][0]["data_source_info"] == {"file_path": "/path/to/file"}
        assert response["data"][0]["completed_segments"] == 0
        assert response["data"][0]["total_segments"] == 0

    @staticmethod
    def test_listing_hit_count_sort_and_exact_last_page(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _document(id="popular", position=2),
                    _segment("segment-1", hit_count=1),
                    _segment("segment-2", document_id="popular", hit_count=10),
                    _segment("foreign", tenant_id="other", hit_count=1000),
                ]
            )
        first = operations.list_documents(_DOCUMENT_ADAPTERS_REF, DocumentListFilter(sort="-hit_count", limit=1))
        last = operations.list_documents(_DOCUMENT_ADAPTERS_REF, DocumentListFilter(sort="-hit_count", limit=1, page=2))
        assert [row["id"] for row in first["data"]] == ["popular"]
        assert first["has_more"] is True
        assert last["has_more"] is False
        assert last["total"] == 2

    @staticmethod
    def test_status_counts_use_one_aggregate_and_complete_owner_chain(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _segment("complete"),
                    _segment("waiting", completed_at=None),
                    _segment("excluded", status=SegmentStatus.RE_SEGMENT),
                    _segment("foreign", tenant_id="other"),
                    _segment("wrong-dataset", dataset_id="other"),
                    _document(id="second", is_paused=True, indexing_status=IndexingStatus.INDEXING),
                ]
            )
        statements: list[str] = []

        def record(
            _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
        ) -> None:
            statements.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", record)
        try:
            result = operations.get_batch_indexing_status(_DOCUMENT_ADAPTERS_REF, "batch-1")
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record)
        rows = {row["id"]: row for row in result["data"]}
        assert rows["document-1"]["completed_segments"] == 1
        assert rows["document-1"]["total_segments"] == 2
        assert rows["second"]["indexing_status"] == "paused"
        assert sum("FROM document_segments" in statement for statement in statements) == 1

    @staticmethod
    def test_unknown_batch_is_not_found(operations: SQLAlchemyDocumentOperations) -> None:
        with pytest.raises(DocumentNotFoundError):
            operations.get_batch_indexing_status(_DOCUMENT_ADAPTERS_REF, "missing")

    @staticmethod
    @pytest.mark.parametrize("rules", [None, {"segmentation": {"delimiter": "\\n", "max_tokens": 500}}])
    def test_process_rule_preserves_null_and_legacy_delimiter(
        operations: SQLAlchemyDocumentOperations,
        sqlite_session_factory: sessionmaker[Session],
        rules: dict[str, object] | None,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(
                DatasetProcessRule(
                    dataset_id="dataset-1",
                    mode=ProcessRuleMode.CUSTOM,
                    rules=json.dumps(rules) if rules else None,
                    created_by="actor-1",
                )
            )
        result = operations.get_process_rule(_DOCUMENT_ADAPTERS_REF)
        assert result["mode"] == "custom"
        assert result["rules"] == rules

    @staticmethod
    def test_detail_is_serializable_after_session_closes(operations: SQLAlchemyDocumentOperations) -> None:
        result = operations.get_detail(_DOCUMENT_ADAPTERS_REF.document("document-1"), metadata_only=False)
        response = DocumentDetailResponse.model_validate(result).model_dump(mode="json")
        assert response["id"] == "document-1"
        assert response["data_source_info"] == {"file_path": "/path/to/file"}
        assert response["data_source_detail_dict"] == {}
        assert response["created_at"] == int(datetime(2024, 1, 1).timestamp())

    @staticmethod
    def test_metadata_only_avoids_loading_full_details(operations: SQLAlchemyDocumentOperations) -> None:
        with patch("services.knowledge.documents.adapters.get_document_source_detail") as source:
            result = operations.get_detail(_DOCUMENT_ADAPTERS_REF.document("document-1"), metadata_only=True)
        assert set(result) == {"id", "doc_type", "doc_metadata"}
        source.assert_not_called()

    @staticmethod
    def test_update_is_committed_before_returning(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        operations.update_document(
            _DOCUMENT_ADAPTERS_REF.document("document-1"), {"is_paused": True, "paused_by": "actor-1"}
        )
        with sqlite_session_factory() as session:
            document = session.get(Document, "document-1")
            assert document is not None
            assert document.is_paused is True
            assert document.paused_by == "actor-1"

    @staticmethod
    def test_latest_pipeline_log_and_empty_result(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        assert operations.get_execution_log(_DOCUMENT_ADAPTERS_REF.document("document-1")) == {}
        with sqlite_session_factory.begin() as session:
            for year in [2024, 2025]:
                row = DocumentPipelineExecutionLog(
                    pipeline_id="pipeline-1",
                    document_id="document-1",
                    datasource_type="local_file",
                    datasource_info=json.dumps({"year": year}),
                    datasource_node_id="node-1",
                    input_data={"year": year},
                    created_by="actor-1",
                )
                row.created_at = datetime(year, 1, 1)
                session.add(row)
        result = operations.get_execution_log(_DOCUMENT_ADAPTERS_REF.document("document-1"))
        assert result["datasource_info"] == {"year": 2025}
        assert result["input_data"] == {"year": 2025}

    @staticmethod
    @pytest.mark.parametrize("settings", [None, {"enable": False}])
    def test_summary_guard_rejects_disabled_summary(
        operations: SQLAlchemyDocumentOperations,
        sqlite_session_factory: sessionmaker[Session],
        settings: dict[str, object] | None,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            dataset = session.get(Dataset, "dataset-1")
            assert dataset is not None
            dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
            dataset.summary_index_setting = settings
        with pytest.raises(ValueError, match="not enabled"):
            operations.require_summary_enabled(_DOCUMENT_ADAPTERS_REF)

    @staticmethod
    def test_enable_summary_only_updates_requested_owner(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(_document(id="foreign", tenant_id="other", need_summary=False))
        operations.enable_summary(_DOCUMENT_ADAPTERS_REF, ["document-1", "foreign"])
        with sqlite_session_factory() as session:
            document = session.get(Document, "document-1")
            foreign = session.get(Document, "foreign")
            assert document is not None
            assert foreign is not None
            assert document.need_summary is True
            assert foreign.need_summary is False


"""Exercise document creation with real SQL and assertions at external boundaries."""


CONTEXT = RequestContext("request", None, "actor", "tenant")
_DOCUMENT_CREATION_REF = DatasetRef("tenant", "dataset")


def settings(**values: object) -> dict[str, object]:
    return {
        "indexing_technique": "economy",
        "process_rule": {"mode": "automatic"},
        "data_source": {"info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file"]}}},
        **values,
    }


class TestDocumentCreationCases:
    @staticmethod
    @pytest.fixture
    def operations(
        sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
    ) -> SQLAlchemyDocumentOperations:
        config_overrides(DEPLOYMENT_EDITION="CLOUD", RBAC_ENABLED=False)
        with sqlite_session_factory.begin() as session:
            actor = Account(name="Actor", email="actor@example.com")
            actor.id = "actor"
            tenant = Tenant(name="Tenant")
            tenant.id = "tenant"
            session.add_all(
                [
                    actor,
                    tenant,
                    TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER),
                    Dataset(
                        id="dataset",
                        tenant_id="tenant",
                        name="Dataset",
                        created_by="actor",
                        indexing_technique="economy",
                    ),
                    make_upload_file(file_id="file", tenant_id="tenant", name="example.txt", created_by="actor"),
                    make_upload_file(file_id="foreign-file", tenant_id="foreign", name="foreign.txt"),
                ]
            )
        return SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory)

    @staticmethod
    @pytest.fixture
    def outside_transaction(sqlite_engine: Engine) -> Iterator[Callable[[], None]]:
        active: set[int] = set()

        def begin(connection: object) -> None:
            active.add(id(connection))

        def end(connection: object) -> None:
            active.discard(id(connection))

        def check() -> None:
            assert not active, "External I/O must not hold an open database transaction"

        listeners = [("begin", begin), ("commit", end), ("rollback", end)]
        for name, callback in listeners:
            event.listen(sqlite_engine, name, callback)
        yield check
        for name, callback in listeners:
            event.remove(sqlite_engine, name, callback)

    @staticmethod
    @pytest.fixture
    def external_calls(
        monkeypatch: pytest.MonkeyPatch,
        outside_transaction: Callable[[], None],
        sqlite_session_factory: sessionmaker[Session],
    ) -> list[tuple[str, tuple[str, ...]]]:
        calls: list[tuple[str, tuple[str, ...]]] = []

        def features(_tenant_id: str, *, exclude_vector_space: bool) -> FeatureModel:
            outside_transaction()
            assert exclude_vector_space is True
            result = FeatureModel()
            result.billing.subscription.plan = CloudPlan.PROFESSIONAL
            return result

        @contextmanager
        def lock(_name: str, *, timeout: int) -> Generator[None]:
            outside_transaction()
            assert timeout == 600
            yield
            outside_transaction()

        def dispatched(kind: str, dataset_id: str, document_ids: tuple[str, ...]) -> None:
            outside_transaction()
            with sqlite_session_factory() as session:
                for document_id in document_ids:
                    document = session.get(Document, document_id)
                    assert document is not None
                    assert document.dataset_id == dataset_id
                    if kind != "clean":
                        assert document.indexing_status == IndexingStatus.WAITING
            calls.append((kind, document_ids))

        def create(proxy: BatchDocumentIndexingProxy) -> None:
            dispatched("create", proxy._dataset_id, tuple(proxy._document_ids))

        def duplicate(proxy: BatchDocumentIndexingProxy) -> None:
            dispatched("duplicate", proxy._dataset_id, tuple(proxy._document_ids))

        monkeypatch.setattr("services.knowledge.dataset_service.FeatureService.get_features", features)
        monkeypatch.setattr("services.knowledge.documents.adapters.redis_client.lock", lock)
        monkeypatch.setattr(DocumentIndexingTaskProxy, "delay", create)
        monkeypatch.setattr(DuplicateDocumentIndexingTaskProxy, "delay", duplicate)
        monkeypatch.setattr(
            "services.knowledge.dataset_service.document_indexing_update_task.delay",
            lambda dataset_id, document_id: dispatched("update", dataset_id, (document_id,)),
        )
        monkeypatch.setattr(
            "services.knowledge.dataset_service.clean_notion_document_task.delay",
            lambda document_ids, dataset_id: dispatched("clean", dataset_id, tuple(document_ids)),
        )
        return calls

    @staticmethod
    @pytest.mark.parametrize("initialize", [False, True])
    def test_upload_preserves_response_and_commits_before_dispatch(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        sqlite_session_factory: sessionmaker[Session],
        initialize: bool,
    ) -> None:
        result = (
            operations.initialize_dataset(CONTEXT, settings())
            if initialize
            else operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        )
        (document,) = result["documents"]
        assert document["name"] == "example.txt"
        assert document["data_source_info_dict"] == {"upload_file_id": "file"}
        assert document["indexing_status"] == "waiting"
        assert result["batch"]
        assert external_calls == [("create", (document["id"],))]
        with sqlite_session_factory() as session:
            dataset = session.get(Dataset, result["dataset"]["id"])
            assert dataset is not None
            assert dataset.tenant_id == "tenant"
            assert dataset.name == ("example.txt..." if initialize else "Dataset")
            assert dataset.permission == "only_me"

    @staticmethod
    def test_duplicate_upload_reuses_document_and_dispatches_duplicate_job(
        operations: SQLAlchemyDocumentOperations, external_calls: list[tuple[str, tuple[str, ...]]]
    ) -> None:
        first = operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        second = operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        first_id = first["documents"][0]["id"]
        assert second["documents"][0]["id"] == first_id
        assert external_calls == [("create", (first_id,)), ("duplicate", (first_id,))]

    @staticmethod
    def test_reprocess_checks_model_outside_transaction_and_preserves_segment_reset(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        outside_transaction: Callable[[], None],
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        created = operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        document_id = created["documents"][0]["id"]
        with sqlite_session_factory.begin() as session:
            document = session.get(Document, document_id)
            assert document is not None
            document.indexing_status = IndexingStatus.COMPLETED
            document.completed_at = datetime(2026, 1, 1)
            dataset = session.get(Dataset, _DOCUMENT_CREATION_REF.dataset_id)
            assert dataset is not None
            dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
            dataset.embedding_model = "embedding"
            dataset.embedding_model_provider = "provider"
            session.add(
                DocumentSegment(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    document_id=document_id,
                    position=1,
                    content="content",
                    word_count=1,
                    tokens=1,
                    created_by="actor",
                    status=SegmentStatus.COMPLETED,
                )
            )
        manager = Mock()
        manager.get_model_instance.side_effect = lambda **_kwargs: outside_transaction()
        monkeypatch.setattr("services.knowledge.dataset_service.ModelManager.for_tenant", lambda **_kwargs: manager)
        result = operations.create_documents(
            CONTEXT, _DOCUMENT_CREATION_REF, settings(original_document_id=document_id, name="Renamed")
        )
        assert result["documents"][0]["id"] == document_id
        assert result["documents"][0]["name"] == "Renamed"
        assert result["batch"] == created["batch"]
        assert external_calls[-1] == ("update", (document_id,))
        manager.get_model_instance.assert_called_once()
        with sqlite_session_factory() as session:
            segment = session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document_id))
            assert segment is not None
            assert segment.status == SegmentStatus.RE_SEGMENT

    @staticmethod
    def test_first_high_quality_upload_resolves_default_model_without_transaction(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        outside_transaction: Callable[[], None],
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            dataset = session.get(Dataset, _DOCUMENT_CREATION_REF.dataset_id)
            assert dataset is not None
            dataset.indexing_technique = None

        def model(**_kwargs: object) -> ModelInstance:
            outside_transaction()
            instance = object.__new__(ModelInstance)
            instance.model_name = "default-embedding"
            instance.provider = "default-provider"
            return instance

        manager = Mock()
        manager.get_default_model_instance.side_effect = model
        monkeypatch.setattr("services.knowledge.dataset_service.ModelManager.for_tenant", lambda **_kwargs: manager)
        operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings(indexing_technique="high_quality"))
        with sqlite_session_factory() as session:
            dataset = session.get(Dataset, _DOCUMENT_CREATION_REF.dataset_id)
            assert dataset is not None
            assert dataset.embedding_model == "default-embedding"
            assert dataset.embedding_model_provider == "default-provider"
            assert dataset.collection_binding_id is not None
        assert len(external_calls) == 1

    @staticmethod
    def test_foreign_upload_is_rejected_without_dispatch(
        operations: SQLAlchemyDocumentOperations, external_calls: list[tuple[str, tuple[str, ...]]]
    ) -> None:
        config = settings(
            data_source={
                "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["foreign-file"]}}
            }
        )
        with pytest.raises(FileNotExistsError):
            operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, config)
        assert external_calls == []

    @staticmethod
    def test_notion_removal_is_dispatched_after_new_documents_commit(
        operations: SQLAlchemyDocumentOperations, external_calls: list[tuple[str, tuple[str, ...]]]
    ) -> None:
        def notion(page_id: str) -> dict[str, object]:
            return settings(
                data_source={
                    "info_list": {
                        "data_source_type": "notion_import",
                        "notion_info_list": [
                            {
                                "credential_id": "credential",
                                "workspace_id": "workspace",
                                "pages": [{"page_id": page_id, "page_name": page_id, "type": "page"}],
                            }
                        ],
                    }
                }
            )

        first = operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, notion("old-page"))
        old_id = first["documents"][0]["id"]
        operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, notion("new-page"))
        assert external_calls[-2] == ("clean", (old_id,))
        assert external_calls[-1][0] == "create"
        assert old_id not in external_calls[-1][1]

    @staticmethod
    def test_cloud_quota_rejection_does_not_create_documents_or_dispatch(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        sqlite_session_factory: sessionmaker[Session],
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(BATCH_UPLOAD_LIMIT=0)
        with pytest.raises(ValueError, match="batch upload limit"):
            operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        assert external_calls == []
        with sqlite_session_factory() as session:
            assert session.scalar(select(Document.id)) is None

    @staticmethod
    def test_response_read_failure_still_dispatches_already_committed_documents(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        response = Mock(side_effect=ValueError("response read failed"))
        monkeypatch.setattr("services.knowledge.documents.adapters._created_response", response)
        with pytest.raises(ValueError, match="response read failed"):
            operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        assert len(external_calls) == 1
        assert external_calls[0][0] == "create"

    @staticmethod
    def test_lost_creation_lock_keeps_empty_batch_response(
        operations: SQLAlchemyDocumentOperations,
        external_calls: list[tuple[str, tuple[str, ...]]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        @contextmanager
        def lock(_name: str, **_kwargs: object) -> Generator[None]:
            raise LockNotOwnedError("lock lost")
            yield  # pragma: no cover

        monkeypatch.setattr("services.knowledge.documents.adapters.redis_client.lock", lock)
        result = operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        assert result["documents"] == []
        assert result["batch"]
        assert result["dataset"]["id"] == _DOCUMENT_CREATION_REF.dataset_id
        assert external_calls == []

    @staticmethod
    def test_billing_http_boundary_does_not_hold_a_transaction(
        operations: SQLAlchemyDocumentOperations,
        outside_transaction: Callable[[], None],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class StopBeforeNetworkError(Exception):
            pass

        def request(_method: str, url: str, **_kwargs: object) -> None:
            assert url.endswith("/subscription/info")
            outside_transaction()
            raise StopBeforeNetworkError()

        monkeypatch.setattr("services.billing_service._http_client.request", request)
        with pytest.raises(StopBeforeNetworkError):
            operations.create_documents(CONTEXT, _DOCUMENT_CREATION_REF, settings())
        outside_transaction()
