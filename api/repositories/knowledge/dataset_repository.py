"""SQLAlchemy repository for tenant-owned dataset state."""

from collections.abc import Callable, Sequence
from typing import Protocol

from sqlalchemy import and_, delete, exists, literal, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from enums.knowledge import DatasetVectorIndexStatus
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import TenantAccountJoin
from models.dataset import (
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
    RateLimitLog,
)
from models.enums import CreatorUserRole, DatasetQuerySource, DatasetRuntimeMode
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_read_repository import (
    get_dataset_doc_form,
    get_or_create_dataset_collection_binding,
    lock_dataset_row_for_child_write,
    stage_dataset_queries,
)
from repositories.knowledge.pipeline_query_repository import pipeline_dataset_query
from repositories.knowledge.summary_checkpoints import (
    CurrentSummaryMaterialization,
    inherit_summary_checkpoints,
    summary_checkpoint_segment_ids,
    summary_content_fingerprint,
)
from repositories.knowledge.task_outbox_repository import (
    enqueue_knowledge_task,
    get_current_dataset_vector_task_states,
)
from repositories.knowledge.upload_file_repository import build_document_cleanup_manifest
from repositories.resource_access_token_repository import ResourceAccessTokenCleanupRepository
from services.knowledge.dataset_access import DatasetAccessRecord, DatasetAccessSnapshot, DatasetNotFoundError
from services.knowledge.datasets.contracts import (
    DatasetCreateMutation,
    DatasetIndexAction,
    DatasetNameConflictError,
    DatasetPermissionChangeSnapshot,
    DatasetUpdateMutation,
    DatasetUpdateSnapshot,
    PreparedRagPipelineDatasetSettings,
    PreparedRagPipelineDatasetUpdate,
    RagPipelineDatasetCreateMutation,
)
from services.knowledge.documents.contracts import DocumentCreationDefaults
from services.knowledge.entities.datasets import (
    DatasetCleanupRecord,
    DatasetVectorIndexProjection,
)
from services.knowledge.entities.model_configuration import DatasetModelConfiguration
from services.knowledge.hit_testing.entities import HitTestingDatasetRecord
from services.knowledge.indexing.contracts import DatasetEstimateRecord
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.contracts import SegmentDatasetRecord, SegmentDocumentRecord, SegmentScope
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskStatus

_DATASET_DELETION_CANCELLED_TASK_KINDS = tuple(
    kind.value
    for kind in (
        KnowledgeTaskKind.DOCUMENT_INDEX_CREATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
        KnowledgeTaskKind.DOCUMENT_INDEX_UPDATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_RECOVER,
        KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
        KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
        KnowledgeTaskKind.SEGMENT_INDEX_ENABLE,
        KnowledgeTaskKind.SEGMENT_INDEX_DISABLE,
        KnowledgeTaskKind.SEGMENT_INDEX_CREATE,
        KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
    )
)


def _lock_summary_checkpoint_materializations(
    session: Session,
    *,
    dataset: Dataset,
    source_payload: dict[str, object],
) -> dict[str, CurrentSummaryMaterialization]:
    segment_ids = summary_checkpoint_segment_ids(source_payload)
    if not segment_ids:
        return {}

    documents = session.scalars(
        select(Document)
        .join(DocumentSegment, DocumentSegment.document_id == Document.id)
        .where(
            Document.tenant_id == dataset.tenant_id,
            Document.dataset_id == dataset.id,
            DocumentSegment.tenant_id == dataset.tenant_id,
            DocumentSegment.dataset_id == dataset.id,
            DocumentSegment.id.in_(segment_ids),
        )
        .order_by(Document.id)
        .with_for_update(of=Document)
    ).unique()
    document_generations = {document.id: document.indexing_generation for document in documents}
    if not document_generations:
        return {}

    segments = session.scalars(
        select(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == dataset.tenant_id,
            DocumentSegment.dataset_id == dataset.id,
            DocumentSegment.document_id.in_(document_generations),
            DocumentSegment.id.in_(segment_ids),
        )
        .order_by(DocumentSegment.document_id, DocumentSegment.id)
        .with_for_update(of=DocumentSegment)
    ).all()
    summaries = {
        summary.chunk_id: summary
        for summary in session.scalars(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.dataset_id == dataset.id,
                DocumentSegmentSummary.document_id.in_(document_generations),
                DocumentSegmentSummary.chunk_id.in_(segment_ids),
            )
            .order_by(DocumentSegmentSummary.document_id, DocumentSegmentSummary.chunk_id)
            .with_for_update(of=DocumentSegmentSummary)
        ).all()
    }
    return {
        segment.id: CurrentSummaryMaterialization(
            document_id=segment.document_id,
            document_generation=document_generations[segment.document_id],
            segment_generation=segment.indexing_generation,
            summary_id=summaries[segment.id].id,
            summary_content_fingerprint=summary_content_fingerprint(summaries[segment.id].summary_content or ""),
            vector_node_id=summaries[segment.id].summary_index_node_id,
            vector_content_hash=summaries[segment.id].summary_index_node_hash,
            summary_status=str(summaries[segment.id].status),
            summary_enabled=summaries[segment.id].enabled,
        )
        for segment in segments
        if segment.id in summaries
    }


