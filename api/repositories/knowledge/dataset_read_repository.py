"""Shared knowledge persistence operations within the caller's transaction.

These helpers are shared by repositories and existing transaction owners. They
never create, commit, or close a session and perform no external I/O. Narrow
write helpers coordinate child rows with the Dataset lifecycle lock.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from enums.account import TenantAccountRole
from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from models.account import Account, TenantAccountJoin
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetAutoDisableLog,
    DatasetCollectionBinding,
    DatasetKeywordTable,
    DatasetMetadata,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    Pipeline,
)
from models.enums import CreatorUserRole, DatasetQuerySource, ProcessRuleMode
from models.model import App, Tag, TagBinding, UploadFile
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository

_DEFAULT_PROCESS_RULES: dict[str, Any] = {
    "pre_processing_rules": [
        {"id": "remove_extra_spaces", "enabled": True},
        {"id": "remove_urls_emails", "enabled": False},
    ],
    "segmentation": {"delimiter": "\n", "max_tokens": 1024, "chunk_overlap": 50},
}


def lock_dataset_row_for_child_write(session: Session, *, tenant_id: str, dataset_id: str) -> Dataset | None:
    """Serialize child writes with deletion and recheck that the parent still exists.

    Dataset deletion takes the same row lock before it snapshots descendants. A
    child writer that wins the lock therefore commits before that snapshot; a
    writer that loses waits for deletion and observes that the dataset is gone.
    ``populate_existing`` makes the locking read refresh an identity already
    present in a MySQL repeatable-read session.
    """

    return session.scalar(
        select(Dataset)
        .where(
            Dataset.id == dataset_id,
            Dataset.tenant_id == tenant_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def stage_dataset_queries(
    session: Session,
    *,
    tenant_id: str,
    dataset_ids: Sequence[str],
    content: str,
    source: DatasetQuerySource,
    source_app_id: str | None,
    created_by_role: CreatorUserRole,
    created_by: str,
) -> int:
    """Stage query history only for parents locked in this transaction."""

    locked_dataset_ids: list[str] = []
    for dataset_id in sorted(set(dataset_ids)):
        if lock_dataset_row_for_child_write(session, tenant_id=tenant_id, dataset_id=dataset_id) is not None:
            locked_dataset_ids.append(dataset_id)
    session.add_all(
        [
            DatasetQuery(
                dataset_id=dataset_id,
                content=content,
                source=source,
                source_app_id=source_app_id,
                created_by_role=created_by_role,
                created_by=created_by,
            )
            for dataset_id in locked_dataset_ids
        ]
    )
    return len(locked_dataset_ids)


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
            sa.delete(AppDatasetJoin).where(
                AppDatasetJoin.app_id == app_id,
                AppDatasetJoin.dataset_id.in_(removed_dataset_ids),
            )
        )

    for dataset_id in sorted(dataset_ids - old_dataset_ids):
        if lock_dataset_row_for_child_write(session, tenant_id=tenant_id, dataset_id=dataset_id) is not None:
            session.add(AppDatasetJoin(app_id=app_id, dataset_id=dataset_id))


def get_dataset_for_tenant(session: Session, *, tenant_id: str, dataset_id: str) -> Dataset | None:
    return session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).limit(1))


def list_datasets_by_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_ids: Sequence[str],
    actor_id: str | None = None,
    accessible_dataset_ids: Sequence[str] | None = None,
    include_own_datasets: bool = False,
) -> tuple[list[Dataset], int]:
    """List tenant-owned datasets for trusted internal ID validation.

    Account-facing callers must use :func:`list_visible_datasets_by_ids`, which
    also applies legacy dataset permissions.
    """

    unique_ids = tuple(dict.fromkeys(dataset_ids))
    if not unique_ids:
        return [], 0
    statement = select(Dataset).where(Dataset.id.in_(unique_ids), Dataset.tenant_id == tenant_id)
    if accessible_dataset_ids is not None:
        allowed_ids = set(unique_ids).intersection(accessible_dataset_ids)
        scope: sa.ColumnElement[bool] = Dataset.id.in_(allowed_ids)
        if include_own_datasets and actor_id is not None:
            scope = sa.or_(Dataset.maintainer == actor_id, scope)
        statement = statement.where(scope)
    page = paginate_query(statement, session=session, page=1, per_page=len(unique_ids), max_per_page=len(unique_ids))
    return page.items, page.total


def _apply_resolved_dataset_scope(
    statement: sa.Select[tuple[Dataset]],
    *,
    actor_id: str | None,
    accessible_dataset_ids: Sequence[str] | None,
    include_own_datasets: bool,
) -> sa.Select[tuple[Dataset]]:
    if accessible_dataset_ids is None:
        return statement
    scope: sa.ColumnElement[bool] = Dataset.id.in_(accessible_dataset_ids)
    if include_own_datasets and actor_id is not None:
        scope = sa.or_(Dataset.maintainer == actor_id, scope)
    return statement.where(scope)


def _apply_legacy_dataset_visibility(
    statement: sa.Select[tuple[Dataset]],
    session: Session,
    *,
    tenant_id: str,
    actor_id: str | None,
    actor_role: TenantAccountRole | None,
    rbac_enabled: bool,
    include_all: bool,
) -> sa.Select[tuple[Dataset]]:
    """Apply the account visibility shared by paginated and explicit-ID lists."""

    if actor_id is None:
        return statement.where(sa.false() if rbac_enabled else Dataset.permission == DatasetPermissionEnum.ALL_TEAM)
    if rbac_enabled:
        return statement

    permitted_ids = set(
        session.scalars(
            select(DatasetPermission.dataset_id).where(
                DatasetPermission.account_id == actor_id,
                DatasetPermission.tenant_id == tenant_id,
            )
        ).all()
    )
    if actor_role == TenantAccountRole.DATASET_OPERATOR:
        return statement.where(Dataset.id.in_(permitted_ids))
    if actor_role == TenantAccountRole.OWNER and include_all:
        return statement

    visible: list[sa.ColumnElement[bool]] = [
        Dataset.permission == DatasetPermissionEnum.ALL_TEAM,
        sa.and_(
            Dataset.permission == DatasetPermissionEnum.ONLY_ME,
            Dataset.maintainer == actor_id,
        ),
    ]
    if permitted_ids:
        visible.append(
            sa.and_(
                Dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM,
                Dataset.id.in_(permitted_ids),
            )
        )
    return statement.where(sa.or_(*visible))


def list_visible_datasets_by_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_ids: Sequence[str],
    actor_id: str | None,
    actor_role: TenantAccountRole | None,
    rbac_enabled: bool,
    include_all: bool,
    accessible_dataset_ids: Sequence[str] | None,
    include_own_datasets: bool,
) -> tuple[list[Dataset], int]:
    """List requested datasets under the same account policy as the ordinary list."""

    unique_ids = tuple(dict.fromkeys(dataset_ids))
    if not unique_ids:
        return [], 0
    statement = select(Dataset).where(Dataset.id.in_(unique_ids), Dataset.tenant_id == tenant_id)
    statement = _apply_resolved_dataset_scope(
        statement,
        actor_id=actor_id,
        accessible_dataset_ids=accessible_dataset_ids,
        include_own_datasets=include_own_datasets,
    )
    statement = _apply_legacy_dataset_visibility(
        statement,
        session,
        tenant_id=tenant_id,
        actor_id=actor_id,
        actor_role=actor_role,
        rbac_enabled=rbac_enabled,
        include_all=include_all,
    )
    page = paginate_query(statement, session=session, page=1, per_page=len(unique_ids), max_per_page=len(unique_ids))
    return page.items, page.total


def get_dataset_list_actor_role(session: Session, *, tenant_id: str, actor_id: str) -> TenantAccountRole | None:
    """Return the actor's detached workspace role for dataset visibility rules."""

    return session.scalar(
        select(TenantAccountJoin.role)
        .join(Account, Account.id == TenantAccountJoin.account_id)
        .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == actor_id)
        .limit(1)
    )


