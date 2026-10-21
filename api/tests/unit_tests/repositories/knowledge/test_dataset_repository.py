import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermission,
    DatasetQuery,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
)
from models.enums import (
    CreatorUserRole,
    DatasetQuerySource,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.dataset_read_repository import stage_dataset_queries, sync_app_dataset_joins
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.summary_checkpoints import SummaryCheckpointIdentity, summary_content_fingerprint
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind


def _dataset(
    dataset_id: str,
    workspace_id: str,
    *,
    permission: str = "only_me",
    data_source_type: str = "notion_import",
) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        permission=permission,
        created_by="account-1",
        maintainer="account-1",
        data_source_type=data_source_type,
        indexing_technique="economy",
    )


def test_rbac_maintainer_lookup_requires_owning_workspace(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset", "workspace"))
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )
    assert repository.get_maintainer_id("workspace", "dataset") == "account-1"
    assert repository.get_maintainer_id("other-workspace", "dataset") is None
    assert repository.get_maintainer_id("workspace", "missing") is None


def test_estimate_record_and_access_snapshot_are_separate_and_tenant_scoped(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", permission="partial_members"))
        session.add(
            DatasetPermission(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                account_id="account-2",
            )
        )

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    estimate_record = repository.get_estimate_record(DatasetRef("workspace-1", "dataset-1"))
    snapshot = repository.get_access_snapshot(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        actor_id="account-2",
    )

    assert estimate_record is not None
    assert estimate_record.workspace_id == "workspace-1"
    assert estimate_record.indexing_technique == "economy"
    assert snapshot is not None
    assert snapshot.dataset.workspace_id == "workspace-1"
    assert snapshot.dataset.permission == "partial_members"
    assert snapshot.actor_has_partial_access is True
    assert repository.is_notion_dataset(DatasetRef("workspace-1", "dataset-1")) is True
    assert repository.is_notion_dataset(DatasetRef("workspace-2", "dataset-1")) is False
    assert repository.get_estimate_record(DatasetRef("workspace-2", "dataset-1")) is None
    assert (
        repository.get_access_snapshot(
            workspace_id="workspace-2",
            dataset_id="dataset-1",
            actor_id="account-2",
        )
        is None
    )


def test_access_snapshot_ignores_revoked_permissions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", permission="partial_members"))
        session.add_all(
            [
                DatasetPermission(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    account_id="granted-account",
                    has_permission=True,
                ),
                DatasetPermission(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    account_id="revoked-account",
                    has_permission=False,
                ),
            ]
        )

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )
    revoked_snapshot = repository.get_access_snapshot(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        actor_id="revoked-account",
    )
    assert revoked_snapshot is not None
    assert revoked_snapshot.actor_has_partial_access is False


def test_notion_dataset_query_rejects_other_source_types(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", data_source_type="upload_file"))

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    assert repository.is_notion_dataset(DatasetRef("workspace-1", "dataset-1")) is False


@pytest.mark.parametrize(
    ("indexing_technique", "expected_action"),
    [("economy", "remove"), ("high_quality", "update")],
)
def test_current_vector_repair_snapshots_tenant_scoped_dataset_state(
    sqlite_session_factory: sessionmaker[Session],
    indexing_technique: str,
    expected_action: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        session.add(dataset)

    wakes: list[Session] = []
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.enqueue_current_vector_repair(DatasetRef("workspace-1", "dataset-1")) is True
    assert repository.enqueue_current_vector_repair(DatasetRef("workspace-2", "dataset-1")) is False

    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE
            )
        )
        assert intent is not None
        assert intent.tenant_id == "workspace-1"
        assert intent.dataset_id == "dataset-1"
        assert intent.payload == {
            "tenant_id": "workspace-1",
            "dataset_id": "dataset-1",
            "action": expected_action,
            "expected_indexing_technique": indexing_technique,
            "expected_embedding_model_provider": "provider-1",
            "expected_embedding_model": "model-1",
            "regenerate_summary_vectors": expected_action == "update",
            "superseded": False,
        }
    assert len(wakes) == 1


