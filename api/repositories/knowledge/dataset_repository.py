"""SQLAlchemy repository for tenant-owned dataset state."""

from collections.abc import Callable, Sequence
from typing import Protocol

from sqlalchemy import and_, delete, exists, literal, select
from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from enums.creator import CreatorUserRole
from libs.datetime_utils import naive_utc_now
from models.account import TenantAccountJoin
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    Document,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
    RateLimitLog,
)
from models.enums import DatasetQuerySource, DatasetRuntimeMode
from repositories.file.upload_file_repository import lock_and_validate_owned_upload_files_in_session
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_read_repository import (
    get_dataset_doc_form,
    get_or_create_dataset_collection_binding,
    lock_dataset_row_for_child_write,
    stage_dataset_queries,
)
from repositories.knowledge.pipeline_query_repository import pipeline_dataset_query
from repositories.resource_access_token_repository import ResourceAccessTokenCleanupRepository
from services.file_reference_parser import added_trusted_upload_file_ids, trusted_upload_file_ids
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
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.model_configuration import DatasetModelConfiguration
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.entities import HitTestingDatasetRecord
from services.knowledge.indexing.contracts import DatasetEstimateRecord
from services.knowledge.segments.contracts import SegmentDatasetRecord, SegmentDocumentRecord, SegmentScope


class RagPipelineDatasetProjectionWriter(Protocol):
    """Stage workflow projections while the dataset update transaction is open."""

    def stage_dataset_settings(self, session: Session, *, dataset: Dataset, actor_id: str) -> None: ...


class DatasetIndexUpdateAfterCommit(Protocol):
    def __call__(
        self,
        session: Session,
        *,
        dataset_id: str,
        action: DatasetIndexAction | None,
        from_rag_pipeline: bool,
    ) -> None: ...


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


def sync_app_dataset_joins(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    dataset_ids: set[str],
) -> None:
    """Synchronize app joins while holding every newly referenced parent row."""

    old_dataset_ids = set(
        session.scalars(select(AppDatasetJoin.dataset_id).where(AppDatasetJoin.app_id == app_id)).all()
    )
    removed_dataset_ids = old_dataset_ids - dataset_ids
    if removed_dataset_ids:
        session.execute(
            delete(AppDatasetJoin).where(
                AppDatasetJoin.app_id == app_id,
                AppDatasetJoin.dataset_id.in_(removed_dataset_ids),
            )
        )

    for dataset_id in sorted(dataset_ids - old_dataset_ids):
        if lock_dataset_row_for_child_write(session, tenant_id=tenant_id, dataset_id=dataset_id) is not None:
            session.add(AppDatasetJoin(app_id=app_id, dataset_id=dataset_id))


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


def _dispatch_dataset_index_update_after_commit(
    session: Session,
    *,
    dataset_id: str,
    action: DatasetIndexAction | None,
    from_rag_pipeline: bool,
) -> None:
    """Compatibility no-op for repository-only callers without a task adapter."""

    del session, dataset_id, action, from_rag_pipeline


def _stage_rag_pipeline_dataset_settings(
    session: Session,
    *,
    dataset_ref: DatasetRef,
    actor_id: str,
    expected: DatasetUpdateSnapshot,
    prepared: PreparedRagPipelineDatasetSettings,
    index_update_after_commit: DatasetIndexUpdateAfterCommit,
) -> bool:
    """Stage prepared RAG settings and dispatch legacy indexing after commit."""

    dataset = session.scalar(
        select(Dataset)
        .where(Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
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
    index_update_after_commit(
        session,
        dataset_id=dataset.id,
        action=prepared.index_action,
        from_rag_pipeline=True,
    )
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
        doc_form=get_dataset_doc_form(dataset, session=session) or "text_model",
        pipeline_id=dataset.pipeline_id,
    )


class SQLAlchemyRagPipelineDatasetUpdates:
    """Persist the two dataset operations consumed by RAG pipeline publication."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        index_update_after_commit: DatasetIndexUpdateAfterCommit,
    ) -> None:
        self._session_factory = session_factory
        self._index_update_after_commit = index_update_after_commit

    def get_update_snapshot(self, dataset_ref: DatasetRef) -> DatasetUpdateSnapshot | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                return None
            return _dataset_update_snapshot(dataset)

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
            index_update_after_commit=self._index_update_after_commit,
        )


class SQLAlchemyDatasetRepository:
    """Own SQL access to tenant-scoped dataset state."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        revoke_keys_after_commit: Callable[[Session, Sequence[str]], None],
        rag_pipeline_projection_writer: RagPipelineDatasetProjectionWriter | None = None,
        index_update_after_commit: DatasetIndexUpdateAfterCommit | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._revoke_keys_after_commit = revoke_keys_after_commit
        self._rag_pipeline_projection_writer = rag_pipeline_projection_writer
        self._index_update_after_commit = index_update_after_commit or _dispatch_dataset_index_update_after_commit

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
                indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
            )

    def record_hit_testing_query(self, actor_id: str, ref: DatasetRef, content: str) -> None:
        """Persist query history only while the owning dataset still exists."""

        with self._session_factory.begin() as session:
            inserted = stage_dataset_queries(
                session,
                tenant_id=ref.tenant_id,
                dataset_ids=(ref.dataset_id,),
                content=content,
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=actor_id,
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
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=mutation.tenant_id,
                upload_file_ids=tuple(sorted(trusted_upload_file_ids(mutation.icon_info))),
            )
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
                external_knowledge_id = values.get("external_knowledge_id", binding.external_knowledge_id)
                external_api_id = values.get("external_knowledge_api_id", binding.external_knowledge_api_id)
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
                if "external_knowledge_id" in values or "external_knowledge_api_id" in values:
                    binding.external_knowledge_id = external_knowledge_id
                    binding.external_knowledge_api_id = external_api_id
                    binding.updated_by = mutation.actor_id
                retrieval = values.get("external_retrieval_model")
                if retrieval:
                    dataset.retrieval_model = dict(retrieval)
            else:
                if "icon_info" in values:
                    lock_and_validate_owned_upload_files_in_session(
                        session,
                        tenant_id=dataset.tenant_id,
                        upload_file_ids=tuple(
                            sorted(
                                added_trusted_upload_file_ids(
                                    previous=dataset.icon_info,
                                    current=values["icon_info"],
                                )
                            )
                        ),
                    )
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

            self._index_update_after_commit(
                session,
                dataset_id=dataset.id,
                action=mutation.index_action,
                from_rag_pipeline=False,
            )
            if dataset.runtime_mode == DatasetRuntimeMode.RAG_PIPELINE and dataset.pipeline_id:
                if self._rag_pipeline_projection_writer is None:
                    raise RuntimeError("RAG pipeline dataset projection writer is not configured")
                self._rag_pipeline_projection_writer.stage_dataset_settings(
                    session,
                    dataset=dataset,
                    actor_id=mutation.actor_id,
                )
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

    def delete_with_relations(self, dataset_ref: DatasetRef) -> DatasetCleanupRecord | None:
        """Delete the dataset relations and return post-commit cleanup inputs."""

        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, dataset_ref)
            if dataset is None:
                return None

            cleanup = _cleanup_record(session, dataset)
            revoked_keys = dataset_api_key_bindings.delete_keys_scoped_only_to(
                session, cleanup.id, tenant_id=dataset_ref.tenant_id
            )
            self._revoke_keys_after_commit(session, [key.token for key in revoked_keys])
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
            return cleanup

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