def list_dataset_permission_member_ids(
    session: Session, *, tenant_id: str, dataset_ids: Sequence[str]
) -> Mapping[str, tuple[str, ...]]:
    """Return permission members for tenant-owned datasets in stable order."""

    unique_ids = tuple(dict.fromkeys(dataset_ids))
    if not unique_ids:
        return {}
    members: dict[str, list[str]] = {}
    rows = session.execute(
        select(DatasetPermission.dataset_id, DatasetPermission.account_id)
        .join(Dataset, Dataset.id == DatasetPermission.dataset_id)
        .where(
            DatasetPermission.dataset_id.in_(unique_ids),
            DatasetPermission.tenant_id == tenant_id,
            Dataset.id.in_(unique_ids),
            Dataset.tenant_id == tenant_id,
        )
        .order_by(DatasetPermission.dataset_id, DatasetPermission.account_id, DatasetPermission.id)
    )
    for dataset_id, account_id in rows:
        members.setdefault(dataset_id, []).append(account_id)
    return {dataset_id: tuple(account_ids) for dataset_id, account_ids in members.items()}


def list_visible_datasets(
    session: Session,
    *,
    tenant_id: str,
    actor_id: str | None,
    actor_role: TenantAccountRole | None,
    rbac_enabled: bool,
    include_all: bool,
    accessible_dataset_ids: Sequence[str] | None,
    include_own_datasets: bool,
    keyword: str | None,
    tag_target_ids: Sequence[str] | None,
    page: int,
    per_page: int,
) -> tuple[list[Dataset], int]:
    """List datasets using access decisions already resolved by the application adapter."""

    statement = select(Dataset).where(Dataset.tenant_id == tenant_id).order_by(Dataset.created_at.desc(), Dataset.id)
    statement = _apply_resolved_dataset_scope(
        statement,
        actor_id=actor_id,
        accessible_dataset_ids=accessible_dataset_ids,
        include_own_datasets=include_own_datasets,
    )
    statement = _apply_legacy_dataset_visibility(
        statement,
        session,
        tenant_id=tenant_id,
        actor_id=actor_id,
        actor_role=actor_role,
        rbac_enabled=rbac_enabled,
        include_all=include_all,
    )

    if keyword:
        statement = statement.where(Dataset.name.ilike(f"%{escape_like_pattern(keyword)}%", escape="\\"))
    if tag_target_ids is not None:
        if not tag_target_ids:
            return [], 0
        statement = statement.where(Dataset.id.in_(tag_target_ids))

    result = paginate_query(statement, session=session, page=page, per_page=per_page, max_per_page=100)
    return result.items, result.total