def test_legacy_vector_delivery_keeps_completed_current_target(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        session.add_all(
            [
                dataset,
                KnowledgeTaskOutbox(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    resource_id=dataset.id,
                    task_kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE.value,
                    payload={
                        "tenant_id": dataset.tenant_id,
                        "dataset_id": dataset.id,
                        "action": "update",
                        "expected_indexing_technique": "high_quality",
                        "expected_embedding_model_provider": "provider-1",
                        "expected_embedding_model": "model-1",
                        "regenerate_summary_vectors": True,
                        "superseded": False,
                    },
                    status="completed",
                ),
            ]
        )

    wakes: list[Session] = []
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.convert_legacy_vector_index_delivery("dataset-1") is False

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert len(intents) == 1
        assert intents[0].status == "completed"
        assert intents[0].payload["action"] == "update"
        assert intents[0].payload["superseded"] is False
    assert wakes == []


def test_legacy_vector_delivery_creates_one_current_repair(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        session.add(dataset)

    wakes: list[Session] = []
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.convert_legacy_vector_index_delivery("dataset-1") is True
    assert repository.convert_legacy_vector_index_delivery("dataset-1") is False

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert len(intents) == 1
        assert intents[0].status == "pending"
        assert intents[0].payload["action"] == "update"
        assert intents[0].payload["superseded"] is False
    assert len(wakes) == 1


def test_legacy_vector_delivery_replaces_failed_current_intent(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        session.add_all(
            [
                dataset,
                KnowledgeTaskOutbox(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    resource_id=dataset.id,
                    task_kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE.value,
                    payload={
                        "tenant_id": dataset.tenant_id,
                        "dataset_id": dataset.id,
                        "action": "update",
                        "expected_indexing_technique": "high_quality",
                        "expected_embedding_model_provider": "provider-1",
                        "expected_embedding_model": "model-1",
                        "regenerate_summary_vectors": True,
                        "superseded": False,
                    },
                    status="failed",
                    last_error="provider unavailable",
                ),
            ]
        )

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    assert repository.convert_legacy_vector_index_delivery("dataset-1") is True

    with sqlite_session_factory() as session:
        intents = session.scalars(
            select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert len(intents) == 2
        assert intents[0].status == "failed"
        assert intents[0].payload["superseded"] is True
        assert intents[1].status == "pending"
        assert intents[1].payload["superseded"] is False


def _summary_target(dataset: Dataset) -> dict[str, object]:
    return {
        "tenant_id": dataset.tenant_id,
        "dataset_id": dataset.id,
        "regenerate_reason": "summary_model_changed",
        "regenerate_vectors_only": False,
        "expected_indexing_technique": "high_quality",
        "expected_embedding_model_provider": "provider-1",
        "expected_embedding_model": "model-1",
        "expected_summary_index_setting": dataset.summary_index_setting,
        "repair": True,
    }


def _summary_resource(dataset: Dataset) -> tuple[Document, DocumentSegment, DocumentSegmentSummary]:
    document = Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status=IndexingStatus.COMPLETED,
        indexing_generation="document-generation-1",
        enabled=True,
        archived=False,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by="account-1",
        status=SegmentStatus.COMPLETED,
        enabled=True,
        indexing_generation="segment-generation-1",
    )
    segment.id = "segment-1"
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="summary content",
        summary_index_node_id="summary-node-1",
        summary_index_node_hash="summary-hash-1",
        status=SummaryStatus.COMPLETED,
        enabled=True,
    )
    summary.id = "summary-1"
    return document, segment, summary


@pytest.mark.parametrize("status", ["pending", "completed"])
def test_current_summary_repair_keeps_existing_nonfailed_target(
    sqlite_session_factory: sessionmaker[Session],
    status: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True}
        session.add_all(
            [
                dataset,
                KnowledgeTaskOutbox(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    resource_id=dataset.id,
                    task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
                    payload=_summary_target(dataset),
                    status=status,
                ),
            ]
        )

    wakes: list[Session] = []
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert (
        repository.enqueue_current_summary_repair(
            "dataset-1",
            regenerate_reason="summary_model_changed",
            regenerate_vectors_only=False,
        )
        is False
    )
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(KnowledgeTaskOutbox)).all()) == 1
    assert wakes == []


