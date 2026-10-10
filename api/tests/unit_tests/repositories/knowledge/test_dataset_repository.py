from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, DatasetPermission
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.knowledge.resource_scope import DatasetRef


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

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)

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

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)
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

    repository = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)

    assert repository.is_notion_dataset(DatasetRef("workspace-1", "dataset-1")) is False