def get_dataset_process_rules(
    session: Session, *, tenant_id: str, dataset_id: str
) -> tuple[ProcessRuleMode, dict[str, Any]]:
    rule = session.scalar(
        select(DatasetProcessRule)
        .join(Dataset, Dataset.id == DatasetProcessRule.dataset_id)
        .where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id)
        .order_by(DatasetProcessRule.created_at.desc())
        .limit(1)
    )
    if rule is None:
        return ProcessRuleMode.CUSTOM, {
            "pre_processing_rules": [dict(item) for item in _DEFAULT_PROCESS_RULES["pre_processing_rules"]],
            "segmentation": dict(_DEFAULT_PROCESS_RULES["segmentation"]),
        }
    return rule.mode, dict(rule.rules_dict or {})


def get_dataset_process_rule_by_id(
    session: Session, *, tenant_id: str, dataset_id: str, process_rule_id: str
) -> DatasetProcessRule | None:
    return session.scalar(
        select(DatasetProcessRule)
        .join(Dataset, Dataset.id == DatasetProcessRule.dataset_id)
        .where(
            DatasetProcessRule.id == process_rule_id,
            DatasetProcessRule.dataset_id == dataset_id,
            Dataset.tenant_id == tenant_id,
        )
        .limit(1)
    )


def list_dataset_queries(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    page: int,
    per_page: int,
) -> tuple[list[DatasetQuery], int]:
    statement = (
        select(DatasetQuery)
        .join(Dataset, Dataset.id == DatasetQuery.dataset_id)
        .where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id)
        .order_by(DatasetQuery.created_at.desc(), DatasetQuery.id)
    )
    result = paginate_query(statement, page=page, per_page=per_page, max_per_page=100, session=session)
    return result.items, result.total


def list_related_apps(session: Session, *, tenant_id: str, dataset_id: str) -> Sequence[AppDatasetJoin]:
    return session.scalars(
        select(AppDatasetJoin)
        .join(Dataset, Dataset.id == AppDatasetJoin.dataset_id)
        .join(App, App.id == AppDatasetJoin.app_id)
        .where(
            Dataset.tenant_id == tenant_id,
            Dataset.id == dataset_id,
            App.tenant_id == tenant_id,
        )
        .order_by(AppDatasetJoin.created_at.desc(), AppDatasetJoin.id)
    ).all()


def list_auto_disabled_document_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    created_after: datetime,
) -> list[str]:
    return list(
        session.scalars(
            select(DatasetAutoDisableLog.document_id)
            .join(Dataset, Dataset.id == DatasetAutoDisableLog.dataset_id)
            .where(
                Dataset.tenant_id == tenant_id,
                Dataset.id == dataset_id,
                DatasetAutoDisableLog.tenant_id == tenant_id,
                DatasetAutoDisableLog.created_at >= created_after,
            )
            .order_by(DatasetAutoDisableLog.created_at.desc(), DatasetAutoDisableLog.id)
        ).all()
    )