def test_current_summary_repair_snapshots_current_config_and_deduplicates(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True}
        session.add(dataset)

    wakes: list[Session] = []
    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=wakes.append,
    )

    assert repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
    )
    assert not repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
    )

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert len(intents) == 1
        assert intents[0].status == "pending"
        assert intents[0].payload == _summary_target(session.get_one(Dataset, "dataset-1"))
    assert len(wakes) == 1


def test_current_summary_repair_replaces_failed_target(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True}
        session.add_all(
            [
                dataset,
                KnowledgeTaskOutbox(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    resource_id=dataset.id,
                    task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
                    payload=_summary_target(dataset),
                    status="failed",
                    last_error="provider unavailable",
                ),
            ]
        )

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    assert repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
    )
    with sqlite_session_factory() as session:
        intents = session.scalars(
            select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert [intent.status for intent in intents] == ["failed", "pending"]
        assert intents[1].payload == _summary_target(session.get_one(Dataset, "dataset-1"))


def test_current_summary_repair_can_force_successor_for_recovered_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True}
        checkpoint = SummaryCheckpointIdentity(
            document_id="document-1",
            document_generation="document-generation-1",
            segment_generation="segment-generation-1",
            indexing_technique="high_quality",
            embedding_model_provider="provider-1",
            embedding_model="model-1",
            summary_index_setting={"enable": True},
            summary_id="summary-1",
            summary_content_fingerprint=summary_content_fingerprint("summary content"),
            vector_node_id="summary-node-1",
            vector_content_hash="summary-hash-1",
        ).to_payload()
        source = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            resource_id=dataset.id,
            task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
            payload={
                **_summary_target(dataset),
                "summary_generated_segments": {"segment-1": checkpoint},
                "summary_completed_segments": {"segment-1": checkpoint},
            },
            status="executing",
        )
        document, segment, summary = _summary_resource(dataset)
        session.add_all([dataset, document, segment, summary, source])

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )

    assert repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
        force_successor=True,
        checkpoint_source_intent_id=source.id,
    )
    assert not repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
        force_successor=True,
        checkpoint_source_intent_id=source.id,
    )
    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox)).all()
        assert sorted(intent.status for intent in intents) == ["executing", "pending"]
        successor = next(intent for intent in intents if intent.id != source.id)
        assert successor.payload["recovery_source_intent_id"] == source.id
        assert successor.payload["summary_generated_segments"] == {"segment-1": checkpoint}
        assert successor.payload["summary_completed_segments"] == {"segment-1": checkpoint}


def test_recovered_summary_successor_drops_checkpoints_from_an_old_model_configuration(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True, "model": "summary-model-b"}
        stale_checkpoint = SummaryCheckpointIdentity(
            document_id="document-1",
            document_generation="document-generation-1",
            segment_generation="segment-generation-1",
            indexing_technique="high_quality",
            embedding_model_provider="provider-1",
            embedding_model="model-1",
            summary_index_setting={"enable": True, "model": "summary-model-a"},
            summary_id="summary-1",
            summary_content_fingerprint=summary_content_fingerprint("summary content"),
            vector_node_id="summary-node-1",
            vector_content_hash="summary-hash-1",
        ).to_payload()
        source = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            resource_id=dataset.id,
            task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
            payload={
                "summary_generated_segments": {"segment-1": stale_checkpoint},
                "summary_completed_segments": {"segment-1": stale_checkpoint},
            },
            status="executing",
        )
        document, segment, summary = _summary_resource(dataset)
        session.add_all([dataset, document, segment, summary, source])

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )
    assert repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
        force_successor=True,
        checkpoint_source_intent_id=source.id,
    )

    with sqlite_session_factory() as session:
        successor = session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id != source.id))
        assert successor is not None
        assert successor.payload["expected_summary_index_setting"] == {
            "enable": True,
            "model": "summary-model-b",
        }
        assert successor.payload["recovery_source_intent_id"] == source.id
        assert "summary_generated_segments" not in successor.payload
        assert "summary_completed_segments" not in successor.payload


