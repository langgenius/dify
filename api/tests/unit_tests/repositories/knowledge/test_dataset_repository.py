import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from models.dataset import AppDatasetJoin, Dataset, DatasetPermission, DatasetQuery
from models.enums import DatasetQuerySource
from repositories.knowledge.dataset_read_repository import stage_dataset_queries
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository, sync_app_dataset_joins
from services.errors.file import UploadFileReferenceNotFoundError
from services.knowledge.datasets.contracts import RagPipelineDatasetCreateMutation
from services.knowledge.entities.resource_scope import DatasetRef


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


def _repository(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
    )


def test_rbac_maintainer_lookup_requires_owning_workspace(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset", "workspace"))

    repository = _repository(sqlite_session_factory)
    assert repository.get_maintainer_id("workspace", "dataset") == "account-1"
    assert repository.get_maintainer_id("other-workspace", "dataset") is None
    assert repository.get_maintainer_id("workspace", "missing") is None


def test_estimate_record_and_access_snapshot_are_separate_and_tenant_scoped(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", permission="partial_members"))
        session.add(DatasetPermission(tenant_id="workspace-1", dataset_id="dataset-1", account_id="account-2"))

    repository = _repository(sqlite_session_factory)
    estimate_record = repository.get_estimate_record(DatasetRef("workspace-1", "dataset-1"))
    snapshot = repository.get_access_snapshot(workspace_id="workspace-1", dataset_id="dataset-1", actor_id="account-2")

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
        repository.get_access_snapshot(workspace_id="workspace-2", dataset_id="dataset-1", actor_id="account-2") is None
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

    snapshot = _repository(sqlite_session_factory).get_access_snapshot(
        workspace_id="workspace-1", dataset_id="dataset-1", actor_id="revoked-account"
    )
    assert snapshot is not None
    assert snapshot.actor_has_partial_access is False


def test_notion_dataset_query_rejects_other_source_types(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", data_source_type="upload_file"))

    assert _repository(sqlite_session_factory).is_notion_dataset(DatasetRef("workspace-1", "dataset-1")) is False


def test_rag_pipeline_dataset_creation_revalidates_image_icon_upload(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    mutation = RagPipelineDatasetCreateMutation(
        tenant_id="workspace-1",
        actor_id="account-1",
        name="Pipeline Dataset",
        description="",
        permission="only_me",
        icon_info={"icon_type": "image", "icon": "removed-upload"},
    )

    with pytest.raises(UploadFileReferenceNotFoundError):
        _repository(sqlite_session_factory).create_rag_pipeline_dataset(mutation)

    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset)) is None


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