class RagPipelineDatasetProjectionWriter(Protocol):
    """Stage workflow projections while the dataset update transaction is open."""

    def stage_dataset_settings(self, session: Session, *, dataset: Dataset, actor_id: str) -> None: ...


def _dataset_access_record(dataset: Dataset) -> DatasetAccessRecord:
    return DatasetAccessRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        maintainer_id=dataset.maintainer,
        permission=str(dataset.permission),
    )


def _dataset_estimate_record(dataset: Dataset) -> DatasetEstimateRecord:
    return DatasetEstimateRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique is not None else None,
    )


def _get_dataset(session: Session, dataset_ref: DatasetRef) -> Dataset | None:
    """Shared SQL for implementation adapters that already own a transaction."""
    return session.scalar(
        select(Dataset)
        .where(
            Dataset.id == dataset_ref.dataset_id,
            Dataset.tenant_id == dataset_ref.tenant_id,
        )
        .limit(1)
    )


def _dataset_update_snapshot(dataset: Dataset) -> DatasetUpdateSnapshot:
    return DatasetUpdateSnapshot(
        provider=str(dataset.provider),
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        updated_at=dataset.updated_at,
        name=dataset.name,
        permission=str(dataset.permission),
        collection_binding_id=dataset.collection_binding_id,
        runtime_mode=str(dataset.runtime_mode) if dataset.runtime_mode else None,
        pipeline_id=dataset.pipeline_id,
        chunk_structure=dataset.chunk_structure,
        keyword_number=dataset.keyword_number,
        retrieval_model=dict(dataset.retrieval_model) if dataset.retrieval_model else None,
        summary_index_setting=dict(dataset.summary_index_setting) if dataset.summary_index_setting else None,
        is_multimodal=dataset.is_multimodal,
    )


def _member_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def _permission_change_snapshot(
    session: Session,
    dataset_ref: DatasetRef,
    *,
    actor_id: str,
    for_update: bool = False,
) -> DatasetPermissionChangeSnapshot | None:
    dataset = _get_dataset(session, dataset_ref)
    if dataset is None:
        return None
    role_statement = select(TenantAccountJoin.role).where(
        TenantAccountJoin.tenant_id == dataset_ref.tenant_id,
        TenantAccountJoin.account_id == actor_id,
    )
    member_statement = (
        select(DatasetPermission.account_id)
        .where(
            DatasetPermission.tenant_id == dataset_ref.tenant_id,
            DatasetPermission.dataset_id == dataset_ref.dataset_id,
        )
        .order_by(DatasetPermission.account_id)
    )
    if for_update:
        role_statement = role_statement.with_for_update()
        member_statement = member_statement.with_for_update()
    role = session.scalar(role_statement)
    members = session.scalars(member_statement).all()
    return DatasetPermissionChangeSnapshot(
        actor_role=str(role) if role is not None else None,
        current_permission=str(dataset.permission),
        current_member_ids=tuple(members),
    )


def _replace_partial_members(
    session: Session,
    *,
    dataset_ref: DatasetRef,
    member_ids: Sequence[str],
) -> None:
    session.execute(
        delete(DatasetPermission).where(
            DatasetPermission.tenant_id == dataset_ref.tenant_id,
            DatasetPermission.dataset_id == dataset_ref.dataset_id,
        )
    )
    session.add_all(
        DatasetPermission(
            tenant_id=dataset_ref.tenant_id,
            dataset_id=dataset_ref.dataset_id,
            account_id=account_id,
        )
        for account_id in _member_ids(member_ids)
    )


def _stage_dataset_index_update(
    session: Session,
    *,
    dataset: Dataset,
    action: DatasetIndexAction | None,
) -> None:
    if action is None:
        return
    previous_intents = session.scalars(
        select(KnowledgeTaskOutbox)
        .where(
            KnowledgeTaskOutbox.tenant_id == dataset.tenant_id,
            KnowledgeTaskOutbox.dataset_id == dataset.id,
            KnowledgeTaskOutbox.resource_id == dataset.id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE.value,
            or_(
                KnowledgeTaskOutbox.payload["superseded"].as_boolean().is_(False),
                KnowledgeTaskOutbox.payload["superseded"].as_boolean().is_(None),
            ),
        )
        .with_for_update()
    ).all()
    for intent in previous_intents:
        payload = dict(intent.payload)
        payload["superseded"] = True
        intent.payload = payload
    enqueue_knowledge_task(
        session,
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        resource_id=dataset.id,
        payload={
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "action": action.value,
            "expected_indexing_technique": str(dataset.indexing_technique),
            "expected_embedding_model_provider": dataset.embedding_model_provider,
            "expected_embedding_model": dataset.embedding_model,
            "regenerate_summary_vectors": action is DatasetIndexAction.UPDATE,
            "superseded": False,
        },
    )