def get_or_create_dataset_collection_binding(
    session: Session,
    *,
    provider_name: str,
    model_name: str,
    collection_type: str = "dataset",
) -> DatasetCollectionBinding:
    binding = session.scalar(
        select(DatasetCollectionBinding)
        .where(
            DatasetCollectionBinding.provider_name == provider_name,
            DatasetCollectionBinding.model_name == model_name,
            DatasetCollectionBinding.type == collection_type,
        )
        .order_by(DatasetCollectionBinding.created_at)
        .limit(1)
    )
    if binding is None:
        binding = DatasetCollectionBinding(
            provider_name=provider_name,
            model_name=model_name,
            collection_name=Dataset.gen_collection_name_by_id(str(uuid.uuid4())),
            type=collection_type,
        )
        session.add(binding)
        session.flush()
    return binding


def get_dataset_collection_binding(
    session: Session,
    *,
    binding_id: str,
    collection_type: str = "dataset",
) -> DatasetCollectionBinding | None:
    return session.scalar(
        select(DatasetCollectionBinding)
        .where(
            DatasetCollectionBinding.id == binding_id,
            DatasetCollectionBinding.type == collection_type,
        )
        .order_by(DatasetCollectionBinding.created_at)
        .limit(1)
    )


def get_query_upload_files(query: DatasetQuery, file_ids: set[str], *, session: Session) -> dict[str, UploadFile]:
    if not file_ids:
        return {}
    rows = session.scalars(
        select(UploadFile)
        .join(Dataset, Dataset.tenant_id == UploadFile.tenant_id)
        .where(Dataset.id == query.dataset_id, UploadFile.id.in_(file_ids))
    ).all()
    return {file.id: file for file in rows}


def get_dataset_keyword_table(dataset: Dataset, *, session: Session) -> DatasetKeywordTable | None:
    return session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset.id))


def get_latest_dataset_process_rule(dataset: Dataset, *, session: Session) -> DatasetProcessRule | None:
    return session.scalar(
        select(DatasetProcessRule)
        .where(DatasetProcessRule.dataset_id == dataset.id)
        .order_by(DatasetProcessRule.created_at.desc())
        .limit(1)
    )


def get_dataset_available_document_count(dataset: Dataset, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(Document.id)).where(
                Document.dataset_id == dataset.id,
                Document.tenant_id == dataset.tenant_id,
                Document.indexing_status == "completed",
                Document.enabled.is_(True),
                Document.archived.is_(False),
            )
        )
        or 0
    )


def get_dataset_doc_form(dataset: Dataset, *, session: Session) -> str | None:
    if dataset.chunk_structure:
        return dataset.chunk_structure
    return session.scalar(
        select(Document.doc_form)
        .where(Document.dataset_id == dataset.id, Document.tenant_id == dataset.tenant_id)
        .limit(1)
    )


@dataclass(frozen=True)
class DatasetDetailPrefetch:
    """Batch-loaded values backing the session-scoped fields of a page of datasets.

    Building a detail response for a single dataset issues about ten queries for
    that row alone, so a list endpoint costs one query per dataset per field.
    Loading the same values for every dataset on the page up front keeps the
    query count bounded regardless of the page size.
    """

    app_counts: dict[str, int] = field(default_factory=dict)
    document_counts: dict[str, int] = field(default_factory=dict)
    word_counts: dict[str, int] = field(default_factory=dict)
    available_document_counts: dict[str, int] = field(default_factory=dict)
    author_names: dict[str, str] = field(default_factory=dict)
    tags: dict[tuple[str, str], list[Tag]] = field(default_factory=dict)
    doc_forms: dict[tuple[str, str], str | None] = field(default_factory=dict)
    external_knowledge_infos: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    doc_metadata: dict[str, list[DatasetMetadata]] = field(default_factory=dict)
    pipeline_published: dict[str, bool] = field(default_factory=dict)


