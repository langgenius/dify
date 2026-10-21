"""Exercise document creation with real SQL and assertions at external boundaries."""

from collections.abc import Callable, Generator, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict, cast
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.model_manager import ModelInstance
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from enums import CloudPlan
from graphon.model_runtime.entities.model_entities import ModelFeature
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference, UploadFile
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.enterprise import rbac_service
from services.entities.feature_entities import FeatureModel
from services.errors.file import FileNotExistsError
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetNotFoundError,
)
from services.knowledge.datasets.model_configuration import KnowledgeModelConfigurationGateway
from services.knowledge.documents.adapters import DocumentModelConfigurationAdapter, SQLAlchemyDocumentOperations
from services.knowledge.documents.application import (
    DatasetDocumentApplicationService,
    DocumentLifecycleCache,
    DocumentSourceConflictError,
    DocumentUploads,
)
from services.knowledge.documents.contracts import (
    DocumentCreationDataset,
    DocumentCreationEnvironment,
    DocumentCreationGateway,
)
from services.knowledge.documents.creation import prepare_document_creation
from services.knowledge.documents.creation_adapters import ConfiguredDocumentCreationGateway
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLock,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tests.unit_tests.model_factories import make_upload_file

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


class CreatedDocument(TypedDict):
    id: str
    name: str
    data_source_info_dict: dict[str, object]
    indexing_status: str
    created_from: str


class CreatedDataset(TypedDict):
    id: str


class CreationResult(TypedDict):
    documents: list[CreatedDocument]
    batch: str
    dataset: CreatedDataset


def settings(**values: object) -> dict[str, object]:
    return {
        "indexing_technique": "economy",
        "process_rule": {"mode": "automatic"},
        "data_source": {"info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file"]}}},
        **values,
    }


class CreationDatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        return AccessibleDataset(dataset_id, context.active_workspace_id)


class UnusedUploads:
    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
        del context, name, text
        raise AssertionError("source upload is not part of these persistence tests")

    def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        del context, filename, content, mimetype
        raise AssertionError("source upload is not part of these persistence tests")


class CreationLease:
    token = "creation-token"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class CreationLock:
    def __init__(self, outside_transaction: Callable[[], None]) -> None:
        self._outside_transaction = outside_transaction
        self.lose_before_entry = False
        self.lose_after_commit = False

    def try_acquire(self, name: str, *, timeout: int) -> KnowledgeIndexingLease | None:
        del name, timeout
        raise AssertionError("retry acquisition is not part of document creation")

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[KnowledgeIndexingLease]:
        assert name.startswith("add_document_lock_dataset_id_")
        assert timeout == 600
        assert expected_token is None
        assert blocking_timeout == 600
        self._outside_transaction()
        if self.lose_before_entry:
            raise KnowledgeIndexingLeaseLostError("lock lost")
        yield CreationLease()
        self._outside_transaction()
        if self.lose_after_commit:
            raise KnowledgeIndexingLeaseLostError("lock lost")


class UnusedLifecycleCache:
    def is_indexing(self, document_id: str) -> bool:
        del document_id
        return False

    def mark_indexing(self, document_ids: list[str]) -> None:
        del document_ids

    def mark_paused(self, document_id: str) -> None:
        del document_id

    def clear_paused(self, document_id: str) -> None:
        del document_id

    def try_mark_syncing(self, document_id: str, *, token: str) -> bool:
        del document_id, token
        return True

    def clear_syncing(self, document_id: str, *, token: str) -> None:
        del document_id, token


class CreatorAccess:
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None:
        from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations

        SQLAlchemyDatasetOperations.initialize_creator_access(context, dataset_id)


@pytest.fixture
def creation_lock(outside_transaction: Callable[[], None]) -> CreationLock:
    return CreationLock(outside_transaction)


