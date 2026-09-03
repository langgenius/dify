import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.dataset_reference import DatasetRef
from models.dataset import Dataset, DatasetPermission
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.knowledge.application import DatasetNotFoundError


def _dataset(dataset_id: str, workspace_id: str, *, permission: str = "only_me") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        permission=permission,
        created_by="account-1",
        maintainer="account-1",
        data_source_type="notion_import",
        indexing_technique="economy",
    )


def test_get_by_ref_and_access_snapshot_are_tenant_scoped(
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

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)

    record = repository.get_by_ref(DatasetRef("workspace-1", "dataset-1"))
    snapshot = repository.get_access_snapshot(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        actor_id="account-2",
    )

    assert record is not None
    assert record.workspace_id == "workspace-1"
    assert snapshot is not None
    assert snapshot.dataset == record
    assert snapshot.actor_has_partial_access is True
    assert repository.get_by_ref(DatasetRef("workspace-2", "dataset-1")) is None
    assert (
        repository.get_access_snapshot(
            workspace_id="workspace-2",
            dataset_id="dataset-1",
            actor_id="account-2",
        )
        is None
    )


def test_partial_member_queries_ignore_revoked_permissions(
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

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")

    assert set(repository.list_partial_member_ids(dataset_ref)) == {"granted-account"}
    revoked_snapshot = repository.get_access_snapshot(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        actor_id="revoked-account",
    )
    assert revoked_snapshot is not None
    assert revoked_snapshot.actor_has_partial_access is False


def test_replace_partial_member_ids_is_atomic_deduplicated_and_tenant_scoped(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", permission="partial_members"))
        session.add_all(
            [
                DatasetPermission(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    account_id="old-account",
                ),
                DatasetPermission(
                    tenant_id="workspace-2",
                    dataset_id="dataset-1",
                    account_id="other-workspace-account",
                ),
            ]
        )

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    repository.replace_partial_member_ids(dataset_ref, ["account-2", "account-2", "account-3"])

    assert set(repository.list_partial_member_ids(dataset_ref)) == {"account-2", "account-3"}
    with sqlite_session_factory() as session:
        other_workspace_ids = session.scalars(
            select(DatasetPermission.account_id).where(DatasetPermission.tenant_id == "workspace-2")
        ).all()
        assert other_workspace_ids == ["other-workspace-account"]

    repository.replace_partial_member_ids(dataset_ref, [])

    assert repository.list_partial_member_ids(dataset_ref) == ()
    with sqlite_session_factory() as session:
        assert session.scalar(select(DatasetPermission).where(DatasetPermission.tenant_id == "workspace-2")) is not None


def test_replace_partial_member_ids_rejects_missing_owner_without_changing_permissions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1", permission="partial_members"))
        session.add(
            DatasetPermission(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                account_id="account-1",
            )
        )

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)

    with pytest.raises(DatasetNotFoundError):
        repository.replace_partial_member_ids(DatasetRef("workspace-2", "dataset-1"), ["account-2"])

    assert repository.list_partial_member_ids(DatasetRef("workspace-1", "dataset-1")) == ("account-1",)