def get_dataset_vector_index_states(
    session: Session,
    *,
    tenant_id: str,
    datasets: Sequence[Dataset],
    for_update: bool = False,
) -> dict[str, DatasetVectorIndexProjection]:
    """Project durable vector state for each dataset's current model configuration."""

    owned_datasets = [dataset for dataset in datasets if dataset.tenant_id == tenant_id]
    states = get_current_dataset_vector_task_states(
        session,
        tenant_id=tenant_id,
        expected_payload_by_resource={
            dataset.id: {
                "expected_indexing_technique": str(dataset.indexing_technique),
                "expected_embedding_model_provider": dataset.embedding_model_provider,
                "expected_embedding_model": dataset.embedding_model,
            }
            for dataset in owned_datasets
        },
        for_update=for_update,
    )
    projections: dict[str, DatasetVectorIndexProjection] = {}
    for dataset in owned_datasets:
        state = states.get(dataset.id)
        if state is None:
            continue
        if state.status is KnowledgeTaskStatus.FAILED:
            projections[dataset.id] = DatasetVectorIndexProjection(DatasetVectorIndexStatus.ERROR, state.last_error)
        elif state.status is KnowledgeTaskStatus.COMPLETED:
            projections[dataset.id] = DatasetVectorIndexProjection(DatasetVectorIndexStatus.COMPLETED, None)
        else:
            projections[dataset.id] = DatasetVectorIndexProjection(DatasetVectorIndexStatus.INDEXING, None)
    return projections


def get_dataset_vector_index_state(
    session: Session,
    *,
    dataset: Dataset,
    for_update: bool = False,
) -> DatasetVectorIndexProjection | None:
    return get_dataset_vector_index_states(
        session,
        tenant_id=dataset.tenant_id,
        datasets=(dataset,),
        for_update=for_update,
    ).get(dataset.id)


def _stage_rag_pipeline_dataset_settings(
    session: Session,
    *,
    dataset_ref: DatasetRef,
    actor_id: str,
    expected: DatasetUpdateSnapshot,
    prepared: PreparedRagPipelineDatasetSettings,
    wake_after_commit: Callable[[Session], None],
) -> bool:
    """Stage prepared RAG settings and indexing intent in a caller-owned transaction."""

    dataset = session.scalar(
        select(Dataset)
        .where(Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id)
        .with_for_update()
    )
    if dataset is None or _dataset_update_snapshot(dataset) != expected:
        return False

    settings = prepared.settings
    dataset.chunk_structure = settings.chunk_structure
    dataset.indexing_technique = settings.indexing_technique
    if settings.indexing_technique == "high_quality":
        provider = prepared.resolved_embedding_model_provider
        model = prepared.resolved_embedding_model
        if not provider or not model:
            raise ValueError("Embedding model provider and model are required for high quality indexing")
        dataset.embedding_model_provider = provider
        dataset.embedding_model = model
        dataset.is_multimodal = prepared.is_multimodal
        dataset.collection_binding_id = get_or_create_dataset_collection_binding(
            session,
            provider_name=provider,
            model_name=model,
        ).id
    else:
        dataset.keyword_number = settings.keyword_number
        dataset.embedding_model_provider = None
        dataset.embedding_model = None
        dataset.collection_binding_id = None
        dataset.is_multimodal = False
    dataset.retrieval_model = dict(settings.retrieval_model)
    if settings.summary_index_setting is not None:
        dataset.summary_index_setting = dict(settings.summary_index_setting)
    dataset.updated_by = actor_id
    dataset.updated_at = naive_utc_now()
    index_action = prepared.index_action
    if index_action is None and prepared.retry_failed_vector_index:
        vector_state = get_dataset_vector_index_state(session, dataset=dataset, for_update=True)
        if vector_state is not None and vector_state.status is DatasetVectorIndexStatus.ERROR:
            index_action = (
                DatasetIndexAction.REMOVE if str(dataset.indexing_technique) == "economy" else DatasetIndexAction.UPDATE
            )
    _stage_dataset_index_update(session, dataset=dataset, action=index_action)
    if index_action is not None:
        wake_after_commit(session)
    session.flush()
    return True


def lock_dataset_for_child_write(session: Session, dataset_ref: DatasetRef) -> Dataset | None:
    """Preserve the typed DatasetRef API around the shared lifecycle query."""

    return lock_dataset_row_for_child_write(
        session,
        tenant_id=dataset_ref.tenant_id,
        dataset_id=dataset_ref.dataset_id,
    )


def _cleanup_record(session: Session, dataset: Dataset) -> DatasetCleanupRecord:
    return DatasetCleanupRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        indexing_technique=dataset.indexing_technique,
        index_struct=dataset.index_struct,
        collection_binding_id=dataset.collection_binding_id,
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        doc_form=get_dataset_doc_form(dataset, session=session),
        pipeline_id=dataset.pipeline_id,
    )