@pytest.fixture
def operations(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    creation_lock: CreationLock,
) -> DatasetDocumentApplicationService:
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
    models = DocumentModelConfigurationAdapter(models=KnowledgeModelConfigurationGateway())
    datasets = SQLAlchemyDatasetRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=lambda _session, _tokens: None,
    )
    documents = SQLAlchemyDocumentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    return DatasetDocumentApplicationService(
        dataset_access=cast(DatasetAccess, CreationDatasetAccess()),
        datasets=datasets,
        documents=documents,
        operations=SQLAlchemyDocumentOperations(
            session_factory=sqlite_session_factory,
            documents=documents,
            uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        ),
        uploads=cast(DocumentUploads, UnusedUploads()),
        indexing_locks=cast(KnowledgeIndexingLock, creation_lock),
        lifecycle_cache=cast(DocumentLifecycleCache, UnusedLifecycleCache()),
        model_configuration=models,
        creation=ConfiguredDocumentCreationGateway(models=models),
        creator_access=CreatorAccess(),
    )


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
def outbox_wakes(
    monkeypatch: pytest.MonkeyPatch,
    outside_transaction: Callable[[], None],
) -> list[str]:
    wakes: list[str] = []

    def features(_tenant_id: str, *, exclude_vector_space: bool) -> FeatureModel:
        outside_transaction()
        assert exclude_vector_space is True
        result = FeatureModel()
        result.billing.subscription.plan = CloudPlan.PROFESSIONAL
        return result

    monkeypatch.setattr("services.knowledge.documents.creation_adapters.FeatureService.get_features", features)
    monkeypatch.setattr(
        "services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher",
        lambda: wakes.append("wake") or True,
    )
    return wakes


def create_documents(
    service: DatasetDocumentApplicationService,
    values: Mapping[str, object],
) -> CreationResult:
    return cast(CreationResult, service.create_documents(CONTEXT, dataset_id=REF.dataset_id, settings=values))


def initialize_dataset(
    service: DatasetDocumentApplicationService,
    values: Mapping[str, object],
) -> CreationResult:
    return cast(CreationResult, service.initialize_dataset(CONTEXT, settings=values))


@pytest.mark.parametrize("initialize", [False, True])
def test_upload_preserves_response_and_commits_with_index_intent(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
    initialize: bool,
) -> None:
    result = initialize_dataset(operations, settings()) if initialize else create_documents(operations, settings())
    (document,) = result["documents"]
    assert document["name"] == "example.txt"
    assert document["data_source_info_dict"] == {"upload_file_id": "file"}
    assert document["indexing_status"] == "waiting"
    assert document["created_from"] == "web"
    assert result["batch"]
    assert outbox_wakes == ["wake"]
    with sqlite_session_factory() as session:
        dataset = session.get(Dataset, result["dataset"]["id"])
        assert dataset is not None
        assert dataset.tenant_id == "tenant"
        assert dataset.name == ("example.txt..." if initialize else "Dataset")
        assert dataset.permission == "only_me"
        reference = session.scalar(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.document_id == document["id"],
                KnowledgeUploadFileReference.kind == "document_source",
            )
        )
        assert reference is not None
        assert reference.upload_file_id == "file"
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert intent is not None
        assert intent.task_kind == "document_index_create"
        assert intent.payload["document_ids"] == [document["id"]]
        persisted_document = session.get(Document, document["id"])
        assert persisted_document is not None
        assert intent.payload["generations"] == {document["id"]: persisted_document.indexing_generation}


def test_duplicate_upload_reuses_document_and_persists_duplicate_intent(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first = create_documents(operations, settings())
    second = create_documents(operations, settings())
    first_id = first["documents"][0]["id"]
    assert second["documents"][0]["id"] == first_id
    assert outbox_wakes == ["wake", "wake"]
    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
        assert [intent.task_kind for intent in intents] == ["document_index_create", "document_index_duplicate"]
        assert intents[-1].payload["document_ids"] == [first_id]


def test_reprocess_checks_model_outside_transaction_and_preserves_segment_reset(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    outside_transaction: Callable[[], None],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = create_documents(operations, settings())
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
    monkeypatch.setattr(
        "services.knowledge.datasets.model_configuration.ModelManager.for_tenant", lambda **_kwargs: manager
    )
    result = create_documents(operations, settings(original_document_id=document_id, name="Renamed"))
    assert result["documents"][0]["id"] == document_id
    assert result["documents"][0]["name"] == "Renamed"
    assert result["batch"] == created["batch"]
    assert outbox_wakes == ["wake", "wake"]
    manager.get_model_instance.assert_called_once()
    with sqlite_session_factory() as session:
        segment = session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document_id))
        assert segment is not None
        assert segment.status == SegmentStatus.RE_SEGMENT
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_update")
        )
        assert intent is not None
        assert intent.document_id == document_id