def build_dataset_detail_prefetch(datasets: Sequence[Dataset], *, session: Session) -> DatasetDetailPrefetch:
    """Load every session-scoped detail field for the given datasets in a fixed number of queries."""
    dataset_ids = [dataset.id for dataset in datasets]
    if not dataset_ids:
        return DatasetDetailPrefetch()

    dataset_owners = [(dataset.tenant_id, dataset.id) for dataset in datasets]

    app_counts = dict(
        session.execute(
            select(AppDatasetJoin.dataset_id, func.count(AppDatasetJoin.id))
            .where(
                AppDatasetJoin.dataset_id.in_(dataset_ids),
                App.id == AppDatasetJoin.app_id,
                tuple_(App.tenant_id, AppDatasetJoin.dataset_id).in_(dataset_owners),
            )
            .group_by(AppDatasetJoin.dataset_id)
        )
        .tuples()
        .all()
    )

    document_counts: dict[str, int] = {}
    word_counts: dict[str, int] = {}
    available_document_counts: dict[str, int] = {}
    available_document_case = sa.case(
        (
            sa.and_(
                Document.indexing_status == "completed",
                Document.enabled.is_(True),
                Document.archived.is_(False),
            ),
            1,
        ),
        else_=0,
    )
    document_rows = session.execute(
        select(
            Document.dataset_id,
            func.count(Document.id),
            func.coalesce(func.sum(Document.word_count), 0),
            func.coalesce(func.sum(available_document_case), 0),
        )
        .where(tuple_(Document.tenant_id, Document.dataset_id).in_(dataset_owners))
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, document_count, word_count, available_count in document_rows:
        document_counts[dataset_id] = document_count
        word_counts[dataset_id] = word_count
        available_document_counts[dataset_id] = available_count

    # doc_form only falls back to the documents table for datasets without a
    # chunk structure of their own.
    doc_forms: dict[tuple[str, str], str | None] = {}
    doc_form_dataset_ids = [dataset.id for dataset in datasets if not dataset.chunk_structure]
    if doc_form_dataset_ids:
        doc_forms = {
            (dataset_id, tenant_id): doc_form
            for dataset_id, tenant_id, doc_form in session.execute(
                select(Document.dataset_id, Document.tenant_id, func.min(Document.doc_form))
                .where(
                    Document.dataset_id.in_(doc_form_dataset_ids),
                    tuple_(Document.tenant_id, Document.dataset_id).in_(dataset_owners),
                )
                .group_by(Document.dataset_id, Document.tenant_id)
            ).all()
        }

    author_ids = {dataset.created_by for dataset in datasets if dataset.created_by}
    author_names = dict(
        session.execute(select(Account.id, Account.name).where(Account.id.in_(author_ids))).tuples().all()
    )

    tags: dict[tuple[str, str], list[Tag]] = {}
    tag_rows = session.execute(
        select(TagBinding.target_id, TagBinding.tenant_id, Tag)
        .join(TagBinding, Tag.id == TagBinding.tag_id)
        .where(
            tuple_(TagBinding.tenant_id, TagBinding.target_id).in_(dataset_owners),
            Tag.tenant_id == TagBinding.tenant_id,
            Tag.type == "knowledge",
        )
    ).all()
    for target_id, tenant_id, tag in tag_rows:
        tags.setdefault((target_id, tenant_id), []).append(tag)

    doc_metadata: dict[str, list[DatasetMetadata]] = {}
    for dataset_metadata in session.scalars(
        select(DatasetMetadata).where(tuple_(DatasetMetadata.tenant_id, DatasetMetadata.dataset_id).in_(dataset_owners))
    ).all():
        doc_metadata.setdefault(dataset_metadata.dataset_id, []).append(dataset_metadata)

    pipeline_ids = {dataset.pipeline_id for dataset in datasets if dataset.pipeline_id}
    pipeline_published: dict[str, bool] = {}
    if pipeline_ids:
        pipeline_owners = [(dataset.tenant_id, dataset.pipeline_id) for dataset in datasets if dataset.pipeline_id]
        pipeline_published = dict(
            session.execute(
                select(Pipeline.id, Pipeline.is_published).where(
                    tuple_(Pipeline.tenant_id, Pipeline.id).in_(pipeline_owners)
                )
            )
            .tuples()
            .all()
        )

    return DatasetDetailPrefetch(
        app_counts=app_counts,
        document_counts=document_counts,
        word_counts=word_counts,
        available_document_counts=available_document_counts,
        author_names=author_names,
        tags=tags,
        doc_forms=doc_forms,
        external_knowledge_infos=SQLAlchemyExternalKnowledgeRepository(session).load_external_knowledge_infos(datasets),
        doc_metadata=doc_metadata,
        pipeline_published=pipeline_published,
    )
