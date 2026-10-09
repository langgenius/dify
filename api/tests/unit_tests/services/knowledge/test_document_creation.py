"""Exercise document creation with real SQL and assertions at external boundaries."""

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import Mock

import pytest
from redis.exceptions import LockNotOwnedError
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.model_manager import ModelInstance
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from enums import CloudPlan
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy
from services.document_indexing_proxy.document_indexing_task_proxy import DocumentIndexingTaskProxy
from services.document_indexing_proxy.duplicate_document_indexing_task_proxy import DuplicateDocumentIndexingTaskProxy
from services.entities.feature_entities import FeatureModel
from services.errors.file import FileNotExistsError
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.model_factories import make_upload_file

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


def settings(**values: object) -> dict[str, object]:
    return {
        "indexing_technique": "economy",
        "process_rule": {"mode": "automatic"},
        "data_source": {"info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file"]}}},
        **values,
    }


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
                    id="dataset", tenant_id="tenant", name="Dataset", created_by="actor", indexing_technique="economy"
                ),
                make_upload_file(file_id="file", tenant_id="tenant", name="example.txt", created_by="actor"),
                make_upload_file(file_id="foreign-file", tenant_id="foreign", name="foreign.txt"),
            ]
        )
    return SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory)


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
        else operations.create_documents(CONTEXT, REF, settings())
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


def test_duplicate_upload_reuses_document_and_dispatches_duplicate_job(
    operations: SQLAlchemyDocumentOperations, external_calls: list[tuple[str, tuple[str, ...]]]
) -> None:
    first = operations.create_documents(CONTEXT, REF, settings())
    second = operations.create_documents(CONTEXT, REF, settings())
    first_id = first["documents"][0]["id"]
    assert second["documents"][0]["id"] == first_id
    assert external_calls == [("create", (first_id,)), ("duplicate", (first_id,))]


def test_reprocess_checks_model_outside_transaction_and_preserves_segment_reset(
    operations: SQLAlchemyDocumentOperations,
    external_calls: list[tuple[str, tuple[str, ...]]],
    outside_transaction: Callable[[], None],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = operations.create_documents(CONTEXT, REF, settings())
    document_id = created["documents"][0]["id"]
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.indexing_status = IndexingStatus.COMPLETED
        document.completed_at = datetime(2026, 1, 1)
        dataset = session.get(Dataset, REF.dataset_id)
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
    result = operations.create_documents(CONTEXT, REF, settings(original_document_id=document_id, name="Renamed"))
    assert result["documents"][0]["id"] == document_id
    assert result["documents"][0]["name"] == "Renamed"
    assert result["batch"] == created["batch"]
    assert external_calls[-1] == ("update", (document_id,))
    manager.get_model_instance.assert_called_once()
    with sqlite_session_factory() as session:
        segment = session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document_id))
        assert segment is not None
        assert segment.status == SegmentStatus.RE_SEGMENT


def test_first_high_quality_upload_resolves_default_model_without_transaction(
    operations: SQLAlchemyDocumentOperations,
    external_calls: list[tuple[str, tuple[str, ...]]],
    outside_transaction: Callable[[], None],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, REF.dataset_id)
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
    operations.create_documents(CONTEXT, REF, settings(indexing_technique="high_quality"))
    with sqlite_session_factory() as session:
        dataset = session.get(Dataset, REF.dataset_id)
        assert dataset is not None
        assert dataset.embedding_model == "default-embedding"
        assert dataset.embedding_model_provider == "default-provider"
        assert dataset.collection_binding_id is not None
    assert len(external_calls) == 1


def test_foreign_upload_is_rejected_without_dispatch(
    operations: SQLAlchemyDocumentOperations, external_calls: list[tuple[str, tuple[str, ...]]]
) -> None:
    config = settings(
        data_source={"info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["foreign-file"]}}}
    )
    with pytest.raises(FileNotExistsError):
        operations.create_documents(CONTEXT, REF, config)
    assert external_calls == []


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

    first = operations.create_documents(CONTEXT, REF, notion("old-page"))
    old_id = first["documents"][0]["id"]
    operations.create_documents(CONTEXT, REF, notion("new-page"))
    assert external_calls[-2] == ("clean", (old_id,))
    assert external_calls[-1][0] == "create"
    assert old_id not in external_calls[-1][1]


def test_cloud_quota_rejection_does_not_create_documents_or_dispatch(
    operations: SQLAlchemyDocumentOperations,
    external_calls: list[tuple[str, tuple[str, ...]]],
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(BATCH_UPLOAD_LIMIT=0)
    with pytest.raises(ValueError, match="batch upload limit"):
        operations.create_documents(CONTEXT, REF, settings())
    assert external_calls == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(Document.id)) is None


def test_response_read_failure_still_dispatches_already_committed_documents(
    operations: SQLAlchemyDocumentOperations,
    external_calls: list[tuple[str, tuple[str, ...]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = Mock(side_effect=ValueError("response read failed"))
    monkeypatch.setattr("services.knowledge.documents.adapters._created_response", response)
    with pytest.raises(ValueError, match="response read failed"):
        operations.create_documents(CONTEXT, REF, settings())
    assert len(external_calls) == 1
    assert external_calls[0][0] == "create"


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
    result = operations.create_documents(CONTEXT, REF, settings())
    assert result["documents"] == []
    assert result["batch"]
    assert result["dataset"]["id"] == REF.dataset_id
    assert external_calls == []


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
        operations.create_documents(CONTEXT, REF, settings())
    outside_transaction()