def test_first_high_quality_upload_resolves_default_model_without_transaction(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
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

        @dataclass(frozen=True)
        class Schema:
            features: list[ModelFeature]

        class Model:
            model_name = "default-embedding"
            provider = "default-provider"

            @staticmethod
            def get_model_schema() -> Schema:
                return Schema(features=[])

        return cast(ModelInstance, Model())

    manager = Mock()
    manager.get_default_model_instance.side_effect = model
    monkeypatch.setattr(
        "services.knowledge.datasets.model_configuration.ModelManager.for_tenant", lambda **_kwargs: manager
    )
    create_documents(operations, settings(indexing_technique="high_quality"))
    with sqlite_session_factory() as session:
        dataset = session.get(Dataset, REF.dataset_id)
        assert dataset is not None
        assert dataset.embedding_model == "default-embedding"
        assert dataset.embedding_model_provider == "default-provider"
        assert dataset.collection_binding_id is not None
    assert outbox_wakes == ["wake"]


def test_foreign_upload_is_rejected_without_dispatch(
    operations: DatasetDocumentApplicationService, outbox_wakes: list[str]
) -> None:
    config = settings(
        data_source={"info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["foreign-file"]}}}
    )
    with pytest.raises(FileNotExistsError):
        create_documents(operations, config)
    assert outbox_wakes == []


def test_upload_pending_cleanup_is_a_document_conflict(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        upload = session.get(UploadFile, "file")
        assert upload is not None
        upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)

    with pytest.raises(DocumentSourceConflictError):
        create_documents(operations, settings())

    assert outbox_wakes == []


def test_source_replacement_pending_cleanup_preserves_document_and_returns_conflict(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created = create_documents(operations, settings())
    document_id = created["documents"][0]["id"]
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.indexing_status = IndexingStatus.COMPLETED
        replacement = make_upload_file(file_id="replacement-file", tenant_id="tenant", name="replacement.txt")
        replacement.knowledge_cleanup_started_at = datetime(2026, 1, 1)
        session.add(replacement)

    with pytest.raises(DocumentSourceConflictError):
        create_documents(
            operations,
            settings(
                original_document_id=document_id,
                data_source={
                    "info_list": {
                        "data_source_type": "upload_file",
                        "file_info_list": {"file_ids": ["replacement-file"]},
                    }
                },
            ),
        )

    assert outbox_wakes == ["wake"]
    with sqlite_session_factory() as session:
        document = session.get(Document, document_id)
        assert document is not None
        assert document.data_source_info_dict == {"upload_file_id": "file"}
        assert [intent.task_kind for intent in session.scalars(select(KnowledgeTaskOutbox)).all()] == [
            "document_index_create"
        ]


def test_notion_removal_and_new_indexing_commit_as_durable_intents(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
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

    first = create_documents(operations, notion("old-page"))
    old_id = first["documents"][0]["id"]
    second = create_documents(operations, notion("new-page"))
    new_id = second["documents"][0]["id"]
    assert outbox_wakes == ["wake", "wake"]
    with sqlite_session_factory() as session:
        assert session.get(Document, old_id) is None
        cleanup = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_batch_cleanup")
        )
        assert cleanup is not None
        assert cleanup.payload["document_ids"] == [old_id]
        create_intents = session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_create")
        ).all()
        assert create_intents[-1].payload["document_ids"] == [new_id]


def test_source_replacement_persists_old_file_cleanup_with_document_update(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id="replacement-file", tenant_id="tenant", name="replacement.txt"))
    created = create_documents(operations, settings())
    document_id = created["documents"][0]["id"]
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.indexing_status = IndexingStatus.COMPLETED
        document.completed_at = datetime(2026, 1, 1)

    create_documents(
        operations,
        settings(
            original_document_id=document_id,
            name="replacement.txt",
            data_source={
                "info_list": {
                    "data_source_type": "upload_file",
                    "file_info_list": {"file_ids": ["replacement-file"]},
                }
            },
        ),
    )

    assert outbox_wakes == ["wake", "wake"]
    with sqlite_session_factory() as session:
        references = session.scalars(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.document_id == document_id,
                KnowledgeUploadFileReference.kind == "document_source",
            )
        ).all()
        assert [reference.upload_file_id for reference in references] == ["replacement-file"]
        cleanup = session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup"))
        assert cleanup is not None
        assert cleanup.payload == {"file_ids": ["file"]}
        update_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_update")
        )
        assert update_intent is not None
        assert update_intent.document_id == document_id