def build_dataset_cleanup_manifest(session: Session, *, tenant_id: str, dataset_id: str) -> dict[str, object]:
    """Lock documents in stable order, then snapshot cleanup inputs before deletion."""

    documents = session.scalars(
        select(Document)
        .where(Document.tenant_id == tenant_id, Document.dataset_id == dataset_id)
        .order_by(Document.id)
        .with_for_update()
    ).all()
    segments = session.scalars(
        select(DocumentSegment).where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
        )
    ).all()
    files = build_document_cleanup_manifest(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=[document.id for document in documents],
        document_file_ids=(),
    )

    return {
        "document_ids": sorted(document.id for document in documents),
        "segment_ids": sorted(segment.id for segment in segments),
        **files.to_payload(),
    }


class SQLAlchemyDatasetRepository:
    """Own SQL access to tenant-scoped dataset state."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        wake_after_commit: Callable[[Session], None],
        revoke_keys_after_commit: Callable[[Session, Sequence[str]], None],
        rag_pipeline_projection_writer: RagPipelineDatasetProjectionWriter | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._wake_after_commit = wake_after_commit
        self._revoke_keys_after_commit = revoke_keys_after_commit
        self._rag_pipeline_projection_writer = rag_pipeline_projection_writer

    def get_maintainer_id(self, workspace_id: str, resource_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset.maintainer).where(Dataset.id == resource_id, Dataset.tenant_id == workspace_id)
            )

    def get_api_enabled(self, dataset_ref: DatasetRef) -> bool | None:
        """Read admission state through the complete dataset ownership scope."""
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset.enable_api).where(
                    Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id
                )
            )

    def get_hit_testing_dataset(self, dataset_ref: DatasetRef) -> HitTestingDatasetRecord:
        """Return the retrieval configuration only for the referenced tenant-owned dataset."""

        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                raise DatasetNotFoundError()
            return HitTestingDatasetRecord(
                provider=str(dataset.provider),
                retrieval_model=dict(dataset.retrieval_model) if dataset.retrieval_model else None,
            )

    def record_hit_testing_query(self, context: RequestContext, dataset_ref: DatasetRef, content: str) -> None:
        """Persist query history only while the owning dataset still exists."""

        with self._session_factory.begin() as session:
            inserted = stage_dataset_queries(
                session,
                tenant_id=dataset_ref.tenant_id,
                dataset_ids=(dataset_ref.dataset_id,),
                content=content,
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=context.account_id,
            )
            if inserted == 0:
                raise DatasetNotFoundError()

    def record_knowledge_rate_limit(self, tenant_id: str, subscription_plan: str) -> None:
        with self._session_factory.begin() as session:
            session.add(RateLimitLog(tenant_id=tenant_id, subscription_plan=subscription_plan, operation="knowledge"))

    def get_dataset_id_by_document(self, workspace_id: str, document_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset.id)
                .join(Document, Document.dataset_id == Dataset.id)
                .where(
                    Dataset.tenant_id == workspace_id, Document.tenant_id == workspace_id, Document.id == document_id
                )
            )

    def get_document_creation_defaults(self, ref: DatasetRef) -> DocumentCreationDefaults | None:
        """Return the dataset settings inherited by newly created documents."""
        with self._session_factory() as session:
            dataset = _get_dataset(session, ref)
            if dataset is None:
                return None
            return DocumentCreationDefaults(
                provider=str(dataset.provider),
                chunk_structure=str(dataset.chunk_structure) if dataset.chunk_structure else None,
                indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
            )

    def get_dataset_id_by_pipeline(self, workspace_id: str, pipeline_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(pipeline_dataset_query(workspace_id, pipeline_id).with_only_columns(Dataset.id))

    def list_workspace_dataset_ids(self, tenant_id: str) -> list[str]:
        with self._session_factory() as session:
            return list(session.scalars(select(Dataset.id).where(Dataset.tenant_id == tenant_id)).all())

    def get_update_snapshot(self, dataset_ref: DatasetRef) -> DatasetUpdateSnapshot | None:
        """Return detached state needed to validate an update without holding a connection."""
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                return None
            return _dataset_update_snapshot(dataset)

    def enqueue_current_vector_repair(self, dataset_ref: DatasetRef) -> bool:
        """Persist a repair for the dataset's locked current vector target."""

        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, dataset_ref)
            if dataset is None:
                return False
            action = (
                DatasetIndexAction.REMOVE if str(dataset.indexing_technique) == "economy" else DatasetIndexAction.UPDATE
            )
            _stage_dataset_index_update(session, dataset=dataset, action=action)
            self._wake_after_commit(session)
            return True

    def convert_legacy_vector_index_delivery(self, dataset_id: str) -> bool:
        """Convert an unversioned vector delivery into current durable work.

        Legacy add/remove/update payloads describe a historical target and must
        never drive the vector adapter directly.  The locked dataset row is the
        authority for the target to reconcile.  A current pending or completed
        intent already represents that target; a missing or failed intent is
        replaced with one durable repair.
        """

        with self._session_factory.begin() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(Dataset.id == dataset_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if dataset is None:
                return False

            current_state = get_dataset_vector_index_state(session, dataset=dataset, for_update=True)
            if current_state is not None and current_state.status is not DatasetVectorIndexStatus.ERROR:
                return False

            action = (
                DatasetIndexAction.REMOVE if str(dataset.indexing_technique) == "economy" else DatasetIndexAction.UPDATE
            )
            _stage_dataset_index_update(session, dataset=dataset, action=action)
            self._wake_after_commit(session)
            return True

    def enqueue_current_summary_repair(
        self,
        dataset_id: str,
        *,
        regenerate_reason: str,
        regenerate_vectors_only: bool,
        force_successor: bool = False,
        checkpoint_source_intent_id: str | None = None,
    ) -> bool:
        """Persist summary regeneration for the dataset's locked current configuration."""

        with self._session_factory.begin() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(Dataset.id == dataset_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if dataset is None or str(dataset.indexing_technique) != "high_quality":
                return False
            if not regenerate_vectors_only and not (
                dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True
            ):
                return False

            payload: dict[str, object] = {
                "tenant_id": dataset.tenant_id,
                "dataset_id": dataset.id,
                "regenerate_reason": regenerate_reason,
                "regenerate_vectors_only": regenerate_vectors_only,
                "expected_indexing_technique": str(dataset.indexing_technique),
                "expected_embedding_model_provider": dataset.embedding_model_provider,
                "expected_embedding_model": dataset.embedding_model,
                "expected_summary_index_setting": (
                    dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
                ),
                "repair": True,
            }
            if checkpoint_source_intent_id is not None:
                payload["recovery_source_intent_id"] = checkpoint_source_intent_id
                checkpoint_source = session.scalar(
                    select(KnowledgeTaskOutbox)
                    .where(
                        KnowledgeTaskOutbox.id == checkpoint_source_intent_id,
                        KnowledgeTaskOutbox.tenant_id == dataset.tenant_id,
                        KnowledgeTaskOutbox.dataset_id == dataset.id,
                        KnowledgeTaskOutbox.resource_id == dataset.id,
                        KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
                    )
                    .with_for_update()
                )
                if checkpoint_source is not None:
                    current_materializations = _lock_summary_checkpoint_materializations(
                        session,
                        dataset=dataset,
                        source_payload=checkpoint_source.payload,
                    )
                    payload.update(
                        inherit_summary_checkpoints(
                            checkpoint_source.payload,
                            expected_indexing_technique=str(dataset.indexing_technique),
                            expected_embedding_model_provider=dataset.embedding_model_provider,
                            expected_embedding_model=dataset.embedding_model,
                            expected_summary_index_setting=dataset.summary_index_setting,
                            document_generation_replacements={},
                            current_materializations=current_materializations,
                        )
                    )
            current_intents = session.scalars(
                select(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.tenant_id == dataset.tenant_id,
                    KnowledgeTaskOutbox.dataset_id == dataset.id,
                    KnowledgeTaskOutbox.resource_id == dataset.id,
                    KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
                )
                .with_for_update()
            ).all()
            target_intents = [
                intent
                for intent in current_intents
                if all(intent.payload.get(key) == value for key, value in payload.items() if key != "repair")
            ]
            if checkpoint_source_intent_id is not None and any(
                intent.payload.get("recovery_source_intent_id") == checkpoint_source_intent_id
                for intent in current_intents
            ):
                return False
            if not force_successor and any(
                intent.status != KnowledgeTaskStatus.FAILED.value for intent in target_intents
            ):
                return False

            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                resource_id=dataset.id,
                payload=payload,
            )
            self._wake_after_commit(session)
            return True

    def list_names(self, tenant_id: str) -> tuple[str, ...]:
        with self._session_factory() as session:
            return tuple(session.scalars(select(Dataset.name).where(Dataset.tenant_id == tenant_id)).all())

    def external_api_exists(self, tenant_id: str, api_id: str) -> bool:
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(literal(True)).where(
                        exists().where(
                            ExternalKnowledgeApis.id == api_id,
                            ExternalKnowledgeApis.tenant_id == tenant_id,
                        )
                    )
                )
            )

    def get_permission_change_snapshot(
        self,
        dataset_ref: DatasetRef,
        *,
        actor_id: str,
    ) -> DatasetPermissionChangeSnapshot | None:
        with self._session_factory() as session:
            return _permission_change_snapshot(session, dataset_ref, actor_id=actor_id)

    def create_dataset(self, mutation: DatasetCreateMutation) -> str:
        with self._session_factory.begin() as session:
            duplicate = session.scalar(
                select(Dataset.id).where(
                    Dataset.tenant_id == mutation.tenant_id,
                    Dataset.name == mutation.name,
                )
            )
            if duplicate is not None:
                raise DatasetNameConflictError(f"Dataset with name {mutation.name} already exists.")

            if mutation.provider == "external":
                if not mutation.external_knowledge_api_id:
                    raise ValueError("external_knowledge_api_id is required")
                if not mutation.external_knowledge_id:
                    raise ValueError("external_knowledge_id is required")
                api_exists = session.scalar(
                    select(literal(True)).where(
                        exists().where(
                            ExternalKnowledgeApis.id == mutation.external_knowledge_api_id,
                            ExternalKnowledgeApis.tenant_id == mutation.tenant_id,
                        )
                    )
                )
                if not api_exists:
                    raise ValueError("External API template not found.")

            dataset = Dataset(
                tenant_id=mutation.tenant_id,
                name=mutation.name,
                description=mutation.description,
                provider=mutation.provider,
                permission=DatasetPermissionEnum(mutation.permission),
                indexing_technique=mutation.indexing_technique,
                created_by=mutation.actor_id,
                maintainer=mutation.actor_id,
                updated_by=mutation.actor_id,
                embedding_model_provider=mutation.embedding_model_provider,
                embedding_model=mutation.embedding_model,
                retrieval_model=dict(mutation.retrieval_model) if mutation.retrieval_model else None,
                summary_index_setting=(
                    dict(mutation.summary_index_setting) if mutation.summary_index_setting is not None else None
                ),
                is_multimodal=mutation.is_multimodal,
            )
            session.add(dataset)
            session.flush()
            if mutation.provider == "external":
                assert mutation.external_knowledge_api_id is not None
                assert mutation.external_knowledge_id is not None
                session.add(
                    ExternalKnowledgeBindings(
                        tenant_id=mutation.tenant_id,
                        dataset_id=dataset.id,
                        external_knowledge_api_id=mutation.external_knowledge_api_id,
                        external_knowledge_id=mutation.external_knowledge_id,
                        created_by=mutation.actor_id,
                    )
                )
            return dataset.id

    def create_rag_pipeline_dataset(self, mutation: RagPipelineDatasetCreateMutation) -> str:
        if not mutation.name:
            raise ValueError("Dataset name is required")
        with self._session_factory.begin() as session:
            if session.scalar(
                select(Dataset.id).where(
                    Dataset.tenant_id == mutation.tenant_id,
                    Dataset.name == mutation.name,
                )
            ):
                raise DatasetNameConflictError(f"Dataset with name {mutation.name} already exists.")
            pipeline = Pipeline(
                tenant_id=mutation.tenant_id,
                name=mutation.name,
                description=mutation.description,
                created_by=mutation.actor_id,
            )
            session.add(pipeline)
            session.flush()
            dataset = Dataset(
                tenant_id=mutation.tenant_id,
                name=mutation.name,
                description=mutation.description,
                permission=DatasetPermissionEnum(mutation.permission),
                provider="vendor",
                runtime_mode=DatasetRuntimeMode.RAG_PIPELINE,
                icon_info=dict(mutation.icon_info),
                created_by=mutation.actor_id,
                maintainer=mutation.actor_id,
                updated_by=mutation.actor_id,
                pipeline_id=pipeline.id,
            )
            session.add(dataset)
            session.flush()
            if mutation.partial_member_ids is not None:
                _replace_partial_members(
                    session,
                    dataset_ref=DatasetRef(mutation.tenant_id, dataset.id),
                    member_ids=mutation.partial_member_ids,
                )
            return dataset.id

    def update_dataset(self, mutation: DatasetUpdateMutation) -> bool:
        dataset_ref = DatasetRef(mutation.ref_tenant_id, mutation.ref_dataset_id)
        with self._session_factory.begin() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(
                    Dataset.tenant_id == dataset_ref.tenant_id,
                    Dataset.id == dataset_ref.dataset_id,
                )
                .with_for_update()
            )
            if dataset is None:
                return False
            if _dataset_update_snapshot(dataset) != mutation.expected:
                return False
            if (
                _permission_change_snapshot(session, dataset_ref, actor_id=mutation.actor_id, for_update=True)
                != mutation.permission_expected
            ):
                return False

            values = mutation.values
            name = values.get("name")
            if isinstance(name, str) and name and name != dataset.name:
                duplicate = session.scalar(
                    select(Dataset.id).where(
                        Dataset.tenant_id == dataset.tenant_id,
                        Dataset.id != dataset.id,
                        Dataset.name == name,
                    )
                )
                if duplicate is not None:
                    raise DatasetNameConflictError("Dataset name already exists")

            if dataset.provider == "external":
                external_knowledge_id = values.get("external_knowledge_id")
                external_api_id = values.get("external_knowledge_api_id")
                if not isinstance(external_knowledge_id, str) or not external_knowledge_id:
                    raise ValueError("External knowledge id is required.")
                if not isinstance(external_api_id, str) or not external_api_id:
                    raise ValueError("External knowledge api id is required.")
                api_exists = session.scalar(
                    select(literal(True)).where(
                        exists().where(
                            ExternalKnowledgeApis.id == external_api_id,
                            ExternalKnowledgeApis.tenant_id == dataset.tenant_id,
                        )
                    )
                )
                if not api_exists:
                    raise ValueError("External API template not found.")
                binding = session.scalar(
                    select(ExternalKnowledgeBindings)
                    .where(
                        ExternalKnowledgeBindings.tenant_id == dataset.tenant_id,
                        ExternalKnowledgeBindings.dataset_id == dataset.id,
                    )
                    .with_for_update()
                )
                if binding is None:
                    raise ValueError("External knowledge binding not found.")
                binding.external_knowledge_id = external_knowledge_id
                binding.external_knowledge_api_id = external_api_id
                binding.updated_by = mutation.actor_id
                retrieval = values.get("external_retrieval_model")
                if retrieval:
                    dataset.retrieval_model = dict(retrieval)
            else:
                for key in (
                    "indexing_technique",
                    "embedding_model_provider",
                    "embedding_model",
                    "keyword_number",
                    "retrieval_model",
                    "summary_index_setting",
                    "icon_info",
                    "is_multimodal",
                ):
                    if key not in values:
                        continue
                    value = values[key]
                    if key in {"retrieval_model", "summary_index_setting", "icon_info"} and value is not None:
                        value = dict(value)
                    setattr(dataset, key, value)
                if "collection_binding_id" in values:
                    dataset.collection_binding_id = values["collection_binding_id"]
                elif (
                    dataset.indexing_technique == "high_quality"
                    and dataset.embedding_model_provider
                    and dataset.embedding_model
                    and (
                        "embedding_model_provider" in values
                        or "embedding_model" in values
                        or dataset.collection_binding_id is None
                    )
                ):
                    dataset.collection_binding_id = get_or_create_dataset_collection_binding(
                        session,
                        provider_name=dataset.embedding_model_provider,
                        model_name=dataset.embedding_model,
                    ).id

            for key in ("name", "description", "permission"):
                if key not in values:
                    continue
                value = values[key]
                if value is None and key != "description":
                    continue
                setattr(dataset, key, DatasetPermissionEnum(value) if key == "permission" else value)
            summary_setting = values.get("summary_index_setting")
            if dataset.provider == "external" and summary_setting is not None:
                dataset.summary_index_setting = dict(summary_setting)
            dataset.updated_by = mutation.actor_id
            dataset.updated_at = naive_utc_now()

            if mutation.partial_member_ids is not None:
                _replace_partial_members(
                    session,
                    dataset_ref=dataset_ref,
                    member_ids=mutation.partial_member_ids,
                )
            elif mutation.clear_partial_members:
                _replace_partial_members(session, dataset_ref=dataset_ref, member_ids=())

            index_action = mutation.index_action
            if index_action is None and mutation.retry_failed_vector_index:
                vector_state = get_dataset_vector_index_state(session, dataset=dataset, for_update=True)
                if vector_state is not None and vector_state.status is DatasetVectorIndexStatus.ERROR:
                    index_action = (
                        DatasetIndexAction.REMOVE
                        if str(dataset.indexing_technique) == "economy"
                        else DatasetIndexAction.UPDATE
                    )
            _stage_dataset_index_update(session, dataset=dataset, action=index_action)
            if dataset.runtime_mode == DatasetRuntimeMode.RAG_PIPELINE and dataset.pipeline_id:
                if self._rag_pipeline_projection_writer is None:
                    raise RuntimeError("RAG pipeline dataset projection writer is not configured")
                self._rag_pipeline_projection_writer.stage_dataset_settings(
                    session,
                    dataset=dataset,
                    actor_id=mutation.actor_id,
                )
            if index_action is not None:
                self._wake_after_commit(session)
            session.flush()
            return True

    def set_api_enabled(self, dataset_ref: DatasetRef, *, actor_id: str, enabled: bool) -> bool:
        with self._session_factory.begin() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(
                    Dataset.tenant_id == dataset_ref.tenant_id,
                    Dataset.id == dataset_ref.dataset_id,
                )
                .with_for_update()
            )
            if dataset is None:
                return False
            dataset.enable_api = enabled
            dataset.updated_by = actor_id
            dataset.updated_at = naive_utc_now()
            return True

    def stage_rag_pipeline_dataset_settings(
        self,
        session: Session,
        *,
        change: PreparedRagPipelineDatasetUpdate,
    ) -> bool:
        return _stage_rag_pipeline_dataset_settings(
            session,
            dataset_ref=DatasetRef(change.tenant_id, change.dataset_id),
            actor_id=change.actor_id,
            expected=change.expected,
            prepared=change.prepared,
            wake_after_commit=self._wake_after_commit,
        )

    def get_model_configuration(self, dataset_ref: DatasetRef) -> DatasetModelConfiguration | None:
        """Return the detached model settings needed by document use cases."""
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                return None
            return DatasetModelConfiguration(
                tenant_id=dataset.tenant_id,
                indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
                embedding_model_provider=dataset.embedding_model_provider,
                embedding_model=dataset.embedding_model,
            )

    def delete_with_relations(self, dataset_ref: DatasetRef) -> bool:
        """Atomically delete a dataset, its grants, and its durable cleanup intent."""

        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, dataset_ref)
            if dataset is None:
                return False

            cleanup = _cleanup_record(session, dataset)
            manifest = build_dataset_cleanup_manifest(
                session,
                tenant_id=cleanup.workspace_id,
                dataset_id=cleanup.id,
            )
            session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.tenant_id == cleanup.workspace_id,
                    KnowledgeTaskOutbox.dataset_id == cleanup.id,
                    KnowledgeTaskOutbox.task_kind.in_(_DATASET_DELETION_CANCELLED_TASK_KINDS),
                    KnowledgeTaskOutbox.status != "completed",
                )
                .values(
                    status="completed",
                    claim_id=None,
                    claimed_at=None,
                    dispatched_at=None,
                    last_error="cancelled because the dataset was deleted",
                )
            )
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DATASET_CLEANUP,
                tenant_id=cleanup.workspace_id,
                dataset_id=cleanup.id,
                resource_id=cleanup.id,
                payload={
                    "dataset_id": cleanup.id,
                    "tenant_id": cleanup.workspace_id,
                    "indexing_technique": cleanup.indexing_technique,
                    "index_struct": cleanup.index_struct,
                    "collection_binding_id": cleanup.collection_binding_id,
                    "embedding_model_provider": cleanup.embedding_model_provider,
                    "embedding_model": cleanup.embedding_model,
                    "doc_form": cleanup.doc_form,
                    "pipeline_id": cleanup.pipeline_id,
                    "manifest": manifest,
                },
            )
            self._wake_after_commit(session)

            revoked_tokens = dataset_api_key_bindings.delete_keys_scoped_only_to(
                session, cleanup.id, tenant_id=dataset_ref.tenant_id
            )
            self._revoke_keys_after_commit(session, revoked_tokens)
            ResourceAccessTokenCleanupRepository(session=session).delete_resource_relations(
                tenant_id=cleanup.workspace_id,
                resource_type=ResourceAccessTokenResourceType.KNOWLEDGE,
                resource_id=cleanup.id,
            )
            session.execute(
                delete(DatasetPermission).where(
                    DatasetPermission.tenant_id == dataset_ref.tenant_id,
                    DatasetPermission.dataset_id == dataset_ref.dataset_id,
                )
            )
            session.delete(dataset)
            return True

    def get_estimate_record(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            return _dataset_estimate_record(dataset) if dataset is not None else None

    def is_notion_dataset(self, dataset_ref: DatasetRef) -> bool:
        """Return whether the owned dataset is configured for Notion imports."""
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(
                        exists().where(
                            Dataset.id == dataset_ref.dataset_id,
                            Dataset.tenant_id == dataset_ref.tenant_id,
                            Dataset.data_source_type == "notion_import",
                        )
                    )
                )
            )

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, DatasetRef(workspace_id, dataset_id))
            if dataset is None:
                return None

            actor_has_partial_access = bool(
                session.scalar(
                    select(
                        exists().where(
                            DatasetPermission.tenant_id == workspace_id,
                            DatasetPermission.dataset_id == dataset_id,
                            DatasetPermission.account_id == actor_id,
                            DatasetPermission.has_permission.is_(True),
                        )
                    )
                )
            )
            return DatasetAccessSnapshot(
                dataset=_dataset_access_record(dataset),
                actor_has_partial_access=actor_has_partial_access,
            )

    def get_segment_scope(
        self,
        *,
        dataset_ref: DatasetRef,
        document_id: str,
        actor_id: str | None,
    ) -> SegmentScope:
        """Read ownership, model configuration and the actor grant in one snapshot."""
        grant = (
            exists().where(
                DatasetPermission.tenant_id == dataset_ref.tenant_id,
                DatasetPermission.dataset_id == dataset_ref.dataset_id,
                DatasetPermission.account_id == actor_id,
                DatasetPermission.has_permission.is_(True),
            )
            if actor_id is not None
            else literal(False)
        )
        with self._session_factory() as session:
            row = session.execute(
                select(Dataset, Document, grant)
                .outerjoin(
                    Document,
                    and_(
                        Document.id == document_id,
                        Document.dataset_id == Dataset.id,
                        Document.tenant_id == Dataset.tenant_id,
                    ),
                )
                .where(Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id)
            ).one_or_none()
            if row is None:
                return SegmentScope(None, None)
            dataset, document, actor_has_access = row
            return SegmentScope(
                dataset=SegmentDatasetRecord(
                    id=dataset.id,
                    workspace_id=dataset.tenant_id,
                    indexing_technique=str(dataset.indexing_technique),
                    embedding_model_provider=dataset.embedding_model_provider,
                    embedding_model=dataset.embedding_model,
                ),
                document=SegmentDocumentRecord(
                    id=document.id,
                    dataset_id=document.dataset_id,
                    workspace_id=document.tenant_id,
                    doc_form=str(document.doc_form),
                )
                if document is not None
                else None,
                access_snapshot=DatasetAccessSnapshot(
                    dataset=_dataset_access_record(dataset),
                    actor_has_partial_access=bool(actor_has_access),
                )
                if actor_id is not None
                else None,
            )