@pytest.mark.parametrize(
    ("overwritten_content", "expected_generated"),
    [("model B summary", False), ("summary content", True)],
)
def test_recovered_summary_successor_validates_current_shared_materialization(
    sqlite_session_factory: sessionmaker[Session],
    overwritten_content: str,
    expected_generated: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider-1"
        dataset.embedding_model = "model-1"
        dataset.summary_index_setting = {"enable": True, "model": "summary-model-a"}
        checkpoint = SummaryCheckpointIdentity(
            document_id="document-1",
            document_generation="document-generation-1",
            segment_generation="segment-generation-1",
            indexing_technique="high_quality",
            embedding_model_provider="provider-1",
            embedding_model="model-1",
            summary_index_setting={"enable": True, "model": "summary-model-a"},
            summary_id="summary-1",
            summary_content_fingerprint=summary_content_fingerprint("summary content"),
            vector_node_id="summary-node-1",
            vector_content_hash="summary-hash-1",
        ).to_payload()
        source = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            resource_id=dataset.id,
            task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
            payload={
                **_summary_target(dataset),
                "summary_generated_segments": {"segment-1": checkpoint},
                "summary_completed_segments": {"segment-1": checkpoint},
            },
            status="executing",
        )
        document, segment, summary = _summary_resource(dataset)
        summary.summary_content = overwritten_content
        summary.summary_index_node_id = "summary-node-b"
        summary.summary_index_node_hash = "summary-hash-b"
        session.add_all([dataset, document, segment, summary, source])

    repository = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
    )
    assert repository.enqueue_current_summary_repair(
        "dataset-1",
        regenerate_reason="summary_model_changed",
        regenerate_vectors_only=False,
        force_successor=True,
        checkpoint_source_intent_id=source.id,
    )

    with sqlite_session_factory() as session:
        successor = session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id != source.id))
        assert successor is not None
        assert ("summary_generated_segments" in successor.payload) is expected_generated
        assert "summary_completed_segments" not in successor.payload


def test_child_write_helpers_require_a_tenant_owned_dataset(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))

    with sqlite_session_factory.begin() as session:
        assert (
            stage_dataset_queries(
                session,
                tenant_id="workspace-2",
                dataset_ids=["dataset-1", "missing"],
                content="query",
                source=DatasetQuerySource.APP,
                source_app_id="app-1",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
            )
            == 0
        )
        sync_app_dataset_joins(
            session,
            tenant_id="workspace-2",
            app_id="app-1",
            dataset_ids={"dataset-1", "missing"},
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(DatasetQuery)) is None
        assert session.scalar(select(AppDatasetJoin)) is None


def test_child_write_helpers_stage_valid_parents_in_stable_dataset_order(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-b", "workspace"), _dataset("dataset-a", "workspace")])

    with sqlite_session_factory.begin() as session:
        assert (
            stage_dataset_queries(
                session,
                tenant_id="workspace",
                dataset_ids=["dataset-b", "dataset-a", "dataset-b"],
                content="query",
                source=DatasetQuerySource.APP,
                source_app_id="app",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account",
            )
            == 2
        )
        sync_app_dataset_joins(
            session,
            tenant_id="workspace",
            app_id="app",
            dataset_ids={"dataset-b", "dataset-a"},
        )

    with sqlite_session_factory() as session:
        assert list(session.scalars(select(DatasetQuery.dataset_id).order_by(DatasetQuery.dataset_id))) == [
            "dataset-a",
            "dataset-b",
        ]
        assert list(session.scalars(select(AppDatasetJoin.dataset_id).order_by(AppDatasetJoin.dataset_id))) == [
            "dataset-a",
            "dataset-b",
        ]