def test_cloud_quota_rejection_does_not_create_documents_or_dispatch(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(BATCH_UPLOAD_LIMIT=0)
    with pytest.raises(ValueError, match="batch upload limit"):
        create_documents(operations, settings())
    assert outbox_wakes == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(Document.id)) is None


def test_response_read_failure_rolls_back_documents_without_dispatch(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = Mock(side_effect=ValueError("response read failed"))
    monkeypatch.setattr("repositories.knowledge.document_repository._created_response", response)
    with pytest.raises(ValueError, match="response read failed"):
        create_documents(operations, settings())
    assert outbox_wakes == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(Document.id)) is None


def test_document_creation_rechecks_dataset_after_preparation(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def delete_dataset_after_prepare(
        dataset: DocumentCreationDataset,
        config: KnowledgeConfig,
        environment: DocumentCreationEnvironment,
        gateway: DocumentCreationGateway,
    ) -> KnowledgeConfig:
        resolved = prepare_document_creation(dataset, config, environment, gateway)
        with sqlite_session_factory.begin() as session:
            stored = session.get(Dataset, REF.dataset_id)
            assert stored is not None
            session.delete(stored)
        return resolved

    monkeypatch.setattr(
        "services.knowledge.documents.application.prepare_document_creation",
        delete_dataset_after_prepare,
    )

    with pytest.raises(DatasetNotFoundError):
        create_documents(operations, settings())

    assert outbox_wakes == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(Document.id)) is None


def test_lost_creation_lock_after_commit_returns_persisted_response(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    creation_lock: CreationLock,
) -> None:
    creation_lock.lose_after_commit = True
    result = create_documents(operations, settings())
    assert len(result["documents"]) == 1
    assert result["batch"]
    assert result["dataset"]["id"] == REF.dataset_id
    assert outbox_wakes == ["wake"]


def test_lost_creation_lock_before_persistence_is_not_reported_as_success(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    creation_lock: CreationLock,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    creation_lock.lose_before_entry = True
    with pytest.raises(KnowledgeIndexingLeaseLostError):
        create_documents(operations, settings())
    assert outbox_wakes == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(Document.id)) is None


def test_resource_scope_cannot_initialize_dataset(
    operations: DatasetDocumentApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    resource_context = CONTEXT._replace(resource_dataset_ids=frozenset({REF.dataset_id}))

    with pytest.raises(DatasetAccessDeniedError):
        operations.initialize_dataset(resource_context, settings=settings())

    with sqlite_session_factory() as session:
        assert session.scalars(select(Dataset.id)).all() == [REF.dataset_id]
        assert session.scalar(select(Document.id)) is None


def test_billing_http_boundary_does_not_hold_a_transaction(
    operations: DatasetDocumentApplicationService,
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
        create_documents(operations, settings())
    outside_transaction()


def test_initialize_dataset_compensates_rows_and_cancels_indexing_when_rbac_fails(
    operations: DatasetDocumentApplicationService,
    outbox_wakes: list[str],
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(RBAC_ENABLED=True)

    def fail_rbac(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("RBAC unavailable")

    monkeypatch.setattr(rbac_service.RBACService.DatasetAccess, "replace_whitelist", fail_rbac)

    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        initialize_dataset(operations, settings())

    assert outbox_wakes == ["wake"]
    with sqlite_session_factory() as session:
        assert session.scalars(select(Dataset).where(Dataset.id != REF.dataset_id)).all() == []
        orphaned_document = session.scalar(select(Document))
        assert orphaned_document is not None
        assert orphaned_document.dataset_id != REF.dataset_id
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
        assert [intent.task_kind for intent in intents] == ["document_index_create", "dataset_cleanup"]
        assert intents[0].status == "completed"
        assert intents[0].last_error == "cancelled because the dataset was deleted"
        assert intents[1].status == "pending"
        manifest = intents[1].payload["manifest"]
        assert isinstance(manifest, Mapping)
        assert manifest["document_ids"] == [orphaned_document.id]
